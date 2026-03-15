# claude-task-notifier

Windows notification plugin for Claude Code with smart task classification.

When Claude finishes a task, you get:
- **Taskbar flash** (orange) on the Claude Code terminal only
- **Balloon notification** showing what task was completed
- **Auto-classification** into 6 notification types

## Notification Types

| Type | Trigger |
|------|---------|
| **Task Complete** | Write/Edit/Bash tools used |
| **Review Complete** | Read-only tools (Grep/Glob/Read) |
| **Question** | Claude needs your input |
| **Plan Ready** | Plan mode completed |
| **Session Limit** | Usage quota reached |
| **API Error** | Auth/rate limit/server errors |

## Requirements

- Windows 10/11
- Windows Terminal
- Node.js (for transcript parsing)
- Git Bash

## Install

Claude Code에게 아래 프롬프트를 그대로 붙여넣으세요:

```
Windows에서 Claude Code 작업 완료시 알림을 받고 싶어.
https://github.com/pjinsung/claude-task-notifier 레포를 참고해서 설치해줘.

1. 레포를 클론하거나 필요한 파일을 다운로드해서 ~/.claude/hooks/ 에 복사
   - hooks/notify-done.js
   - hooks/TaskbarFlash.dll
2. ~/.claude/settings.json의 hooks 섹션에 Stop 훅 추가:
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
3. 이미 hooks 섹션이 있으면 Stop 항목만 병합해줘.
```

### Manual install

직접 설치하려면:

```bash
# 1. 파일 복사
git clone https://github.com/pjinsung/claude-task-notifier.git /tmp/claude-task-notifier
mkdir -p ~/.claude/hooks
cp /tmp/claude-task-notifier/hooks/notify-done.js ~/.claude/hooks/
cp /tmp/claude-task-notifier/hooks/TaskbarFlash.dll ~/.claude/hooks/

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
3. Analyzes tool usage patterns to classify notification type
4. Flashes the taskbar orange on the correct Windows Terminal
5. Shows balloon notification with type + your original instruction

## License

MIT
