#!/usr/bin/env node
const { execFileSync } = require('child_process');
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

  // === Convert Git Bash paths (/c/Users/...) to Windows paths (C:\Users\...) ===
  function toWinPath(p) {
    return p.replace(/^\/([a-zA-Z])\//, '$1:\\').replace(/\//g, '\\');
  }

  // === Sanitize for PS single-quoted strings ===
  const safeMsg = msg.replace(/'/g, "''").replace(/[`$]/g, '');
  const safeType = type.replace(/'/g, "''");
  const dllPath = toWinPath(path.join(__dirname, 'TaskbarFlash.dll')).replace(/'/g, "''");
  const icoPath = toWinPath(path.join(__dirname, 'claude.ico')).replace(/'/g, "''");
  const cachePath = toWinPath(path.join(os.tmpdir(), 'claude-flash-hwnd.json')).replace(/'/g, "''");

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

  // === Toast: sync, uses Claude Desktop AppId + appLogoOverride for icon ===
  const pngPath = toWinPath(path.join(__dirname, 'claude.png')).replace(/"/g, '');
  // Sanitize for XML content (escape &, <, >)
  const xmlSafe = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xmlType = xmlSafe('Claude Code - ' + type);
  const xmlMsg = xmlSafe(icon + ' ' + msg);
  const toastXml = '<toast launch="dismiss" activationType="protocol"><visual><binding template="ToastGeneric">' +
    '<image placement="appLogoOverride" hint-crop="circle" src="' + pngPath + '"/>' +
    '<text>' + xmlType + '</text><text>' + xmlMsg + '</text>' +
    '</binding></visual></toast>';
  const toastCmd = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null",
    "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
    '$doc.LoadXml("' + toastXml.replace(/"/g, '`"') + '")',
    "$toast = New-Object Windows.UI.Notifications.ToastNotification($doc)",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude_pzs8sxrjxfjjc!Claude').Show($toast)"
  ].join('\n');

  // Run flash synchronously (node stays alive → process tree intact)
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodePS(flashCmd)
    ], { stdio: 'ignore', timeout: 10000 });
  } catch(e) {}

  // Run toast synchronously so the hook keeps the process alive long enough
  // for Windows to accept the notification, but cap it well under the 10s
  // hook timeout budget.
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodePS(toastCmd)
    ], { stdio: 'ignore', timeout: 3000 });
  } catch(e) {}
});
