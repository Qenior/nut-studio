using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace NutConsole {
    // Explicitly reserves only F24; never installs a general keyboard hook.
    // HID work stays in the UI's serialized, backed-up VIA queue.
    sealed class StripShortcut : IDisposable {
        readonly string file;
        readonly object gate=new object();
        // Window callbacks must never acquire the business lock used around Invoke.
        readonly object signalGate=new object();
        long signalVersion;
        Worker worker;
        long sequence;
        bool enabled;
        volatile bool disposed;
        volatile bool registered;
        string owner="";
        DateTime lastPoll=DateTime.MinValue;
        int resumeEffect=1,resumeMode=0;
        const int HotkeyId=0x4e55;
        [DllImport("user32.dll",SetLastError=true)] static extern bool RegisterHotKey(IntPtr window,int id,uint modifiers,uint key);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr window,int id);

        sealed class Worker {
            public readonly object gate=new object();
            public Control control;
            public Thread thread;
            public bool ready,registered;
            public volatile bool stopping;
            public Exception failure;
        }

        sealed class HotkeyWindow : NativeWindow {
            readonly Action action;
            public HotkeyWindow(IntPtr handle,Action action){this.action=action;AssignHandle(handle);}
            protected override void WndProc(ref Message message){
                if(message.Msg==0x0312&&message.WParam.ToInt32()==HotkeyId)action();
                base.WndProc(ref message);
            }
        }
        public StripShortcut(string file){
            this.file=file;
            try{
                if(File.Exists(file)){
                    // The read-only share keeps the checked file from growing mid-read.
                    using(var input=File.OpenRead(file)){
                        if(input.Length>16384)return;
                        using(var reader=new StreamReader(input)){
                            var saved=new JavaScriptSerializer().Deserialize<Preference>(reader.ReadToEnd());
                            if(saved!=null){enabled=saved.enabled;if(ValidResume(saved.effect,saved.mode)){resumeEffect=saved.effect;resumeMode=saved.mode;}}
                        }
                    }
                }
            }catch{ /* A damaged preference never blocks keyboard configuration. */ }
        }
        public sealed class Preference {public bool enabled;public int effect=1;public int mode;}
        public static bool ValidResume(int effect,int mode){return effect>=1&&effect<=36&&effect!=22&&(mode==0||mode==1||mode==3||mode==4);}
        public object State(){lock(gate)return new {enabled=enabled,registered=registered,sequence=Interlocked.Read(ref sequence),owner=owner,effect=resumeEffect,mode=resumeMode};}
        void Signal(){lock(signalGate){signalVersion++;Monitor.PulseAll(signalGate);}}
        static void StopWorker(Worker current){
            if(current==null)return;
            lock(current.gate){
                current.stopping=true;Monitor.PulseAll(current.gate);
                if(current.control!=null)try{current.control.BeginInvoke((Action)Application.ExitThread);}catch(InvalidOperationException){}
            }
        }
        void RunWorker(Worker current){
            try{
                using(var dispatcher=new Control()){
                    HotkeyWindow window=null;
                    try{
                        dispatcher.Visible=false;
                        var handle=dispatcher.Handle;
                        window=new HotkeyWindow(handle,delegate(){if(!disposed){Interlocked.Increment(ref sequence);Signal();}});
                        bool run;
                        lock(current.gate){current.control=dispatcher;current.ready=true;run=!current.stopping;Monitor.PulseAll(current.gate);}
                        if(run)Application.Run();
                    }finally{
                        if(current.registered){UnregisterHotKey(dispatcher.Handle,HotkeyId);current.registered=false;}
                        registered=false;
                        if(window!=null)window.ReleaseHandle();
                    }
                }
            }catch(Exception error){lock(current.gate)current.failure=error;}
            finally{
                lock(current.gate){current.control=null;current.stopping=true;current.ready=true;Monitor.PulseAll(current.gate);}
                Signal();
            }
        }
        static void AwaitWorker(Worker current,int timeout){
            var timer=System.Diagnostics.Stopwatch.StartNew();
            bool ready;Exception failure;
            lock(current.gate){
                while(!current.ready&&!current.stopping){
                    int remaining=timeout-(int)timer.ElapsedMilliseconds;
                    if(remaining<=0)break;
                    Monitor.Wait(current.gate,remaining);
                }
                ready=current.ready&&!current.stopping&&current.control!=null;failure=current.failure;
            }
            if(!ready){StopWorker(current);throw new Exception(failure==null?"前灯带快捷键服务启动超时":"前灯带快捷键服务无法启动",failure);}
        }
        void StartWorker(){
            if(worker!=null&&worker.thread.IsAlive){
                if(worker.stopping)throw new InvalidOperationException("前灯带快捷键服务正在退出，请稍后重试");
                AwaitWorker(worker,3000);return;
            }
            var current=new Worker();worker=current;
            try{
                current.thread=new Thread(delegate(){RunWorker(current);});
                current.thread.IsBackground=true;current.thread.SetApartmentState(ApartmentState.STA);current.thread.Start();
            }catch{worker=null;throw;}
            AwaitWorker(current,3000);
        }
        void Register(bool value){
            if(value)StartWorker();
            var current=worker;Control dispatcher=null;
            if(current!=null)lock(current.gate){if(!current.stopping)dispatcher=current.control;}
            if(dispatcher==null){registered=false;if(value)throw new InvalidOperationException("前灯带快捷键服务已停止，请重试");return;}
            dispatcher.Invoke((Action)delegate(){
                if(current.stopping||disposed){if(value)throw new ObjectDisposedException("StripShortcut");return;}
                if(value&&!current.registered){
                    // VK_F24=0x87; MOD_NOREPEAT prevents a held key from toggling repeatedly.
                    if(!RegisterHotKey(dispatcher.Handle,HotkeyId,0x4000,0x87))throw new InvalidOperationException("F24 已被其他软件占用，无法启用前灯带开关。请解除冲突后再应用。");
                    current.registered=true;
                }else if(!value&&current.registered){UnregisterHotKey(dispatcher.Handle,HotkeyId);current.registered=false;}
                registered=current.registered;
            });
        }
        void Save(){
            string json=new JavaScriptSerializer().Serialize(new Preference{enabled=enabled,effect=resumeEffect,mode=resumeMode});
            var temp=file+".tmp";File.WriteAllText(temp,json);
            if(File.Exists(file)){
                try{File.Replace(temp,file,null);}
                catch(IOException){File.Copy(temp,file,true);try{File.Delete(temp);}catch{}}
            }else File.Move(temp,file);
        }
        public object Configure(bool value){
            lock(gate){
                if(disposed)throw new ObjectDisposedException("StripShortcut");
                bool previous=enabled,wasRegistered=registered;
                try{Register(value);enabled=value;Save();}
                catch{enabled=previous;try{Register(wasRegistered);}catch{}throw;}
                owner=Guid.NewGuid().ToString("N");lastPoll=DateTime.UtcNow;Signal();return State();
            }
        }
        public void Suspend(){lock(gate){if(disposed)return;Register(false);Signal();}}
        public void ExpireIdleLease(){lock(gate){if(!disposed&&registered&&(DateTime.UtcNow-lastPoll).TotalSeconds>45){Register(false);Signal();}}}
        public object Remember(int effect,int mode){
            if(!ValidResume(effect,mode))throw new Exception("前灯带恢复参数不受支持");
            lock(gate){if(disposed)throw new ObjectDisposedException("StripShortcut");resumeEffect=effect;resumeMode=mode;Save();return State();}
        }
        public object Wait(long after,string expectedOwner){
            if(after<0||after>Interlocked.Read(ref sequence))throw new Exception("快捷键序号不正确");
            long version;lock(signalGate)version=signalVersion;
            bool wait;lock(gate){wait=!disposed&&registered&&expectedOwner==owner;if(wait)lastPoll=DateTime.UtcNow;}
            if(wait)lock(signalGate){if(!disposed&&version==signalVersion&&after==Interlocked.Read(ref sequence))Monitor.Wait(signalGate,15000);}
            return State();
        }
        public void Dispose(){
            Worker current;
            lock(gate){if(disposed)return;disposed=true;registered=false;current=worker;worker=null;}
            Signal();StopWorker(current);
            // The worker may still finish a window callback; never Join under gate.
            if(current!=null&&current.thread!=Thread.CurrentThread)current.thread.Join(3000);
        }
    }
}
