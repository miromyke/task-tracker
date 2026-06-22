# Roadmap — planned features

These are planned, not finalized — details may change. Notes reference the current
implementation so the work has a starting point. Numbers are stable ids (commits
reference them as `ROADMAP #N`); shipped items are kept as a one-line changelog below
rather than renumbered.

## 12. Per-user visibility: reporting & task activity log (+ "postponed" tag)

Let only some users see the "heavier" surfaces, instead of showing them to every
authenticated member:
- **a) Reporting** — the calendar, pulse, and day-report stories.
- **b) Task activity log** — a task's history feed, including a visible **"postponed"
  tag** that surfaces how often the due date has slipped.

Current state (starting point):
- Roles are a coarse binary: `users.role` is `"admin" | "member"` (`User.IsAdmin()`),
  enforced by the `requireAdmin` middleware. There is no per-user/per-capability flag
  for finer-grained visibility — this work likely needs one (e.g. a `can_view_reporting`
  / `can_view_history` capability, or a third role) since admin/member is too blunt.
- The reporting endpoints are open to any authenticated user: `GET /pulse`,
  `GET /projects/{id}/pulse`, `GET /calendar`, `GET /calendar/day/{date}` are all behind
  plain `requireAuth` (`handlers.go`). Gating means a new middleware/check plus hiding the
  entry points in the frontend for users without the capability.
- The task activity log ships inside `GET /tasks/{id}` (`{task, logs}`) and renders in
  `pages/Task.tsx`; it's also `requireAuth`-only. Gating may mean omitting `logs` from the
  payload (not just hiding it client-side) for users without access.
- `tasks.postpone_count` already exists and is incremented on a later-due-date move
  (`UpdateTask`, `store.go`), and `due_date_change` log entries are recorded — but the count
  isn't surfaced anywhere as a tag/badge. The "postponed" tag is a small render over data
  that's already there.

Deliverable: introduce a visibility capability beyond admin/member; gate the reporting
endpoints and the task-log payload by it (server-side, not just hidden in the UI); hide the
corresponding entry points for users who lack it; and render a "postponed ×N" tag on tasks
(driven by `postpone_count`) within the activity view. Decide the capability model (per-user
flags vs. a new role) and whether reporting and history are one permission or two.

## Shipped

Done items, newest first — see git history for the full implementation notes.

- **#13** Mobile: overhaul the project tasks view — view tabs (Tasks / Calendar / Files) moved
  to a top strip with text labels; the board renders desktop-style status columns on mobile
  (horizontally scrollable with snap + `scroll-px` gutters) and tap-to-move is retained (drag
  would fight the scroll), retiring the old status-pills single-column path. Project + tag
  selection collapses into one compact selector above the tabs (a filter sheet for both, plus
  a kebab menu carrying New project / Archive); the header keeps Add task. The Files toolbar is
  trimmed to just the upload button on mobile (kind filters + admin deletion queue are
  desktop-only). The short-lived Pulse tab and its `PulseCard` were removed (pulse `api`
  surface dropped; backend `/pulse` endpoints left in place, now unused).
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
