const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const hookPath = path.join(__dirname, '..', 'hooks', 'notify-done.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const hookDir = path.dirname(hookPath);

function decodeEncodedCommand(args) {
  const index = args.indexOf('-EncodedCommand');
  assert.notEqual(index, -1, 'expected PowerShell encoded command');
  return Buffer.from(args[index + 1], 'base64').toString('utf16le');
}

function runHook() {
  const execCalls = [];
  const spawnCalls = [];
  const stdinHandlers = {};
  const transcript = [
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read' }] }
    }),
    JSON.stringify({
      type: 'user',
      message: { content: 'toast regression test' }
    })
  ].join('\n');

  const fsStub = {
    openSync() {
      return 1;
    },
    fstatSync() {
      return { size: Buffer.byteLength(transcript) };
    },
    readSync(fd, buffer, offset, length, position) {
      return Buffer.from(transcript).copy(buffer, offset, position, position + length);
    },
    closeSync() {}
  };

  const childProcessStub = {
    execFileSync(file, args, options) {
      execCalls.push({ file, args, options });
    },
    spawn(file, args, options) {
      spawnCalls.push({ file, args, options });
      return { unref() {} };
    }
  };

  const context = vm.createContext({
    Buffer,
    JSON,
    Set,
    require(moduleName) {
      if (moduleName === 'child_process') return childProcessStub;
      if (moduleName === 'fs') return fsStub;
      if (moduleName === 'path') return path;
      if (moduleName === 'os') return { tmpdir: () => 'C:\\Temp' };
      return require(moduleName);
    },
    process: {
      pid: 4242,
      stdin: {
        on(event, handler) {
          stdinHandlers[event] = handler;
        }
      }
    },
    __dirname: hookDir,
    module: { exports: {} },
    exports: {},
    console
  });

  vm.runInContext(hookSource, context, { filename: hookPath });
  stdinHandlers.data(Buffer.from(JSON.stringify({ transcript_path: 'fake.jsonl' })));
  stdinHandlers.end();

  return { execCalls, spawnCalls };
}

const { execCalls, spawnCalls } = runHook();

assert.equal(spawnCalls.length, 0, 'toast should not use detached spawn');
assert.equal(execCalls.length, 2, 'expected flash and toast PowerShell executions');

const toastCall = execCalls[1];
assert.equal(toastCall.file, 'powershell.exe');
assert.equal(toastCall.options.timeout, 3000);

const toastCommand = decodeEncodedCommand(toastCall.args);
assert.match(
  toastCommand,
  /CreateToastNotifier\('Claude_pzs8sxrjxfjjc!Claude'\)/,
  'toast should keep Claude Desktop AppId'
);
assert.match(
  toastCommand,
  /\$doc\.LoadXml\('/,
  'toast should still use the WinRT XML toast API'
);
