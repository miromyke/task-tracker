# Roadmap — planned features

These are planned, not finalized — details may change. Notes reference the current
implementation so the work has a starting point. Numbers are stable ids (commits
reference them as `ROADMAP #N`); shipped items are kept as a one-line changelog below
rather than renumbered.

_No open items right now — see Shipped below._

## Shipped

Done items, newest first — see git history for the full implementation notes.

- **#11** Pulse/calendar: hide logs from archived tasks/projects — `includeArchived` flag
  (default off) on `LogsInRange`/`ProjectLogsSince`/`DayEvents`, threaded from `?archived=1`;
  frontend honors the existing "Show archived" toggle (no new control).
- **#10** Files: collect & show upload metadata (who / when / context) — uploader + context
  ("chat" via a `source` column, else inferred from ids) in the Files lightbox.
- **#9** Files: make the project optional on upload — nullable `assets.project_id`, orphan
  `POST /api/assets`, "No project" bucket.
- **#8** Files: drop the "approval" framing from member-facing deletion (copy-only).
- **#7** Chat: upload a file directly from the composer.
- **#6** Chat: render referenced task/file by name/title, not id.
- **#5** Global chat with channels — `channels`/`messages` tables, `/chat`, @-mentions, task
  & file refs, short-poll realtime.
- **#4** Files: soft delete with admin purge queue.
- **#3** Activity log: record structured action details (JSON `details` per action type).
