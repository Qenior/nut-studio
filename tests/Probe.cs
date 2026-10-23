using System;
using System.Web.Script.Serialization;
using NutConsole;
class Probe {
    static void Main() {
        var json = new JavaScriptSerializer();
        try {
            HidTransport.Trace = delegate(string line) { Console.Error.WriteLine(line); };
            var devices = HidTransport.Enumerate();
            Console.WriteLine(json.Serialize(devices));
            foreach (var device in devices) {
                if (device.UsagePage != 0xFF60 || device.Usage != 0x61) continue;
                using (var hid = new HidTransport(device)) {
                    byte[][] queries = { new byte[] {1}, new byte[] {0x11}, new byte[] {0x04,0,0,0}, new byte[] {0x04,0,0,14}, new byte[] {0x04,0,1,0}, new byte[] {0x04,0,5,0}, new byte[] {0x04,0,4,14}, new byte[] {0x08,3,1}, new byte[] {0x08,3,2}, new byte[] {0x08,3,3}, new byte[] {0x08,3,4}, new byte[] {0x08,2,1} };
                    foreach (var q in queries) {
                        try { Console.WriteLine(BitConverter.ToString(q) + " => " + BitConverter.ToString(hid.Exchange(q))); }
                        catch (Exception e) { Console.WriteLine(BitConverter.ToString(q) + " => " + e.GetType().Name + ": " + e.Message); }
                    }
                }
            }
        } catch (Exception e) { Console.WriteLine(e.ToString()); Environment.ExitCode = 1; }
    }
}
