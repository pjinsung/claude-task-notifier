#!/bin/bash
INPUT=$(cat)

# Parse transcript: outputs TYPE, ICON, UMSG on separate lines
PARSED=$(echo "$INPUT" | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  let type = 'Task Complete', icon = '[V]', msg = 'Task done';
  try {
    const data = JSON.parse(chunks.join(''));
    const fs = require('fs');
    const fd = fs.openSync(data.transcript_path, 'r');
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, 524288);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, stat.size - size);
    fs.closeSync(fd);
    let raw = buf.toString('utf8');
    if (size < stat.size) raw = raw.substring(raw.indexOf('\\n') + 1);
    const lines = raw.trim().split('\\n');

    const writeTools = new Set(['Edit','Write','Bash','NotebookEdit']);
    const sessionRe = /session.?limit/i;
    let hasQ = false, hasPlan = false, hasSL = false, hasErr = false;
    let usedWrite = false, tools = 0, foundUser = false;

    for (let i = lines.length - 1; i >= 0 && !foundUser; i--) {
      try {
        const o = JSON.parse(lines[i]);
        if (o.isApiErrorMessage) hasErr = true;
        if (o.type === 'user' && o.message && typeof o.message.content === 'string') {
          const t = o.message.content.trim();
          if (t) { msg = t.substring(0, 100).replace(/[\\r\\n]+/g, ' '); foundUser = true; }
        } else if (o.type === 'assistant' && o.message && o.message.content) {
          const c = Array.isArray(o.message.content) ? o.message.content : [o.message.content];
          for (const b of c) {
            if (b.type === 'tool_use') {
              tools++;
              if (writeTools.has(b.name || '')) usedWrite = true;
              if (b.name === 'AskUserQuestion') hasQ = true;
              if (b.name === 'EnterPlanMode') hasPlan = true;
            }
            const txt = typeof b === 'string' ? b : (b.type === 'text' ? b.text || '' : '');
            if (txt && sessionRe.test(txt)) hasSL = true;
          }
        }
      } catch(e) {}
    }

    if (hasErr) { type = 'API Error'; icon = '[!]'; }
    else if (hasSL) { type = 'Session Limit'; icon = '[T]'; }
    else if (hasQ) { type = 'Question'; icon = '[?]'; }
    else if (hasPlan) { type = 'Plan Ready'; icon = '[P]'; }
    else if (tools > 0 && !usedWrite) { type = 'Review Complete'; icon = '[R]'; }
  } catch(e) {}
  process.stdout.write(type + '\\n' + icon + '\\n' + msg);
});
" 2>/dev/null)

# Parse newline-delimited output
if [ -z "$PARSED" ]; then
  TYPE='Task Complete'; ICON='[V]'; UMSG='Task done'
else
  { read -r TYPE; read -r ICON; read -r UMSG; } <<< "$PARSED"
fi

# Sanitize for PowerShell string embedding
UMSG="${UMSG//\'/\'\'}"
UMSG="${UMSG//\`/}"
UMSG="${UMSG//\$/}"

# Get Windows PID (Git Bash $$ is MSYS internal PID, not Windows PID)
CURRENT_PID=$(cat /proc/$$/winpid 2>/dev/null || echo $$)

# Taskbar flash (synchronous - needs process tree while bash is alive)
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "
  \$startPid = ${CURRENT_PID}

  Add-Type -TypeDefinition @'
  using System;
  using System.Runtime.InteropServices;
  public struct FLASHWINFO {
    public uint cbSize; public IntPtr hwnd; public uint dwFlags;
    public uint uCount; public uint dwTimeout;
  }
  public class TaskbarFlash {
    [DllImport(\"user32.dll\")] public static extern bool FlashWindowEx(ref FLASHWINFO fi);
    public static void Flash(IntPtr h) {
      if (h == IntPtr.Zero) return;
      var fi = new FLASHWINFO();
      fi.cbSize = (uint)Marshal.SizeOf(fi); fi.hwnd = h;
      fi.dwFlags = 15; fi.uCount = 0; fi.dwTimeout = 0;
      FlashWindowEx(ref fi);
    }
  }
'@

  \$cpid = \$startPid
  \$hwnd = [IntPtr]::Zero
  for (\$i = 0; \$i -lt 15; \$i++) {
    try {
      \$p = Get-Process -Id \$cpid -EA Stop
      if (\$p.ProcessName -eq 'WindowsTerminal') {
        if (\$p.MainWindowHandle -ne 0) { \$hwnd = \$p.MainWindowHandle }
        break
      }
      \$cpid = (Get-CimInstance Win32_Process -Filter \"ProcessId=\$cpid\" -EA Stop).ParentProcessId
      if (-not \$cpid) { break }
    } catch { break }
  }
  if (\$hwnd -ne [IntPtr]::Zero) { [TaskbarFlash]::Flash(\$hwnd) }
" 2>/dev/null

# Balloon notification (background - 5.5s sleep doesn't block hook)
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "
  Add-Type -AssemblyName System.Windows.Forms
  \$n = New-Object System.Windows.Forms.NotifyIcon
  \$n.Icon = [System.Drawing.SystemIcons]::Information
  \$n.BalloonTipIcon = 'Info'
  \$n.BalloonTipTitle = 'Claude Code - ${TYPE}'
  \$n.BalloonTipText = '${ICON} ${UMSG}'
  \$n.Visible = \$true
  \$n.ShowBalloonTip(5000)
  Start-Sleep -Milliseconds 5500
  \$n.Dispose()
" 2>/dev/null &
