#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK="${*:-}"

if [[ -z "$TASK" ]]; then
  echo "Usage: $0 \"task description\"" >&2
  exit 2
fi

slug="$(printf '%s' "$TASK" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -E 's/^-+|-+$//g' | cut -c1-48)"
name="task-${slug:-session}-$(date +%Y%m%d-%H%M%S)"
session_dir="$ROOT/.pi/task-sessions"
mkdir -p "$session_dir"

prompt=$(cat <<EOF
You are starting a fresh NexoClip implementation session.

Read these files first:
- AGENTS.md
- CLAUDE.md, if present
- docs/sprint-1-progress.md, if present

Repository: $ROOT
Task: $TASK

Rules:
- Preserve unrelated user changes and the untracked AGENTS.md.
- Follow the repository architecture: Next.js short requests, raw PostgreSQL with pg, tenant-scoped resources, and server/worker-only provider secrets.
- Use JavaScript unless the existing area requires otherwise.
- Use TDD for behavior changes: write a failing test, implement the smallest change, then verify.
- Inspect git status before editing.
- Run relevant tests and review git diff before finishing.
- Update docs/sprint-1-progress.md with changed files, tests, verification, blockers, and follow-up.
- If a matching Notion task exists, synchronize its status and implementation note.
- Do not claim completion without command output evidence.

Begin by inspecting the repository and then implement the task.
EOF
)

exec pi --print --session-dir "$session_dir" --name "$name" "$prompt"
