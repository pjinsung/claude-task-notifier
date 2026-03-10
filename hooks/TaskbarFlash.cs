using System;
using System.Runtime.InteropServices;

public struct FLASHWINFO {
    public uint cbSize;
    public IntPtr hwnd;
    public uint dwFlags;
    public uint uCount;
    public uint dwTimeout;
}

public class TaskbarFlash {
    [DllImport("user32.dll")]
    public static extern bool FlashWindowEx(ref FLASHWINFO fi);

    public static void Flash(IntPtr h) {
        if (h == IntPtr.Zero) return;
        var fi = new FLASHWINFO();
        fi.cbSize = (uint)Marshal.SizeOf(fi);
        fi.hwnd = h;
        fi.dwFlags = 15;
        fi.uCount = 0;
        fi.dwTimeout = 0;
        FlashWindowEx(ref fi);
    }
}
