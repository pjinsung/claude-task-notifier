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

### From GitHub marketplace

```
/plugin marketplace add pjinsung/claude-task-notifier
/plugin install claude-task-notifier@claude-task-notifier
```

### Manual

```
/plugin install --git https://github.com/pjinsung/claude-task-notifier.git
```

## How it works

1. Claude Code fires `Stop` hook when it finishes responding
2. Hook reads session transcript (JSONL) to find your last instruction
3. Analyzes tool usage patterns to classify notification type
4. Flashes the taskbar orange on the correct Windows Terminal
5. Shows balloon notification with type + your original instruction

## License

MIT
