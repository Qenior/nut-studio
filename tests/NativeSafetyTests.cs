using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.Serialization;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NutConsole;

// Loopback sockets, temporary files, and simulated pending I/O only. No HID
// interface is opened and no physical shortcut is registered by these tests.
class NativeSafetyTests {
    static readonly Type ProgramType=typeof(HidTransport).Assembly.GetType("NutConsole.Program");
    static readonly BindingFlags PrivateStatic=BindingFlags.NonPublic|BindingFlags.Static;
    static int passed;
    static object Call(string name,params object[] args){return ProgramType.GetMethod(name,PrivateStatic).Invoke(null,args);}
    static object Get(string name){return ProgramType.GetField(name,PrivateStatic).GetValue(null);}
    static void Set(string name,object value){ProgramType.GetField(name,PrivateStatic).SetValue(null,value);}
    static void Check(bool condition,string name){if(!condition)throw new Exception("FAILED: "+name);passed++;Console.WriteLine("PASS: "+name);}
    static bool Fails(Action action){try{action();return false;}catch(TargetInvocationException){return true;}}
    static Dictionary<string,object> Session(string url){return new Dictionary<string,object>{{"url",url},{"port",38165},{"pid",123},{"version","1.1.5"}};}
    static bool ValidSession(Dictionary<string,object> value){return (bool)Call("TrySessionUrl",value,null);}
    sealed class SocketPair : IDisposable {
        public readonly TcpClient Client,Server;
        public SocketPair(){
            var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();
            try{Client=new TcpClient();Client.Connect((IPEndPoint)listener.LocalEndpoint);Server=listener.AcceptTcpClient();Client.ReceiveTimeout=5000;Client.SendTimeout=5000;}
            finally{listener.Stop();}
        }
        public void Send(string text){byte[] bytes=Encoding.UTF8.GetBytes(text);Client.GetStream().Write(bytes,0,bytes.Length);}
        public void Dispose(){Client.Close();Server.Close();}
    }
    static string RoundTrip(string headers,string body){
        using(var pair=new SocketPair()){
            int port=((IPEndPoint)pair.Server.Client.LocalEndPoint).Port;
            Set("port",port);Set("origin","http://127.0.0.1:"+port);
            string token=(string)Get("Token");
            string request="POST /"+token+"/api/ping HTTP/1.1\r\nHost: 127.0.0.1:"+port+"\r\nX-Nut-Token: "+token+"\r\nContent-Type: application/json\r\n"+headers+"\r\n"+body;
            var handled=Task.Run(delegate{Call("Handle",pair.Server);});
            var responseStream=pair.Client.GetStream();
            pair.Send(request);pair.Client.Client.Shutdown(SocketShutdown.Send);
            string reply;using(var reader=new StreamReader(responseStream,Encoding.UTF8))reply=reader.ReadToEnd();
            if(!handled.Wait(5000))throw new Exception("Loopback handler did not finish");
            return reply;
        }
    }
    sealed class ReleaseProbe : IDisposable {public int Releases;public void Dispose(){Interlocked.Increment(ref Releases);}}
    static bool QueuedApiCancelled(string path,Dictionary<string,object> payload){
        object deviceGate=Get("DeviceGate");bool cancelled=false,blocked;
        var worker=new Thread(delegate(){try{Call("Api",path,payload);}catch(TargetInvocationException error){cancelled=error.InnerException is OperationCanceledException;}});
        worker.IsBackground=true;Set("running",true);
        lock(deviceGate){worker.Start();blocked=SpinWait.SpinUntil(delegate{return (worker.ThreadState&System.Threading.ThreadState.WaitSleepJoin)!=0;},2000);Set("running",false);}
        return worker.Join(3000)&&blocked&&cancelled;
    }
    static void Main(){try{
        string token=new string('a',64),local="http://127.0.0.1:38165/"+token+"/";
        Check(ValidSession(Session(local)),"exact local session URL accepted");
        string[] invalid={"https://127.0.0.1:38165/"+token+"/","http://localhost:38165/"+token+"/","http://127.0.0.1:38166/"+token+"/",local+"?redirect=x",local+"#x","http://user@127.0.0.1:38165/"+token+"/","http://127.0.0.1:38165/"+new string('a',63)+"/","http://127.0.0.1:38165/%61"+new string('a',63)+"/",local+new string('x',300)};
        foreach(string url in invalid)Check(!ValidSession(Session(url)),"invalid session destination or token rejected");
        var altered=Session(local);altered["extra"]=true;Check(!ValidSession(altered),"unexpected session fields rejected");
        altered=Session(local);altered["pid"]=-1;Check(!ValidSession(altered),"invalid session PID rejected");
        altered=Session(local);altered["port"]="38165";Check(!ValidSession(altered),"session port must be an integer");
        altered=Session(local);altered["version"]="old";Check(!ValidSession(altered),"another app version is not reopened");

        string drive="Z:"+"\\",profile=drive+"Users"+"\\"+"Sample User"+"\\"+"private.json";
        string forward=profile.Replace('\\','/'),mail="sample"+"@"+"example.invalid";
        string device=new string('\\',2)+"?\\"+"hid#vid_342d&pid_e545#"+Guid.NewGuid().ToString("N");
        string sensitive=profile+"\r\n"+forward+"\r\n"+mail+"\r\n"+device+"\r\n"+local+"\r\n"+"X-Nut-Token: "+token+"\r\n"+"{\"password\":\"private-value\"}";
        string safe=(string)Call("RedactDiagnostic",sensitive);
        Check(!safe.Contains(profile)&&!safe.Contains(forward)&&!safe.Contains("Sample User"),"Windows paths with spaces and both slash styles redacted");
        Check(!safe.Contains(mail)&&!safe.Contains(device)&&!safe.Contains(token)&&!safe.Contains("private-value"),"email, unique device path, session and credential redacted");
        Check((string)Call("RedactDiagnostic","HID VID=342D PID=E545 usage=FF60:0061 input=65 output=65")=="HID VID=342D PID=E545 usage=FF60:0061 input=65 output=65","nonprivate HID framing remains useful");
        Check(((string)Call("RedactDiagnostic","Reference https://learn.microsoft.com/test")).Contains("https://learn.microsoft.com/test"),"public diagnostic URL remains readable");
        string credential="synthetic"+" credential with spaces";
        Check(!((string)Call("RedactDiagnostic","Authorization: Basic "+credential)).Contains("credential"),"Basic authorization value fully redacted");
        Check(!((string)Call("RedactDiagnostic","Authorization: Bearer "+credential)).Contains("credential"),"Bearer authorization value fully redacted");
        Check(!((string)Call("RedactDiagnostic","password=\""+credential+"\"")).Contains("with spaces"),"quoted credential with spaces fully redacted");
        Check(!((string)Call("RedactDiagnostic","{\"secret\":\"synthetic \\\"quote\\\" "+credential+"\"}")).Contains("with spaces"),"escaped quoted credential fully redacted");
        string currentUser=Environment.UserName;
        if(!String.IsNullOrEmpty(currentUser))Check(!((string)Call("RedactDiagnostic","User "+currentUser)).Contains(currentUser),"current account name redacted");

        string folder=Path.Combine(Path.GetTempPath(),"nut-safety-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);
        try{
            string file=Path.Combine(folder,"settings.json");File.WriteAllText(file,new string('x',4096),new UTF8Encoding(false));
            Check(((string)Call("ReadBoundedText",file,4096)).Length==4096,"configuration read accepts its byte boundary");
            Check(Fails(delegate{Call("ReadBoundedText",file,4095);}),"oversized configuration rejected before reading");
            Check(Fails(delegate{Call("WriteTextAtomic",file,new string('y',4097),4096);})&&File.ReadAllText(file)==new string('x',4096),"oversized save preserves existing configuration");
            Task[] writers=new Task[24];
            for(int i=0;i<writers.Length;i++){int id=i;writers[i]=Task.Run(delegate{Call("WriteTextAtomic",file,new string((char)('a'+id),4096),4096);});}
            Task.WaitAll(writers);string written=File.ReadAllText(file);bool consistent=written.Length==4096;
            foreach(char c in written)consistent&=c==written[0];
            Check(consistent&&!File.Exists(file+".tmp"),"concurrent saves are complete and temporary files are removed");
            Call("WriteTextAtomic",file,"complete",4096);Check(File.ReadAllText(file)=="complete","existing configuration remains replaceable after concurrent saves");
            using(var locked=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read))Check(Fails(delegate{Call("WriteTextAtomic",file,"replacement",4096);}),"blocked replacement reports failure");
            Check(File.ReadAllText(file)=="complete"&&!File.Exists(file+".tmp"),"failed replacement preserves existing settings and removes temporary file");
            Call("WriteTextAtomic",file,new string('\u00e9',2048),4096);
            Check(((string)Call("ReadBoundedText",file,4096)).Length==2048&&Fails(delegate{Call("WriteTextAtomic",file,new string('\u00e9',2049),4096);}),"configuration size limit counts UTF-8 bytes");

            var release=new ReleaseProbe();var pending=new TaskCompletionSource<bool>();
            typeof(HidTransport).GetMethod("RetireIo",PrivateStatic).Invoke(null,new object[]{pending.Task,release,new byte[65]});
            Check(release.Releases==0,"pending I/O resources are retained before completion");
            pending.SetException(new IOException("simulated late I/O fault"));
            Check(release.Releases==1,"late I/O failure is observed and releases resources once");
            var cancelled=new TaskCompletionSource<bool>();release=new ReleaseProbe();
            typeof(HidTransport).GetMethod("RetireIo",PrivateStatic).Invoke(null,new object[]{cancelled.Task,release,new byte[65]});cancelled.SetCanceled();
            Check(release.Releases==1,"cancelled I/O releases resources only after completion");

            var io=new FileStream(Path.Combine(folder,"pending.bin"),FileMode.Create,FileAccess.ReadWrite,FileShare.ReadWrite,1,true);
            var handle=io.SafeFileHandle;pending=new TaskCompletionSource<bool>();
            var transport=(HidTransport)FormatterServices.GetUninitializedObject(typeof(HidTransport));
            typeof(HidTransport).GetField("stream",BindingFlags.NonPublic|BindingFlags.Instance).SetValue(transport,io);
            bool timedOut=false;
            try{typeof(HidTransport).GetMethod("WaitIo",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(transport,new object[]{pending.Task,io,new byte[65],"simulated timeout"});}
            catch(TargetInvocationException error){timedOut=error.InnerException is TimeoutException;}
            Check(timedOut&&transport.IsClosed&&!handle.IsClosed,"timed-out transport detaches while pending handle remains alive");
            pending.SetException(new IOException("simulated completion after timeout"));
            Check(handle.IsClosed,"timed-out handle closes after the delayed completion");
        }finally{Directory.Delete(folder,true);}
        bool nullDevice=false;try{HidTransport.ValidateDevice(null);}catch(ArgumentNullException){nullDevice=true;}
        Check(nullDevice,"null HID metadata rejected before opening hardware");

        string data=(string)Get("Data"),log=Path.Combine(data,"connection.log");Directory.CreateDirectory(data);
        byte[] previous=File.Exists(log)?File.ReadAllBytes(log):null;
        try{
            File.WriteAllText(log,sensitive,new UTF8Encoding(false));
            string historical=(string)Call("Api","api/diagnostics/read",new Dictionary<string,object>());
            Check(!historical.Contains(mail)&&!historical.Contains("Sample User")&&!historical.Contains(token)&&!historical.Contains(device),"historical diagnostic export redacts prior unsanitized records");
            File.WriteAllText(log,"",new UTF8Encoding(false));Call("LogDiagnostic",sensitive);
            string recorded=File.ReadAllText(log);
            Check(!recorded.Contains(mail)&&!recorded.Contains("Sample User")&&!recorded.Contains(token)&&!recorded.Contains(device),"new diagnostic records are redacted before reaching disk");
        }finally{if(previous==null)File.Delete(log);else File.WriteAllBytes(log,previous);}

        using(var pair=new SocketPair()){
            string head="POST / HTTP/1.1\r\nContent-Length: 12\r\n\r\n",body="abcdefghijkl";pair.Send(head+body);
            SpinWait.SpinUntil(delegate{return pair.Server.Available==head.Length+body.Length;},2000);
            object[] parameters={pair.Server.GetStream(),Stopwatch.StartNew(),null,0,0};
            string parsed=(string)ProgramType.GetMethod("ReadRequestHead",PrivateStatic).Invoke(null,parameters);
            byte[] buffer=(byte[])parameters[2];int offset=(int)parameters[3],count=(int)parameters[4];
            Check(parsed==head&&count==body.Length&&Encoding.ASCII.GetString(buffer,offset,count)==body,"buffered header read preserves coalesced request body");
        }
        using(var pair=new SocketPair()){
            string prefix="GET / HTTP/1.1\r\nX-Pad: ",suffix="\r\n\r\n";
            string head=prefix+new string('x',16384-prefix.Length-suffix.Length)+suffix;pair.Send(head);
            object[] parameters={pair.Server.GetStream(),Stopwatch.StartNew(),null,0,0};
            Check(((string)ProgramType.GetMethod("ReadRequestHead",PrivateStatic).Invoke(null,parameters)).Length==16384,"16 KiB request header boundary accepted");
        }
        using(var pair=new SocketPair()){
            pair.Send(new string('x',16385));
            Check(Fails(delegate{Call("ReadRequestHead",pair.Server.GetStream(),Stopwatch.StartNew(),null,0,0);}),"request header above 16 KiB rejected");
        }
        string response=RoundTrip("Content-Length: 2\r\n","{}");
        Check(response.Contains("200 OK")&&response.Contains("\"ok\":true")&&response.Contains("1.1.5"),"loopback POST accepts a coalesced JSON request");
        string large="{\"pad\":\""+new string('x',262144-10)+"\"}";
        Check(Encoding.UTF8.GetByteCount(large)==262144&&RoundTrip("Content-Length: 262144\r\n",large).Contains("\"ok\":true"),"256 KiB request body boundary accepted");
        Check(RoundTrip("Content-Length: 262145\r\n","").Contains("400 Error"),"body above 256 KiB rejected");
        Check(RoundTrip("Content-Length: 2\r\nContent-Length: 2\r\n","{}")=="","ambiguous duplicate headers rejected");
        Check(RoundTrip("Content-Length: 2\r\nTransfer-Encoding: chunked\r\n","{}")=="","unsupported transfer framing rejected");

        var clients=(HashSet<TcpClient>)Get("Clients");var tracked=new List<TcpClient>();
        try{
            for(int i=0;i<33;i++)tracked.Add(new TcpClient());bool accepted=true;
            for(int i=0;i<32;i++)accepted&=(bool)Call("TryTrackClient",tracked[i]);
            Check(accepted&&!(bool)Call("TryTrackClient",tracked[32]),"32 active sockets allowed and the next rejected");
            clients.Remove(tracked[0]);Check((bool)Call("TryTrackClient",tracked[32]),"released socket capacity can be reused");
        }finally{clients.Clear();foreach(var client in tracked)client.Close();}

        using(var pair=new SocketPair()){
            var elapsed=Stopwatch.StartNew();
            var reading=Task.Run(delegate{try{Call("ReadRequestHead",pair.Server.GetStream(),elapsed,null,0,0);return false;}catch(TargetInvocationException){return true;}});
            while(!reading.IsCompleted&&elapsed.ElapsedMilliseconds<13000){pair.Send("x");Thread.Sleep(1800);}
            Check(reading.Wait(2000)&&reading.Result&&elapsed.ElapsedMilliseconds>=9500&&elapsed.ElapsedMilliseconds<14000,"total request deadline stops a client that keeps trickling bytes");
        }
        Set("running",false);
        Check(Fails(delegate{Call("Api","api/ping",new Dictionary<string,object>());}),"shutdown rejects new API calls");
        // Unknown device dispatch exercises the same gate as connect without
        // enumerating hardware even if the shutdown guard regresses.
        Check(QueuedApiCancelled("api/unknown",new Dictionary<string,object>())&&Get("hid")==null,"queued device API is cancelled before dispatch after shutdown");
        Check(QueuedApiCancelled("api/shortcut/configure",new Dictionary<string,object>{{"enabled",false}}),"queued shortcut configuration is cancelled after shutdown");
        Call("BeginShutdown");
        Check(!((bool)Get("running"))&&((CancellationTokenSource)Get("Shutdown")).IsCancellationRequested,"shutdown cancels watchdog delays and leaves service stopped");
        Console.WriteLine("Passed "+passed+" native safety checks (no physical HID validation).");
    }catch(Exception error){Exception root=error.GetBaseException();Console.Error.WriteLine(root.GetType().Name+": "+Call("RedactDiagnostic",root.Message));Environment.ExitCode=1;}}
}
