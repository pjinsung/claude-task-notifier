#!/usr/bin/env node
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function encodePS(cmd) {
  return Buffer.from(cmd, 'utf16le').toString('base64');
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  // === Transcript parsing ===
  let type = 'Task Complete', icon = '[V]', msg = 'Task done';
  try {
    const data = JSON.parse(input);
    const fd = fs.openSync(data.transcript_path, 'r');
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, 524288);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, stat.size - size);
    fs.closeSync(fd);
    let raw = buf.toString('utf8');
    if (size < stat.size) raw = raw.substring(raw.indexOf('\n') + 1);
    const lines = raw.trim().split('\n');

    const writeTools = new Set(['Edit','Write','Bash','NotebookEdit']);
    const sessionRe = /session.?limit/i;
    let hasQ=false, hasPlan=false, hasSL=false, hasErr=false;
    let usedWrite=false, tools=0, foundUser=false;

    for (let i = lines.length-1; i >= 0 && !foundUser; i--) {
      try {
        const o = JSON.parse(lines[i]);
        if (o.isApiErrorMessage) hasErr = true;
        if (o.type === 'user' && o.message && typeof o.message.content === 'string') {
          const t = o.message.content.trim();
          if (t) { msg = t.substring(0, 100).replace(/[\r\n]+/g, ' '); foundUser = true; }
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

  // === Sanitize for PS single-quoted strings ===
  const safeMsg = msg.replace(/'/g, "''").replace(/[`$]/g, '');
  const safeType = type.replace(/'/g, "''");
  const dllPath = path.join(__dirname, 'TaskbarFlash.dll').replace(/'/g, "''");
  const cachePath = path.join(os.tmpdir(), 'claude-flash-hwnd.json').replace(/'/g, "''");

  // === Flash: sync, uses HWND cache ===
  const flashCmd = [
    "$hwnd = [IntPtr]::Zero",
    "$cacheFile = '" + cachePath + "'",
    "$cached = $false",
    "if (Test-Path $cacheFile) {",
    "  try {",
    "    $c = Get-Content $cacheFile -Raw | ConvertFrom-Json",
    "    $p = Get-Process -Id $c.pid -EA Stop",
    "    if ($p.ProcessName -eq 'WindowsTerminal' -and $p.MainWindowHandle -ne 0) {",
    "      $hwnd = [IntPtr]$c.hwnd; $cached = $true",
    "    }",
    "  } catch {}",
    "}",
    "if (-not $cached) {",
    "  $cpid = " + process.pid,
    "  for ($i = 0; $i -lt 15; $i++) {",
    "    try {",
    "      $p = Get-Process -Id $cpid -EA Stop",
    "      if ($p.ProcessName -eq 'WindowsTerminal') {",
    "        if ($p.MainWindowHandle -ne 0) {",
    "          $hwnd = $p.MainWindowHandle",
    "          @{pid=$cpid;hwnd=$hwnd.ToInt64()} | ConvertTo-Json | Set-Content $cacheFile",
    "        }; break",
    "      }",
    "      $cpid = (Get-CimInstance Win32_Process -Filter \"ProcessId=$cpid\" -EA Stop).ParentProcessId",
    "      if (-not $cpid) { break }",
    "    } catch { break }",
    "  }",
    "}",
    "if ($hwnd -ne [IntPtr]::Zero) {",
    "  Add-Type -Path '" + dllPath + "'",
    "  [TaskbarFlash]::Flash($hwnd)",
    "}"
  ].join('\n');

  // === Balloon: async, detached ===
  const balloonCmd = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$n = New-Object System.Windows.Forms.NotifyIcon",
    "$n.Icon = [System.Drawing.SystemIcons]::Information",
    "$n.BalloonTipIcon = 'Info'",
    "$n.BalloonTipTitle = 'Claude Code - " + safeType + "'",
    "$n.BalloonTipText = '" + icon + " " + safeMsg + "'",
    "$n.Visible = $true",
    "$n.ShowBalloonTip(5000)",
    "Start-Sleep -Milliseconds 5500",
    "$n.Dispose()"
  ].join('\n');

  // Run flash synchronously (node stays alive → process tree intact)
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodePS(flashCmd)
    ], { stdio: 'ignore', timeout: 10000 });
  } catch(e) {}

  // Run balloon detached (node exits, balloon lives on)
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodePS(balloonCmd)
  ], { stdio: 'ignore', detached: true });
  child.unref();
});
