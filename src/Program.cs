using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace NutConsole {
    static class Program {
        const string AppVersion="1.1.5";
        const int MaxClients=32, MaxHeaderBytes=16384, MaxBodyBytes=262144, RequestReadMilliseconds=10000;
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 524288 };
        static readonly object DeviceGate = new object();
        static readonly object DiagnosticGate = new object();
        static readonly object ConfigGate = new object();
        static readonly object ClientsGate = new object();
        static readonly HashSet<TcpClient> Clients = new HashSet<TcpClient>();
        static readonly CancellationTokenSource Shutdown = new CancellationTokenSource();
        static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
        static readonly string Data = Path.Combine(Root, "data");
        static readonly string Token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        static HidTransport hid;
        static StripShortcut stripShortcut;
        static int layers, protocol, port;
        static readonly int[] cuValues = {-1,-1,-1,-1};
        static bool cuDetected,cuBatteryObserved;
        static string origin;
        static volatile bool running = true;
        static long lastSeenTicks = DateTime.UtcNow.Ticks;
        static TcpListener listener;
        [STAThread] static void Main(string[] args) {
            try {
                Directory.CreateDirectory(Data);
                LogDiagnostic("NUT Studio v"+AppVersion+" started");
                HidTransport.Trace=LogDiagnostic;
                bool created;
                using (var mutex = new Mutex(true, "Local\\NUTStudio342DE545", out created)) {
                    if (!created) {
                        var runtime = Path.Combine(Data, "session.json");
                        bool opened=false;
                        try {
                            string previousUrl;
                            if (File.Exists(runtime)&&TrySessionUrl(Json.Deserialize<Dictionary<string, object>>(ReadBoundedText(runtime,4096)),out previousUrl)) {OpenWindow(previousUrl);opened=true;}
                        } catch(Exception error) {LogDiagnostic("Previous session could not be reopened: "+error.Message);}
                        if(!opened&&!args.Contains("--serve"))MessageBox.Show("已有 NUT Studio 在运行。请先在旧版本中点击“使用帮助 → 退出软件”，再启动 v"+AppVersion+" 修复版。","NUT Studio",MessageBoxButtons.OK,MessageBoxIcon.Information);
                        return;
                    }
                    Task watchdog=null;bool sessionWritten=false;
                    try {
                        listener = new TcpListener(IPAddress.Loopback, 38165);
                        try { listener.Start(); } catch (SocketException) {listener.Stop();listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); }
                        port = ((IPEndPoint)listener.LocalEndpoint).Port;
                        stripShortcut=new StripShortcut(Path.Combine(Data,"strip-shortcut.json"));
                        origin = "http://127.0.0.1:" + port;
                        string url = origin + "/" + Token + "/";
                        int pid;using(var current=Process.GetCurrentProcess())pid=current.Id;
                        WriteTextAtomic(Path.Combine(Data,"session.json"),Json.Serialize(new {url=url,pid=pid,port=port,version=AppVersion}),4096);
                        sessionWritten=true;
                        if (!args.Contains("--serve")) OpenWindow(url);
                        watchdog = Task.Run(async delegate {
                            try {
                                while (running) {
                                    await Task.Delay(15000,Shutdown.Token);
                                    stripShortcut.ExpireIdleLease();
                                    if ((DateTime.UtcNow-new DateTime(Interlocked.Read(ref lastSeenTicks),DateTimeKind.Utc)).TotalMinutes>4)BeginShutdown();
                                }
                            } catch(OperationCanceledException) { }
                            catch(Exception error) {LogDiagnostic("Watchdog failed: "+error.Message);BeginShutdown();}
                        });
                        while (running) {
                            TcpClient client;
                            try { client = listener.AcceptTcpClient(); } catch (SocketException) { if(running)throw;break; }
                            if(!TryTrackClient(client)){client.Close();continue;}
                            try {Task.Run(delegate {try{Handle(client);}finally{lock(ClientsGate)Clients.Remove(client);}});}
                            catch {lock(ClientsGate)Clients.Remove(client);client.Close();throw;}
                        }
                    } finally {
                        BeginShutdown();
                        TcpClient[] pending;lock(ClientsGate)pending=Clients.ToArray();
                        foreach(var client in pending){try{client.Close();}catch{}}
                        var activeHid=hid;if(activeHid!=null)activeHid.CancelPending();
                        try {lock(DeviceGate){if(hid!=null){hid.Dispose();hid=null;}}}
                        finally {
                            try {if(stripShortcut!=null)stripShortcut.Dispose();}
                            finally {
                                if(watchdog!=null){try{watchdog.Wait(1000);}catch{}}
                                if(sessionWritten){try{File.Delete(Path.Combine(Data,"session.json"));}catch{}}
                                HidTransport.Trace=null;
                                mutex.ReleaseMutex();
                            }
                        }
                    }
                }
            } catch (Exception e) {
                try { File.WriteAllText(Path.Combine(Root,"startup-error.log"), RedactDiagnostic(e.ToString()), Encoding.UTF8); } catch { }
                if (!args.Contains("--serve")) MessageBox.Show(e.Message, "NUT Studio", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        static void OpenWindow(string url) {
            string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe");
            if (!File.Exists(edge)) edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe");
            var start=!File.Exists(edge)?new ProcessStartInfo(url){UseShellExecute=true}:new ProcessStartInfo(edge,"--app=\""+url+"\" --window-size=1440,980"){UseShellExecute=false,CreateNoWindow=true};
            using(var launched=Process.Start(start)){ }
        }

        static void BeginShutdown(){running=false;Shutdown.Cancel();try{if(listener!=null)listener.Stop();}catch(SocketException){}}
        static bool TryTrackClient(TcpClient client){lock(ClientsGate){if(!running||Clients.Count>=MaxClients)return false;Clients.Add(client);return true;}}
        static bool TrySessionUrl(Dictionary<string,object> value,out string url){
            url=null;object savedUrl,savedPort,savedPid,savedVersion;
            if(value==null||value.Count!=4||!value.TryGetValue("url",out savedUrl)||!(savedUrl is string)||!value.TryGetValue("port",out savedPort)||!(savedPort is int)||!value.TryGetValue("pid",out savedPid)||!(savedPid is int)||!value.TryGetValue("version",out savedVersion)||!(savedVersion is string)||(string)savedVersion!=AppVersion)return false;
            string candidate=(string)savedUrl;int number=(int)savedPort;Uri parsed;
            if(candidate.Length>256||number<1||number>65535||(int)savedPid<=0||!Uri.TryCreate(candidate,UriKind.Absolute,out parsed)||parsed.Scheme!="http"||parsed.Host!="127.0.0.1"||parsed.Port!=number||parsed.UserInfo!=""||parsed.Query!=""||parsed.Fragment!="")return false;
            if(!Regex.IsMatch(candidate,"\\Ahttp://127\\.0\\.0\\.1:"+number+"/[a-fA-F0-9]{64}/\\z"))return false;
            url=candidate;return true;
        }
        static string ReadBoundedText(string file,int maximum){
            using(var input=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read)){
                if(input.Length>maximum)throw new IOException("配置文件过大，请保留文件并检查内容。");
                using(var reader=new StreamReader(input,Encoding.UTF8,true))return reader.ReadToEnd();
            }
        }
        static void WriteTextAtomic(string file,string text,int maximum){
            if(Encoding.UTF8.GetByteCount(text)>maximum)throw new IOException("配置内容过大，未写入文件。");
            lock(ConfigGate){
                string temp=file+".tmp";
                try{File.WriteAllText(temp,text,new UTF8Encoding(false));if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);}
                finally{try{if(File.Exists(temp))File.Delete(temp);}catch{}}
            }
        }
        static int ReadRequestChunk(NetworkStream stream,byte[] bytes,int offset,int count,Stopwatch clock){
            long remaining=RequestReadMilliseconds-clock.ElapsedMilliseconds;
            if(remaining<=0)throw new IOException("Request read deadline exceeded");
            stream.ReadTimeout=(int)Math.Min(6000,remaining);
            int read=stream.Read(bytes,offset,count);
            if(read==0)throw new IOException("Incomplete request");
            return read;
        }
        static string ReadRequestHead(NetworkStream stream,Stopwatch clock,out byte[] buffer,out int bodyOffset,out int bufferedBody){
            buffer=new byte[MaxHeaderBytes];int used=0,scan=0;bodyOffset=bufferedBody=0;
            while(used<buffer.Length){
                used+=ReadRequestChunk(stream,buffer,used,buffer.Length-used,clock);
                for(;scan<=used-4;scan++)if(buffer[scan]==13&&buffer[scan+1]==10&&buffer[scan+2]==13&&buffer[scan+3]==10){bodyOffset=scan+4;bufferedBody=used-bodyOffset;return Encoding.ASCII.GetString(buffer,0,bodyOffset);}
            }
            throw new IOException("请求头过长");
        }

        static void Handle(TcpClient client) {
            using (client) {
                client.ReceiveTimeout = 6000; client.SendTimeout = 6000;
                try {
                    var stream = client.GetStream();
                    var requestClock=Stopwatch.StartNew();byte[] buffered;int bodyOffset,bufferedBody;
                    var lines = ReadRequestHead(stream,requestClock,out buffered,out bodyOffset,out bufferedBody).Split(new[] {"\r\n"}, StringSplitOptions.None);
                    var first = lines[0].Split(' ');
                    if (first.Length < 3) return;
                    var headers = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                    foreach (string line in lines.Skip(1)) { int p = line.IndexOf(':'); if (p > 0) {string name=line.Substring(0,p);if(headers.ContainsKey(name))throw new IOException("Duplicate header");headers[name]=line.Substring(p+1).Trim();} }
                    if(headers.ContainsKey("Transfer-Encoding"))throw new IOException("Unsupported request encoding");
                    string host;
                    if (!headers.TryGetValue("Host", out host) || host != "127.0.0.1:" + port) { Reply(stream,403,"text/plain","Forbidden"); return; }
                    string incomingOrigin;
                    if (headers.TryGetValue("Origin", out incomingOrigin) && incomingOrigin != origin) { Reply(stream,403,"text/plain","Forbidden origin");return; }
                    string fetchSite;
                    if (headers.TryGetValue("Sec-Fetch-Site", out fetchSite) && fetchSite == "cross-site") { Reply(stream,403,"text/plain","Forbidden site");return; }
                    string prefix = "/" + Token + "/", path = first[1].Split('?')[0];
                    if (!path.StartsWith(prefix, StringComparison.Ordinal)) { Reply(stream,404,"text/plain","Not found");return; }
                    path = path.Substring(prefix.Length);
                    if (first[0] == "GET") {
                        string resource, type;
                        switch(path) {
                            case "": resource="index.html";type="text/html; charset=utf-8";break;
                            case "style.css": resource="style.css";type="text/css; charset=utf-8";break;
                            case "core.js": resource="core.js";type="application/javascript; charset=utf-8";break;
                            case "app.js": resource="app.js";type="application/javascript; charset=utf-8";break;
                            case "seed.json": resource="seed.json";type="application/json; charset=utf-8";break;
                            case "favicon.svg": resource="favicon.svg";type="image/svg+xml";break;
                            case "docs/THIRD-PARTY-NOTICES.md": resource="notices.md";type="text/plain; charset=utf-8";break;
                            default: Reply(stream,404,"text/plain","Not found");return;
                        }
                        using (var embedded = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)) {
                            using (var reader = new StreamReader(embedded, Encoding.UTF8)) { Reply(stream,200,type,reader.ReadToEnd().Replace("__NUT_TOKEN__", Token)); }
                        }
                        return;
                    }
                    string auth, contentType;
                    if (first[0] != "POST" || !headers.TryGetValue("X-Nut-Token",out auth) || auth != Token || !headers.TryGetValue("Content-Type",out contentType) || !contentType.StartsWith("application/json")) {Reply(stream,403,"text/plain","Forbidden");return;}
                    string length; int count;
                    if (!headers.TryGetValue("Content-Length",out length) || !int.TryParse(length,out count) || count<0 || count>MaxBodyBytes) {Reply(stream,400,"text/plain","Invalid size");return;}
                    var bytes = new byte[count]; int read=Math.Min(count,bufferedBody);
                    Array.Copy(buffered,bodyOffset,bytes,0,read);
                    while (read < count)read+=ReadRequestChunk(stream,bytes,read,count-read,requestClock);
                    var payload = Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(bytes)) ?? new Dictionary<string,object>();
                    Interlocked.Exchange(ref lastSeenTicks,DateTime.UtcNow.Ticks);
                    try { var result = Api(path,payload); Reply(stream,200,"application/json; charset=utf-8",Json.Serialize(new {ok=true,data=result})); }
                    catch(Exception e) { var msg=e.GetBaseException().Message;LogDiagnostic(path+" failed: "+msg); Reply(stream,200,"application/json; charset=utf-8",Json.Serialize(new {ok=false,error=msg})); }
                } catch { /* Malformed requests have no device side effects. */ }
            }
        }
        static object Api(string path, Dictionary<string,object> payload) {
            if(!running||Shutdown.IsCancellationRequested)throw new OperationCanceledException("NUT Studio 正在退出。");
            if(path=="api/ping")return new {version=AppVersion,connected=hid!=null};
            if(path=="api/shortcut/state")return stripShortcut.State();
            if(path=="api/shortcut/wait")return stripShortcut.Wait(Convert.ToInt64(payload["after"]),Convert.ToString(payload["owner"]));
            if(path=="api/shortcut/remember")return stripShortcut.Remember(Convert.ToInt32(payload["effect"]),Convert.ToInt32(payload["mode"]));
            if(path=="api/shortcut/suspend"){stripShortcut.Suspend();return stripShortcut.State();}
            if(path=="api/shortcut/configure"){
                if(!payload.ContainsKey("enabled")||!(payload["enabled"] is bool))throw new Exception("快捷键设置不正确");
                bool enable=(bool)payload["enabled"];
                lock(DeviceGate){if(!running||Shutdown.IsCancellationRequested)throw new OperationCanceledException("NUT Studio 正在退出。");if(enable&&(hid==null||!cuDetected))throw new Exception("前灯带开关需要 Windows 直接连接并识别 CU 固件");return stripShortcut.Configure(enable);}
            }
            if(path=="api/diagnostic") {
                object message;if(payload.TryGetValue("message",out message)&&message is string)LogDiagnostic(((string)message).Substring(0,Math.Min(4096,((string)message).Length)));
                return true;
            }
            if(path=="api/diagnostics/read") {
                lock(DiagnosticGate){var log=Path.Combine(Data,"connection.log");return File.Exists(log)?RedactDiagnostic(ReadBoundedText(log,1048576)):"NUT Studio v"+AppVersion+"\n暂无连接记录";}
            }
            if(path=="api/quit") {Task.Run(async delegate {try{await Task.Delay(300,Shutdown.Token);BeginShutdown();}catch(OperationCanceledException){}});return true;}
            if(path=="api/profiles/read") {
                var file=Path.Combine(Data,"profiles.json");
                lock(ConfigGate)return File.Exists(file)?Json.DeserializeObject(ReadBoundedText(file,524288)):new object[0];
            }
            if(path=="api/profiles/write") {
                object value;
                if(!payload.TryGetValue("profiles",out value)||!(value is ArrayList)||((ArrayList)value).Count>50)throw new Exception("方案格式不正确，最多保存 50 个方案");
                Directory.CreateDirectory(Data);
                WriteTextAtomic(Path.Combine(Data,"profiles.json"),Json.Serialize(value),524288);
                return true;
            }
            if(path=="api/backup") {
                object backup;
                if(!payload.TryGetValue("profile",out backup))throw new Exception("缺少备份内容");
                var profile=backup as Dictionary<string,object>;
                if(profile==null||!profile.ContainsKey("vendorProductId")||Convert.ToInt64(profile["vendorProductId"])!=875423045)throw new Exception("备份设备不匹配");
                var folder=Path.Combine(Data,"backups");Directory.CreateDirectory(folder);
                string name="NUT65CU-"+DateTime.Now.ToString("yyyyMMdd-HHmmss-fff")+"-"+Guid.NewGuid().ToString("N").Substring(0,6)+".json";
                File.WriteAllText(Path.Combine(folder,name),Json.Serialize(profile),new UTF8Encoding(false));
                return new {filename=name};
            }
            lock(DeviceGate) {
                if(!running||Shutdown.IsCancellationRequested)throw new OperationCanceledException("NUT Studio 正在退出。");
                if(path=="api/connect") {
                    stripShortcut.Suspend();
                    if(hid!=null){hid.Dispose();hid=null;}
                    var devices=HidTransport.Enumerate();
                    LogDiagnostic("Enumerated target HID collections: "+devices.Count);
                    var device=devices.Where(d=>d.UsagePage==0xFF60&&d.Usage==0x61).OrderByDescending(d=>d.InputLength>=33&&d.OutputLength>=33).FirstOrDefault();
                    if(device==null)throw new Exception("暂时无法访问 NUT65 CU。请确认 USB 有线模式，关闭 VIA 后重新连接；也可选择浏览器 USB 连接。");
                    hid=new HidTransport(device);layers=0;protocol=0;ResetCuDetection();
                    return new {name=device.Product,vid=device.VendorId,pid=device.ProductId,transport="Windows HID",inputLength=device.InputLength,outputLength=device.OutputLength,inputReportId=device.InputReportId,outputReportId=device.OutputReportId};
                }
                if(path=="api/disconnect") {stripShortcut.Suspend();if(hid!=null){hid.Dispose();hid=null;}ResetCuDetection();return true;}
                if(path!="api/exchange")throw new Exception("未知操作");
                if(hid==null)throw new Exception("请先连接键盘");
                object raw;if(!payload.TryGetValue("bytes",out raw))throw new Exception("缺少通信数据");
                var list=raw as ArrayList;
                if(list==null||list.Count<1||list.Count>32)throw new Exception("通信数据长度不正确");
                var command=new byte[list.Count];
                for(int i=0;i<list.Count;i++){int v=Convert.ToInt32(list[i]);if(v<0||v>255)throw new Exception("通信数据超出范围");command[i]=(byte)v;}
                ValidateCommand(command);
                byte[] response;
                try{response=hid.Exchange(command);}
                catch{if(hid.IsClosed){hid.Dispose();hid=null;stripShortcut.Suspend();ResetCuDetection();}throw;}
                if(command[0]==1){stripShortcut.Suspend();ResetCuDetection();}
                if(command[0]==1)protocol=(response[1]<<8)|response[2];
                if(command[0]==0x11)layers=response[1];
                ObserveCuResponse(command,response);
                return response.Select(v=>(int)v).ToArray();
            }
        }
        static void LogDiagnostic(string message) {
            try {
                string safe=RedactDiagnostic(message??"");if(safe.Length>4096)safe=safe.Substring(0,4096)+" [truncated]";
                lock(DiagnosticGate){Directory.CreateDirectory(Data);string file=Path.Combine(Data,"connection.log");if(File.Exists(file)&&new FileInfo(file).Length>262144)File.WriteAllText(file,"NUT Studio v"+AppVersion+"\r\n",new UTF8Encoding(false));File.AppendAllText(file,DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff")+" "+safe+"\r\n",new UTF8Encoding(false));}
            }catch { /* Diagnostics must never block device I/O. */ }
        }
        static string RedactDiagnostic(string text){
            if(String.IsNullOrEmpty(text))return text;
            text=text.Replace(Token,"[session]");
            text=Regex.Replace(text,@"(?i)\bhttps?://(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/[a-f0-9]{32,128}(?:/[^\s""<>]*)?","[local session]");
            text=Regex.Replace(text,@"(?i)\b[a-f0-9]{64}\b","[token]");
            text=Regex.Replace(text,@"(?i)([""']?(?:x-nut-token|token|authorization|password|secret|api[_-]?key)[""']?\s*[:=]\s*)(?:""(?:\\.|[^""\\])*""|'(?:\\.|[^'\\])*'|[^\r\n,;}]+)","$1[redacted]");
            text=Regex.Replace(text,@"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b","[email]");
            // Paths may contain spaces. Redact through the next quote or line end.
            text=Regex.Replace(text,@"(?i)(?:(?<![\p{L}\p{N}])[A-Z]:[\\/]|\\\\)[^""<>\r\n]*","[local path]");
            string user=Environment.UserName;
            if(!String.IsNullOrEmpty(user))text=Regex.Replace(text,@"(?i)(?<![\p{L}\p{N}_])"+Regex.Escape(user)+@"(?![\p{L}\p{N}_])","[user]");
            return text;
        }
        static void ValidateCommand(byte[] c) {
            switch(c[0]) {
                case 1: case 0x11: if(c.Length!=1)throw new Exception("无效查询");return;
                case 4: case 5:
                    if(c.Length!=(c[0]==4?4:6)||c[1]>=layers||c[2]>=5||c[3]>=15||protocol<7||protocol>12)throw new Exception("键位坐标或协议不正确");
                    if(c[0]==5&&((c[2]==2&&c[3]==12)||(c[2]==3&&c[3]==1)||(c[2]==4&&!(new[]{0,1,2,5,10,11,12,13,14}).Contains((int)c[3]))))throw new Exception("不能写入未使用的矩阵位置");
                    return;
                case 7: case 8:
                    if(c.Length<3||c[2]<1||c[2]>4||protocol<11||protocol>12)throw new Exception("配置通道不正确");
                    if(c[1]==0){
                        if(c.Length!=(c[0]==8?3:4))throw new Exception("设备功能数据长度不正确");
                        if(c[0]==7&&(!cuDetected||!ValidCuValue(c[2],c[3],cuBatteryObserved)))throw new Exception("尚未识别 CU 固件或设备功能参数不受支持");
                        return;
                    }
                    if(c[1]!=3)throw new Exception("灯光通道不正确");
                    if(c.Length!=(c[0]==8?3:c[2]==4?5:4))throw new Exception("灯光数据长度不正确");
                    // CU value 22 is the physical-shortcut off state, absent from
                    // the published menu but needed for snapshots and rollback.
                    if(c[0]==7&&c[2]==2&&(cuDetected?c[3]>36:c[3]>45))throw new Exception("灯效编号超出范围");return;
                case 9: if(c.Length!=2||protocol<11||protocol>12||!(c[1]==3||(c[1]==0&&cuDetected)))throw new Exception("无效配置保存操作");return;
                default:throw new Exception("此指令不在允许范围内");
            }
        }
        static void ResetCuDetection(){for(int i=0;i<4;i++)cuValues[i]=-1;cuDetected=false;cuBatteryObserved=false;}
        static bool ValidCuValue(int id,int value,bool allowBattery){
            switch(id){
                case 1:return value>=0&&value<=10;
                case 2:return value>=5&&value<=35&&value%5==0;
                case 3:return value==5||value==10;
                case 4:return value==0||value==1||value==3||value==4||(allowBattery&&value==2);
                default:return false;
            }
        }
        static void ObserveCuResponse(byte[] command,byte[] response){
            if(command.Length!=3||command[0]!=8||command[1]!=0||command[2]<1||command[2]>4)return;
            if(response.Length<4||response[0]!=8||response[1]!=0||response[2]!=command[2])return;
            cuValues[command[2]-1]=response[3];
            if(command[2]==4&&response[3]==2)cuBatteryObserved=true;
            // Only a complete, valid read-only probe unlocks the custom writes.
            cuDetected=Enumerable.Range(1,4).All(id=>ValidCuValue(id,cuValues[id-1],true));
        }
        static void Reply(NetworkStream stream,int code,string type,string text) {
            byte[] body=Encoding.UTF8.GetBytes(text);
            string header="HTTP/1.1 "+code+" "+(code==200?"OK":"Error")+"\r\nContent-Type: "+type+"\r\nContent-Length: "+body.Length+"\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Resource-Policy: same-origin\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'\r\n\r\n";
            var head=Encoding.ASCII.GetBytes(header);stream.Write(head,0,head.Length);stream.Write(body,0,body.Length);
        }
    }
}
