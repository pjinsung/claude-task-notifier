#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function encodePS(cmd) {
  return Buffer.from(cmd, 'utf16le').toString('base64');
}

function toWinPath(p) {
  return p.replace(/^\/([a-zA-Z])\//, '$1:\\').replace(/\//g, '\\');
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  // === Extract last user message from transcript ===
  let msg = 'Task done';
  let sessionName = null;
  let sessionId = null;
  try {
    const data = JSON.parse(input);
    sessionId = data.session_id;

    // Lookup session name from /rename history (~6ms)
    if (sessionId) {
      try {
        const histPath = path.join(os.homedir(), '.claude', 'history.jsonl');
        const hist = fs.readFileSync(histPath, 'utf8').trim().split('\n');
        for (let i = hist.length - 1; i >= 0; i--) {
          try {
            const h = JSON.parse(hist[i]);
            if (h.sessionId === sessionId && h.display && h.display.startsWith('/rename ')) {
              sessionName = h.display.substring(8).trim();
              break;
            }
          } catch(e) {}
        }
      } catch(e) {}
    }

    const fd = fs.openSync(data.transcript_path, 'r');
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, 1048576);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, stat.size - size);
    fs.closeSync(fd);
    let raw = buf.toString('utf8');
    if (size < stat.size) raw = raw.substring(raw.indexOf('\n') + 1);
    const lines = raw.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const o = JSON.parse(lines[i]);
        if (o.type === 'user' && o.message && typeof o.message.content === 'string') {
          const t = o.message.content.trim();
          if (t && !t.startsWith('<')) { msg = t.substring(0, 100).replace(/[\r\n]+/g, ' '); break; }
        }
      } catch(e) {}
    }
  } catch(e) {}

  const dllPath = toWinPath(path.join(__dirname, 'TaskbarFlash.dll'));
  const pngPath = toWinPath(path.join(__dirname, 'claude.png'));
  const cachePath = toWinPath(path.join(os.tmpdir(), 'claude-flash-hwnd.json'));
  const xmlSafe = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xmlMsg = xmlSafe(msg);

  const toastXml = '<toast launch="dismiss" activationType="protocol"><visual><binding template="ToastGeneric">' +
    '<image placement="appLogoOverride" hint-crop="circle" src="' + pngPath + '"/>' +
    '<text>' + xmlSafe(sessionName || 'Claude Code') + '</text><text>' + xmlMsg + '</text>' +
    '</binding></visual></toast>';

  // === Single PowerShell call: flash + toast ===
  const psCmd = [
    // Flash
    "$hwnd = [IntPtr]::Zero",
    "$cacheFile = '" + cachePath.replace(/'/g, "''") + "'",
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
    "  Add-Type -Path '" + dllPath.replace(/'/g, "''") + "'",
    "  [TaskbarFlash]::Flash($hwnd)",
    "}",
    // Toast
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null",
    "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
    '$doc.LoadXml("' + toastXml.replace(/"/g, '`"') + '")',
    "$toast = New-Object Windows.UI.Notifications.ToastNotification($doc)",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude_pzs8sxrjxfjjc!Claude').Show($toast)"
  ].join('\n');

  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodePS(psCmd)
    ], { stdio: 'ignore', timeout: 10000 });
  } catch(e) {}
});
