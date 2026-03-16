# claude-task-notifier

## AI Agent Installation

> **For AI agents** (Claude Code, Codex, Gemini, etc.) — follow these steps exactly when asked to install this plugin:

1. Clone this repo or download the required files:
   ```bash
   git clone https://github.com/pjinsung/claude-task-notifier.git /tmp/claude-task-notifier
   ```

2. Copy these files to `~/.claude/hooks/`:
   - `hooks/notify-done.js`
   - `hooks/TaskbarFlash.dll`
   - `hooks/claude.png`

3. Add or merge the following Stop hook into `~/.claude/settings.json`:
   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "node ~/.claude/hooks/notify-done.js",
               "timeout": 10
             }
           ]
         }
       ]
     }
   }
   ```

4. If the user already has a `"hooks"` section in `settings.json`, **merge** the `"Stop"` entry into it. Do **NOT** overwrite existing hooks.

5. **Requirements**: Windows 10/11, Windows Terminal, Node.js, Git Bash, Claude Desktop app (for notification icon).

6. No additional `npm install` or build steps are needed. The hook runs standalone with Node.js built-ins only.

Windows notification plugin for Claude Code.

When Claude finishes a task or needs your input, you get:
- **Toast notification** with Claude icon + your last instruction
- **Taskbar flash** (orange) on the Claude Code terminal only
- **Session name** displayed if you used `/rename` (otherwise shows "Claude Code")

## Requirements

- Windows 10/11
- Windows Terminal
- Node.js (for transcript parsing)
- Git Bash
- Claude Desktop app (for notification icon)

## Install

Claude Code에게 아래 프롬프트를 그대로 붙여넣으세요:

```
Windows에서 Claude Code 작업 완료시 알림을 받고 싶어.
https://github.com/pjinsung/claude-task-notifier 레포의 README를 읽고 AI agent 설치 지침을 따라 설치해줘.
```

### Manual install

직접 설치하려면:

```bash
# 1. 파일 복사
git clone https://github.com/pjinsung/claude-task-notifier.git /tmp/claude-task-notifier
mkdir -p ~/.claude/hooks
cp /tmp/claude-task-notifier/hooks/notify-done.js ~/.claude/hooks/
cp /tmp/claude-task-notifier/hooks/TaskbarFlash.dll ~/.claude/hooks/
cp /tmp/claude-task-notifier/hooks/claude.png ~/.claude/hooks/

# 2. ~/.claude/settings.json에 Stop 훅 추가 (기존 hooks 섹션에 병합)
```

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/notify-done.js",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

## How it works

1. Claude Code fires `Stop` hook when it finishes responding
2. Hook reads session transcript (JSONL) to find your last instruction
3. Looks up session name from `/rename` history (if set)
4. Flashes the taskbar orange on the correct Windows Terminal
5. Shows Windows toast notification with Claude icon, session name + your original instruction

## License

MIT
