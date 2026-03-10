#!/bin/bash
INPUT=$(cat)

RESULT=$(echo "$INPUT" | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(chunks.join(''));
    const fs = require('fs');
    const lines = fs.readFileSync(data.transcript_path, 'utf8').trim().split('\n');

    let userMsg = 'Task done';
    const activeTools = new Set();
    const readTools = new Set(['Read','Grep','Glob','Explore']);
    const writeTools = new Set(['Edit','Write','Bash','NotebookEdit']);
    let hasQuestion = false;
    let hasPlan = false;
    let hasSessionLimit = false;
    let hasApiError = false;
    let usedWriteTools = false;
    let usedReadOnly = false;
    let lastUserIdx = -1;

    // Find last user message index
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'user' && obj.message && typeof obj.message.content === 'string' && obj.message.content.trim()) {
          userMsg = obj.message.content.trim();
          lastUserIdx = i;
          break;
        }
      } catch(e) {}
    }

    // Analyze entries after last user message
    for (let i = Math.max(0, lastUserIdx); i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);

        // Check tool usage in assistant messages
        if (obj.type === 'assistant' && obj.message && obj.message.content) {
          const content = Array.isArray(obj.message.content) ? obj.message.content : [obj.message.content];
          for (const block of content) {
            if (block.type === 'tool_use') {
              const name = block.name || '';
              activeTools.add(name);
              if (writeTools.has(name)) usedWriteTools = true;
              if (name === 'AskUserQuestion') hasQuestion = true;
              if (name === 'EnterPlanMode') hasPlan = true;
            }
            // Check text for session limit
            if (typeof block === 'string' && /session.?limit/i.test(block)) hasSessionLimit = true;
            if (block.type === 'text' && /session.?limit/i.test(block.text || '')) hasSessionLimit = true;
          }
        }

        // Check for API errors
        if (obj.isApiErrorMessage || (obj.type === 'system' && /error|rate.?limit|unauthorized/i.test(JSON.stringify(obj)))) {
          hasApiError = true;
        }
      } catch(e) {}
    }

    usedReadOnly = activeTools.size > 0 && !usedWriteTools;

    // Classify notification type
    let type, icon;
    if (hasApiError) {
      type = 'API Error'; icon = '[!]';
    } else if (hasSessionLimit) {
      type = 'Session Limit'; icon = '[T]';
    } else if (hasQuestion) {
      type = 'Question'; icon = '[?]';
    } else if (hasPlan) {
      type = 'Plan Ready'; icon = '[P]';
    } else if (usedReadOnly) {
      type = 'Review Complete'; icon = '[R]';
    } else {
      type = 'Task Complete'; icon = '[V]';
    }

    process.stdout.write(JSON.stringify({ type, icon, userMsg: userMsg.substring(0, 100) }));
  } catch(e) {
    process.stdout.write(JSON.stringify({ type: 'Task Complete', icon: '[V]', userMsg: 'Task done' }));
  }
});
" 2>/dev/null)

if [ -z "$RESULT" ]; then
  RESULT='{"type":"Task Complete","icon":"[V]","userMsg":"Task done"}'
fi

TYPE=$(echo "$RESULT" | node -e "process.stdin.on('data',d=>{try{process.stdout.write(JSON.parse(d).type)}catch(e){process.stdout.write('Task Complete')}})" 2>/dev/null)
ICON=$(echo "$RESULT" | node -e "process.stdin.on('data',d=>{try{process.stdout.write(JSON.parse(d).icon)}catch(e){process.stdout.write('[V]')}})" 2>/dev/null)
UMSG=$(echo "$RESULT" | node -e "process.stdin.on('data',d=>{try{process.stdout.write(JSON.parse(d).userMsg)}catch(e){process.stdout.write('Task done')}})" 2>/dev/null)

UMSG=$(echo "$UMSG" | sed "s/'/''/g")

powershell.exe -ExecutionPolicy Bypass -Command "
  Add-Type -AssemblyName System.Windows.Forms

  # Flash taskbar orange - find Windows Terminal window
  Add-Type -TypeDefinition @'
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
    [DllImport(\"user32.dll\")] public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);
    public const uint FLASHW_ALL = 3;
    public const uint FLASHW_TIMERNOFG = 12;
    public static void Flash(IntPtr hwnd) {
      if (hwnd == IntPtr.Zero) return;
      FLASHWINFO fi = new FLASHWINFO();
      fi.cbSize = (uint)Marshal.SizeOf(fi);
      fi.hwnd = hwnd;
      fi.dwFlags = FLASHW_ALL | FLASHW_TIMERNOFG;
      fi.uCount = 0;
      fi.dwTimeout = 0;
      FlashWindowEx(ref fi);
    }
  }
'@
  # Find Windows Terminal with Claude in title
  \$wt = Get-Process WindowsTerminal -EA SilentlyContinue | Where-Object { \$_.MainWindowTitle -match 'Claude' -and \$_.MainWindowHandle -ne 0 }
  if (\$wt) { [TaskbarFlash]::Flash(\$wt.MainWindowHandle) }

  # Balloon notification
  \$n = New-Object System.Windows.Forms.NotifyIcon
  \$n.Icon = [System.Drawing.SystemIcons]::Information
  \$n.BalloonTipIcon = 'Info'
  \$n.BalloonTipTitle = 'Claude Code - ${TYPE}'
  \$n.BalloonTipText = '${ICON} ${UMSG}'
  \$n.Visible = \$true
  \$n.ShowBalloonTip(5000)
  Start-Sleep -Milliseconds 5500
  \$n.Dispose()
"
