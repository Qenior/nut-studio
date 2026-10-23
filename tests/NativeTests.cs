using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;
using NutConsole;
class NativeTests {
    static Type program=typeof(HidTransport).Assembly.GetType("NutConsole.Program");
    static int passed=0;
    static void Set(string field,object value){program.GetField(field,BindingFlags.Static|BindingFlags.NonPublic).SetValue(null,value);}
    static void Check(bool condition,string name){if(!condition)throw new Exception("FAILED: "+name);passed++;Console.WriteLine("PASS: "+name);}
    static bool Allowed(params byte[] cmd){try{program.GetMethod("ValidateCommand",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,new object[]{cmd});return true;}catch(TargetInvocationException){return false;}}
    static void ResetCu(){program.GetMethod("ResetCuDetection",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,null);}
    static void Observe(byte id,byte value){program.GetMethod("ObserveCuResponse",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,new object[]{new byte[]{8,0,id},new byte[]{8,0,id,value}});}
    static void ShortcutLifecycle(string file){
        var type=typeof(StripShortcut);var fields=BindingFlags.Instance|BindingFlags.NonPublic|BindingFlags.Public;
        var workerType=type.GetNestedType("Worker",BindingFlags.NonPublic);
        var workerField=type.GetField("worker",fields);var start=type.GetMethod("StartWorker",fields);
        string preference="{\"enabled\":true,\"effect\":31,\"mode\":4}";
        System.IO.File.WriteAllText(file,preference+new string(' ',16384-preference.Length),new System.Text.UTF8Encoding(false));
        using(var shortcut=new StripShortcut(file)){
            var state=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new JavaScriptSerializer().Serialize(shortcut.State()));
            Check((bool)state["enabled"]&&(int)state["effect"]==31&&!(bool)state["registered"],"shortcut accepts a preference at the 16 KiB boundary without capturing F24");
        }
        System.IO.File.AppendAllText(file," ");
        using(var shortcut=new StripShortcut(file)){
            var state=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new JavaScriptSerializer().Serialize(shortcut.State()));
            Check(!(bool)state["enabled"]&&(int)state["effect"]==1&&new System.IO.FileInfo(file).Length==16385,"oversized shortcut preference falls back without altering the original file");
        }
        System.IO.File.WriteAllText(file,"{}");
        // StartWorker creates only a hidden dispatcher. Never call Configure(true),
        // Register or RegisterHotKey: an installed NUT Studio may already own F24.
        for(int i=0;i<3;i++){
            var shortcut=new StripShortcut(file);start.Invoke(shortcut,null);
            var worker=workerField.GetValue(shortcut);var thread=(Thread)workerType.GetField("thread",fields).GetValue(worker);
            bool neverRegistered=!(bool)workerType.GetField("registered",fields).GetValue(worker);
            shortcut.Dispose();shortcut.Dispose();
            Check(neverRegistered&&!thread.IsAlive&&workerField.GetValue(shortcut)==null&&workerType.GetField("control",fields).GetValue(worker)==null,"shortcut dispatcher exits and releases references without reserving F24 ("+i+")");
        }
        using(var shortcut=new StripShortcut(file)){
            type.GetField("registered",fields).SetValue(shortcut,true);
            var waiters=new Thread[4];var errors=new Exception[4];
            for(int i=0;i<waiters.Length;i++){
                int index=i;waiters[i]=new Thread(delegate(){try{shortcut.Wait(0,"");}catch(Exception error){errors[index]=error;}});waiters[i].IsBackground=true;waiters[i].Start();
            }
            var timer=System.Diagnostics.Stopwatch.StartNew();bool waiting=false;
            while(timer.ElapsedMilliseconds<2000){waiting=true;foreach(var thread in waiters)waiting&=(thread.ThreadState&ThreadState.WaitSleepJoin)!=0;if(waiting)break;Thread.Sleep(5);}
            shortcut.Dispose();bool finished=true,clean=true;
            for(int i=0;i<waiters.Length;i++){finished&=waiters[i].Join(1000);clean&=errors[i]==null;}
            Check(waiting&&finished&&clean,"disposing shortcut wakes all simulated long polls without disposed-wait errors");
            bool configureBlocked=false,rememberBlocked=false;
            try{shortcut.Configure(false);}catch(ObjectDisposedException){configureBlocked=true;}
            try{shortcut.Remember(1,0);}catch(ObjectDisposedException){rememberBlocked=true;}
            shortcut.Suspend();shortcut.ExpireIdleLease();shortcut.Wait(0,"");
            Check(configureBlocked&&rememberBlocked,"disposed shortcut rejects new configuration and allows idempotent cleanup");
        }
        using(var shortcut=new StripShortcut(file)){
            var worker=Activator.CreateInstance(workerType,true);var workerGate=workerType.GetField("gate",fields).GetValue(worker);
            var businessGate=type.GetField("gate",fields).GetValue(shortcut);bool exited=false;
            var thread=new Thread(delegate(){
                lock(workerGate){while(!(bool)workerType.GetField("stopping",fields).GetValue(worker))Monitor.Wait(workerGate);}
                lock(businessGate)exited=true;
            });thread.IsBackground=true;workerType.GetField("thread",fields).SetValue(worker,thread);workerField.SetValue(shortcut,worker);thread.Start();
            shortcut.Dispose();
            Check(exited&&!thread.IsAlive,"shortcut disposal joins a stopping worker outside the business lock");
        }
        var awaitWorker=type.GetMethod("AwaitWorker",BindingFlags.Static|BindingFlags.NonPublic);
        var delayed=Activator.CreateInstance(workerType,true);bool timeout=false;
        try{awaitWorker.Invoke(null,new object[]{delayed,10});}catch(TargetInvocationException error){timeout=error.InnerException.Message.Contains("启动超时");}
        Check(timeout&&(bool)workerType.GetField("stopping",fields).GetValue(delayed),"shortcut startup timeout marks a delayed worker for shutdown");
        using(var shortcut=new StripShortcut(file)){
            var delayedThread=new Thread(delegate(){type.GetMethod("RunWorker",fields).Invoke(shortcut,new object[]{delayed});});delayedThread.IsBackground=true;delayedThread.SetApartmentState(ApartmentState.STA);delayedThread.Start();
            bool ended=delayedThread.Join(2000);
            Check(ended&&workerType.GetField("control",fields).GetValue(delayed)==null&&!(bool)workerType.GetField("registered",fields).GetValue(delayed),"late shortcut startup cleans its dispatcher without starting a message loop or capturing F24");
        }
        var failed=Activator.CreateInstance(workerType,true);var failure=new InvalidOperationException("simulated dispatcher failure");
        workerType.GetField("ready",fields).SetValue(failed,true);workerType.GetField("failure",fields).SetValue(failed,failure);bool reported=false;
        try{awaitWorker.Invoke(null,new object[]{failed,10});}catch(TargetInvocationException error){reported=Object.ReferenceEquals(error.InnerException.InnerException,failure);}
        Check(reported&&(bool)workerType.GetField("stopping",fields).GetValue(failed),"shortcut startup failure preserves its cause and requests cleanup");
        using(var process=System.Diagnostics.Process.GetCurrentProcess()){
            int before=process.HandleCount;var retained=new List<StripShortcut>();
            for(int i=0;i<1000;i++){var shortcut=new StripShortcut(file);shortcut.Dispose();retained.Add(shortcut);}
            process.Refresh();int growth=process.HandleCount-before;
            Check(growth<=8&&retained.Count==1000,"1000 retained disposed shortcuts do not retain one kernel wait handle each (growth "+growth+")");
            GC.KeepAlive(retained);
        }
    }
    static void Main(){try{
        Set("protocol",11);Set("layers",5);
        Check(Allowed(1)&&Allowed(0x11),"read-only VIA discovery");
        Check(Allowed(4,0,0,0)&&Allowed(4,4,4,14),"supported key queries");
        Check(Allowed(5,0,0,0,0,4)&&Allowed(5,4,4,14,0,5),"physical key writes");
        Check(!Allowed(5,0,2,12,0,4)&&!Allowed(5,0,3,1,0,4)&&!Allowed(5,0,4,3,0,4),"unused matrix positions blocked");
        Check(!Allowed(5,5,0,0,0,4)&&!Allowed(5,0,5,0,0,4)&&!Allowed(5,0,0,15,0,4),"out-of-bounds positions blocked");
        Check(!Allowed(6)&&!Allowed(10)&&!Allowed(11)&&!Allowed(0x0f,0)&&!Allowed(0x13,0),"reset, bootloader, macro and raw buffer writes blocked");
        Check(Allowed(8,3,1)&&Allowed(7,3,2,45)&&Allowed(7,3,4,100,200)&&Allowed(9,3),"documented lighting payloads");
        Check(!Allowed(7,3,2,46)&&!Allowed(7,2,2,1)&&!Allowed(9,0),"unknown effects and channels blocked");
        Check(!Allowed(7,3,4,1)&&!Allowed(5,0,0,0,1)&&!Allowed(1,0),"truncated and unexpected payloads blocked");
        Set("protocol",13);Check(!Allowed(5,0,0,0,0,4)&&!Allowed(7,3,2,1),"future protocol writes blocked");
        Set("protocol",10);Check(!Allowed(7,3,2,1),"old lighting framing never guessed");
        var request=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>("{\"bytes\":[4,0,0,0]}");
        Check(request["bytes"] is ArrayList,"JavaScript byte arrays deserialize as expected");
        bool rejected=false;try{new HidTransport(new HidDeviceInfo{VendorId=1,ProductId=2});}catch(InvalidOperationException){rejected=true;}
        Check(rejected,"other vendors cannot be opened");
        var raw=new HidDeviceInfo{VendorId=0x342d,ProductId=0xe545,UsagePage=0xff60,Usage=0x61,InputLength=65,OutputLength=65,InputReportId=3,OutputReportId=7};
        HidTransport.ValidateDevice(raw);Check(true,"64-byte payload descriptor is accepted");
        var output=HidTransport.FrameOutput(new byte[]{1},65,7);
        Check(output.Length==65&&output[0]==7&&output[1]==1&&output[64]==0,"64-byte output uses descriptor report id and zero padding");
        var input=new byte[65];input[0]=3;input[1]=1;input[3]=11;input[64]=99;
        var normalized=HidTransport.NormalizeInput(input,65,3);
        Check(normalized.Length==32&&normalized[0]==1&&normalized[2]==11&&normalized[31]==0,"64-byte input is normalized to VIA payload");
        var oldOutput=HidTransport.FrameOutput(new byte[]{4,0,0,0},33,0);
        Check(oldOutput.Length==33&&oldOutput[0]==0&&oldOutput[1]==4,"standard 32-byte payload remains compatible");
        bool shortRejected=false;try{HidTransport.NormalizeInput(new byte[32],32,0);}catch(System.IO.IOException){shortRejected=true;}
        Check(shortRejected,"truncated input cannot masquerade as a full VIA response");
        bool wrongId=false;try{HidTransport.NormalizeInput(input,65,0);}catch(System.IO.IOException){wrongId=true;}
        Check(wrongId,"unexpected input report id is rejected");
        raw.OutputLength=17;bool invalidLength=false;try{HidTransport.ValidateDevice(raw);}catch(InvalidOperationException){invalidLength=true;}
        Check(invalidLength,"undersized interface is rejected before opening hardware");
        Set("protocol",11);ResetCu();
        Check(Allowed(8,0,1)&&Allowed(8,0,4)&&!Allowed(7,0,1,4)&&!Allowed(9,0),"read-only custom probe cannot unlock writes alone");
        Observe(1,4);Observe(2,25);Observe(3,5);
        Check(!Allowed(7,0,4,1),"partial CU probe does not unlock custom writes");Observe(4,0);
        Check(Allowed(7,0,1,10)&&Allowed(7,0,2,35)&&Allowed(7,0,3,10)&&Allowed(7,0,4,4)&&Allowed(9,0),"complete valid CU probe permits defined settings");
        Check(!Allowed(7,0,1,11)&&!Allowed(7,0,2,40)&&!Allowed(7,0,3,15)&&!Allowed(7,0,4,2),"undocumented CU parameter values blocked");
        Check(Allowed(7,3,2,36)&&Allowed(7,3,2,22)&&!Allowed(7,3,2,37)&&!Allowed(7,3,2,45)&&!Allowed(7,3,2,255),"CU physical off 22 accepted; unknown and standard-only choices blocked");
        Check(!Allowed(7,0,4)&&!Allowed(7,0,4,1,0)&&!Allowed(8,0,5)&&!Allowed(8,0,1,0),"custom packet boundaries remain exact");
        Observe(2,0);Check(!Allowed(7,0,1,4)&&!Allowed(9,0),"invalid custom reply revokes write access");
        ResetCu();Observe(1,4);Observe(2,25);Observe(3,5);Observe(4,2);Observe(4,0);
        Check(Allowed(7,0,4,2),"previously observed wireless battery state can be restored");
        ResetCu();Check(!Allowed(7,0,4,1)&&Allowed(7,3,2,45),"disconnect resets CU capability detection");
        Check(StripShortcut.ValidResume(1,0)&&StripShortcut.ValidResume(36,4)&&!StripShortcut.ValidResume(22,0)&&!StripShortcut.ValidResume(0,0)&&!StripShortcut.ValidResume(37,0)&&!StripShortcut.ValidResume(1,2),"strip resume values exclude off, invalid modes and unknown effects");
        string shortcutFile=System.IO.Path.GetTempFileName();
        try{
            using(var shortcut=new StripShortcut(shortcutFile)){
                shortcut.Configure(false);shortcut.Remember(31,4);
                var saved=new JavaScriptSerializer().Deserialize<StripShortcut.Preference>(System.IO.File.ReadAllText(shortcutFile));
                Check(!saved.enabled&&saved.effect==31&&saved.mode==4,"strip preference persists without registering an input hook");
                string unchanged=System.IO.File.ReadAllText(shortcutFile);bool blocked=false;try{shortcut.Remember(22,0);}catch{blocked=true;}
                Check(blocked&&System.IO.File.ReadAllText(shortcutFile)==unchanged,"invalid strip resume does not alter saved preferences");
                bool badSequence=false;try{shortcut.Wait(1,"test");}catch{badSequence=true;}Check(badSequence,"future shortcut event sequence rejected");
            }
            System.IO.File.WriteAllText(shortcutFile,"invalid JSON");using(var shortcut=new StripShortcut(shortcutFile)){
                var current=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new JavaScriptSerializer().Serialize(shortcut.State()));
                Check(!(bool)current["enabled"]&&!(bool)current["registered"],"invalid shortcut preferences do not capture F24");
            }
            ShortcutLifecycle(shortcutFile);
        }finally{System.IO.File.Delete(shortcutFile);}
        Console.WriteLine("Passed "+passed+" native boundary checks.");
    }catch(Exception e){Console.Error.WriteLine(e);Environment.ExitCode=1;}}
}
