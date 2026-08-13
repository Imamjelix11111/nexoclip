# Fresh Pi Task Sessions

Use one Pi process/session per implementation task:

```bash
npm run pi:task -- "Implement object-storage upload and signed URL flow"
```

The runner starts a foreground, non-interactive Pi process in the current terminal. It does not open another terminal window. Each task gets a new session name and is stored under `.pi/task-sessions/`.

The new session is intentionally initialized from repository state rather than conversation history. It reads `AGENTS.md`, `CLAUDE.md` when present, and `docs/sprint-1-progress.md`, then receives the task prompt.

The agent is instructed to preserve unrelated changes, use TDD, run verification, update progress, and synchronize the matching Notion task when available.

For a truly ephemeral process, add `--no-session` to `scripts/pi-task.sh`; the current default keeps task sessions recoverable while keeping each task context fresh.
