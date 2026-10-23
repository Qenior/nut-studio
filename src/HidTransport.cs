using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace NutConsole {
    public sealed class HidDeviceInfo {
        public string Path { get; set; }
        public string Product { get; set; }
        public int VendorId { get; set; }
        public int ProductId { get; set; }
        public int UsagePage { get; set; }
        public int Usage { get; set; }
        public int InputLength { get; set; }
        public int OutputLength { get; set; }
        public int InputReportId { get; set; }
        public int OutputReportId { get; set; }
    }

    // Uses the Windows inbox HID stack. No filter driver or administrator access.
    public sealed class HidTransport : IDisposable {
        public static Action<string> Trace;
        const uint Share = 3, OpenExisting = 3, Overlapped = 0x40000000;
        volatile FileStream stream;
        volatile bool closing;
        readonly object gate = new object();
        public HidDeviceInfo Device { get; private set; }
        public bool IsClosed { get {return closing||stream==null;} }
        public static List<HidDeviceInfo> Enumerate() {
            var result = new List<HidDeviceInfo>();
            Guid hid; HidD_GetHidGuid(out hid);
            IntPtr set = SetupDiGetClassDevs(ref hid, null, IntPtr.Zero, 0x12);
            if (set == new IntPtr(-1)) throw new Win32Exception();
            try {
                for (uint index = 0; ; index++) {
                    var item = new InterfaceData(); item.Size = Marshal.SizeOf(typeof(InterfaceData));
                    if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref hid, index, ref item)) {
                        if (Marshal.GetLastWin32Error() == 259) break;
                        throw new Win32Exception();
                    }
                    uint needed;
                    SetupDiGetDeviceInterfaceDetail(set, ref item, IntPtr.Zero, 0, out needed, IntPtr.Zero);
                    if(needed<6||needed>65536)continue;
                    IntPtr detail = Marshal.AllocHGlobal((int)needed);
                    try {
                        Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
                        if (!SetupDiGetDeviceInterfaceDetail(set, ref item, detail, needed, out needed, IntPtr.Zero)) continue;
                        string path = Marshal.PtrToStringUni(IntPtr.Add(detail, 4));
                        // Never open any other vendor's hardware.
                        if (path.IndexOf("vid_342d&pid_e545", StringComparison.OrdinalIgnoreCase) < 0) continue;
                        using (var handle = CreateFile(path, 0, Share, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero)) {
                            if (handle.IsInvalid) { if (Trace != null) Trace("Open metadata error: " + Marshal.GetLastWin32Error()); continue; }
                            var attrs = new Attributes(); attrs.Size = Marshal.SizeOf(typeof(Attributes));
                            if (!HidD_GetAttributes(handle, ref attrs)) continue;
                            IntPtr data;
                            if (!HidD_GetPreparsedData(handle, out data)) continue;
                            try {
                                Caps caps;
                                if (HidP_GetCaps(data, out caps) < 0) continue;
                                var name = new byte[256];
                                string product = HidD_GetProductString(handle, name, name.Length) ? System.Text.Encoding.Unicode.GetString(name).TrimEnd('\0') : "NUT65 CU";
                                var info = new HidDeviceInfo { Path = path, Product = product, VendorId = attrs.VendorId, ProductId = attrs.ProductId, UsagePage = caps.UsagePage, Usage = caps.Usage, InputLength = caps.Input, OutputLength = caps.Output, InputReportId = GetReportId(data,0,caps.InputValues), OutputReportId = GetReportId(data,1,caps.OutputValues) };
                                if (Trace != null) Trace("HID VID=342D PID=E545 usage=" + info.UsagePage.ToString("X4") + ":" + info.Usage.ToString("X4") + " input=" + info.InputLength + " output=" + info.OutputLength + " inputReportId=" + info.InputReportId + " outputReportId=" + info.OutputReportId);
                                result.Add(info);
                            } finally { HidD_FreePreparsedData(data); }
                        }
                    } finally { Marshal.FreeHGlobal(detail); }
                }
            } finally { SetupDiDestroyDeviceInfoList(set); }
            return result;
        }

        public HidTransport(HidDeviceInfo device) {
            ValidateDevice(device);
            var handle = CreateFile(device.Path, 0xC0000000, Share, IntPtr.Zero, OpenExisting, Overlapped, IntPtr.Zero);
            if (handle.IsInvalid) { int error=Marshal.GetLastWin32Error();handle.Dispose();throw new Win32Exception(error,"无法打开键盘（Windows 错误 " + error + "）；请关闭 VIA 或其他键盘控制软件后重试。"); }
            // Disable FileStream buffering: preserve one write per HID report.
            try{stream = new FileStream(handle, FileAccess.ReadWrite, 1, true);}
            catch{handle.Dispose();throw;}
            Device = device;
        }

        public static void ValidateDevice(HidDeviceInfo device) {
            if(device==null)throw new ArgumentNullException("device");
            if (device.VendorId != 0x342D || device.ProductId != 0xE545 || device.UsagePage != 0xFF60 || device.Usage != 0x61)
                throw new InvalidOperationException("所选接口不是 NUT65 CU 的 VIA 通信接口。");
            if (device.InputLength < 33 || device.InputLength > 513 || device.OutputLength < 33 || device.OutputLength > 513)
                throw new InvalidOperationException("设备报告的 HID 长度暂不支持（输入 " + device.InputLength + "，输出 " + device.OutputLength + " 字节，含报告编号）。请提供 data/connection.log。");
            if(device.InputReportId<0||device.InputReportId>255||device.OutputReportId<0||device.OutputReportId>255)throw new InvalidOperationException("HID 报告编号不正确。");
        }
        public static byte[] FrameOutput(byte[] command,int reportLength,int reportId) {
            if(command==null||command.Length==0||command.Length>32||reportLength<33||reportLength>513||reportId<0||reportId>255)throw new ArgumentException("Invalid HID output framing");
            var output=new byte[reportLength];output[0]=(byte)reportId;Array.Copy(command,0,output,1,command.Length);return output;
        }
        public static byte[] NormalizeInput(byte[] input,int length,int reportId) {
            if(input==null||length<33||length>input.Length||length>513||input[0]!=reportId)throw new IOException("键盘返回的 HID 数据长度或报告编号不正确。");
            var result=new byte[32];Array.Copy(input,1,result,0,32);return result;
        }
        static int GetReportId(IntPtr preparsed,int type,ushort capacity) {
            if(capacity==0||capacity>256)return 0;
            // HIDP_VALUE_CAPS is a 72-byte Windows ABI structure. ReportID is
            // at offset 2, BitSize at 18, and ReportCount at 20.
            IntPtr records=Marshal.AllocHGlobal(capacity*72);
            try {
                ushort count=capacity;if(HidP_GetValueCaps(type,records,ref count,preparsed)<0||count>capacity)return 0;
                int selected=0,best=-1;
                for(int i=0;i<count;i++) {
                    IntPtr record=IntPtr.Add(records,i*72);
                    int bits=(ushort)Marshal.ReadInt16(record,18)*(ushort)Marshal.ReadInt16(record,20),id=Marshal.ReadByte(record,2);
                    if(bits>=256&&(bits>best||(bits==best&&id==0))){selected=id;best=bits;}
                }
                return selected;
            } finally {Marshal.FreeHGlobal(records);}
        }

        public byte[] Exchange(params byte[] command) {
            lock (gate) {
                var current=stream;
                if (closing||current == null) throw new IOException("键盘连接已关闭，请重新连接。");
                if (command==null||command.Length == 0 || command.Length > 32) throw new ArgumentException("Invalid report length");
                var output = FrameOutput(command,Device.OutputLength,Device.OutputReportId);
                try {
                    bool configuration=command[0]>=7&&command[0]<=9;
                    if(Trace!=null)Trace("TX command="+command[0].ToString("X2")+" bytes="+output.Length+" reportId="+Device.OutputReportId+(configuration?" config="+BitConverter.ToString(command):""));
                    var write = current.WriteAsync(output, 0, output.Length);
                    WaitIo(write,current,output,"键盘写入超时，请重新连接。");
                    for (int attempt = 0; attempt < 6; attempt++) {
                        if(closing)throw new IOException("键盘连接已关闭，请重新连接。");
                        var input = new byte[Device.InputLength];
                        var read = current.ReadAsync(input, 0, input.Length);
                        WaitIo(read,current,input,"键盘没有响应（输入报告 "+Device.InputLength+" 字节，编号 "+Device.InputReportId+"），请确认有线模式并关闭 VIA。");
                        if(closing)throw new IOException("键盘连接已关闭，请重新连接。");
                        if(Trace!=null)Trace("RX bytes="+read.Result+" reportId="+input[0]);
                        if(read.Result>0&&input[0]!=Device.InputReportId)continue;
                        var payload = NormalizeInput(input,read.Result,Device.InputReportId);
                        if(configuration&&Trace!=null)Trace("RX config="+BitConverter.ToString(payload,0,8));
                        if (payload[0] == 0xFF) throw new NotSupportedException("当前固件不支持此 VIA 指令。");
                        if (payload[0] == command[0]) return payload;
                    }
                    throw new IOException("键盘返回了不匹配的指令，请关闭其他键盘控制软件。");
                } catch (NotSupportedException) { throw; }
                catch { Dispose(); throw; }
            }
        }
        void WaitIo(Task pending,FileStream current,byte[] buffer,string timeoutMessage){
            if(pending.Wait(1800))return;
            closing=true;stream=null;
            CancelIo(current);
            RetireIo(pending,current,buffer);
            throw new TimeoutException(timeoutMessage);
        }
        // CancelIoEx only requests cancellation. Keep this operation's stream and
        // buffer alive, observe any late fault, and release them after completion.
        static void RetireIo(Task pending,IDisposable resource,object buffer){
            pending.ContinueWith(delegate(Task completed){
                try{if(completed.IsFaulted){var error=completed.Exception;}}
                finally{try{resource.Dispose();}catch{}GC.KeepAlive(buffer);}
            },CancellationToken.None,TaskContinuationOptions.ExecuteSynchronously,TaskScheduler.Default);
        }
        static void CancelIo(FileStream current){
            if(current==null)return;
            try{CancelIoEx(current.SafeFileHandle,IntPtr.Zero);}catch(ObjectDisposedException){}catch(IOException){}
        }
        public void CancelPending(){closing=true;CancelIo(stream);}
        public void Dispose() {
            CancelPending();
            lock(gate){var current=stream;stream=null;if(current!=null)current.Dispose();}
        }

        [StructLayout(LayoutKind.Sequential)] struct InterfaceData { public int Size; public Guid ClassGuid; public int Flags; public IntPtr Reserved; }
        [StructLayout(LayoutKind.Sequential)] struct Attributes { public int Size; public ushort VendorId, ProductId, Version; }
        [StructLayout(LayoutKind.Sequential)] struct Caps {
            public ushort Usage, UsagePage, Input, Output, Feature;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
            public ushort LinkCollections, InputButtons, InputValues, InputIndices, OutputButtons, OutputValues, OutputIndices, FeatureButtons, FeatureValues, FeatureIndices;
        }
        [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid guid);
        [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle handle, ref Attributes attrs);
        [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle handle, out IntPtr data);
        [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr data);
        [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr data, out Caps caps);
        [DllImport("hid.dll")] static extern int HidP_GetValueCaps(int reportType,IntPtr caps,ref ushort count,IntPtr data);
        [DllImport("hid.dll")] static extern bool HidD_GetProductString(SafeFileHandle handle, byte[] buffer, int length);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(ref Guid guid, string enumerator, IntPtr parent, uint flags);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr device, ref Guid guid, uint index, ref InterfaceData data);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref InterfaceData data, IntPtr detail, uint size, out uint needed, IntPtr device);
        [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool CancelIoEx(SafeFileHandle handle,IntPtr overlapped);
    }
}
