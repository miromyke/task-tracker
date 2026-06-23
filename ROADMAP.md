# Roadmap — planned features

These are planned, not finalized — details may change. Notes reference the current
implementation so the work has a starting point. Numbers are stable ids (commits
reference them as `ROADMAP #N`); shipped items are kept as a one-line changelog below
rather than renumbered.

## 12. Task activity: "postponed ×N" tag

Surface how often a task's due date has slipped, as a visible **"postponed ×N"** badge
in its activity view.

> Scope note: this item originally also covered gating reporting and the task activity
> log behind a per-user capability. That access-control half has moved to **#17**
> (attribute-based access control), which now owns the capability model and server-side
> enforcement for the history/pulse reads. What's left here is the render-only tag.

Current state (starting point):
- `tasks.postpone_count` already exists and is incremented on a later-due-date move
  (`UpdateTask`, `store.go`), and `due_date_change` log entries are recorded — but the
  count isn't surfaced anywhere as a tag/badge.
- The task activity log ships inside `GET /tasks/{id}` (`{task, logs}`) and renders in
  `pages/Task.tsx`, where the badge would live.

Deliverable: render a "postponed ×N" tag on tasks (driven by `postpone_count`) within
the activity view. Pure frontend over data that already exists.

## 14. Personalized notifications

Notify users about activity that concerns them specifically, rather than leaving
everything in the same global feeds:
- **a) Chat mentions** — when someone @-mentions you in a channel message.
- **b) Tasks you created** — activity on tasks you opened (status changes, logged
  notes, completion, due-date moves).
- **c) Tasks assigned to you** — being assigned, plus activity on your assigned tasks.

Current state (starting point):
- There is no notification infrastructure at all — no `notifications` table, no
  unread/seen tracking, no delivery surface (bell/badge), no per-user feed.
  Everything today is either global (chat, pulse, calendar) or task-scoped (the
  activity log inside `GET /tasks/{id}`).
- Chat @-mentions exist as data but aren't actionable: messages store raw
  `@username` tokens in their text, resolved only at render time client-side via
  `TOKEN_RE` in `MessageText.tsx` (`frontend`). Nothing server-side parses mentions
  on `POST /channels/{id}/messages` (`handlePostMessage`), so there's no hook to
  record "user X was mentioned." Mentions would need to be detected at send time and
  turned into per-recipient notification rows.
- Task ownership signals are already on the row: `tasks.created_by` and
  `tasks.assignee_id` (`store.go`). Task activity is already captured as structured
  `log_items` (status changes, notes, due-date moves, completion, assignment
  changes) — the raw material for "something happened on your task." A notification
  step would fan a relevant log entry out to the creator and the current assignee.
- Assignment itself is recorded (an assignment `log_items` entry on `UpdateTask`,
  `store.go`) but isn't surfaced to the new assignee anywhere.

Deliverable: introduce per-user notifications — a `notifications` table (recipient,
type, source ref, created/seen timestamps), a write path that records them on the
three triggers above, and a read path (`GET /notifications` + mark-as-read) with an
unread badge/bell in the UI. Decide: in-app only vs. also push/email; how much to
coalesce (one row per task-activity burst vs. per log entry); and whether the actor
is always excluded from their own notifications (so you aren't pinged for your own
actions on a task you created/own).

## 15. Chat: delete messages (admins still see deleted)

Let members remove a chat message they posted, but keep deleted messages visible to
admins (for moderation/audit) rather than erasing them outright.

Current state (starting point):
- Chat is strictly append-only: `store.go` notes "messages are never edited or
  deleted," the `Message` struct has no deleted/edited fields, the `messages` table
  has no `deleted_at` column, and the only endpoints are `GET`/`POST`
  `…/channels/{id}/messages` (`handleListMessages` / `handlePostMessage`) — there is
  no DELETE route.
- The pattern already exists elsewhere: files use soft delete with admin-only
  visibility/purge (shipped #4), so this can mirror that — a reversible `deleted_at`
  flag plus role-gated rendering, not a hard delete.

Deliverable: soft-delete for messages — add `deleted_at` / `deleted_by` columns, a
`DELETE /api/channels/{id}/messages/{mid}` endpoint, and role-aware listing where
non-admins see a tombstone (or nothing) while admins see the original text marked as
deleted. Decide who may delete (author-only vs. author + admin) and whether a deleted
message's references (task/file/mention tokens) stay resolvable for the admin view.

## 16. Chat: don't expose usernames in mentions

When mentioning someone, show only their display name — never their login.

Current state (starting point):
- Rendered messages already show the display name: `MessageText.tsx` resolves an
  `@username` token to `<Mention name={user.name}>`, so the login isn't shown in
  posted messages.
- The login still leaks in the composer: the `@`-autocomplete in `Chat.tsx` lists
  each candidate as name **plus** a `@${u.username}` sub-label, and inserting a pick
  drops a raw `@username` token into the textarea, so the user sees the literal
  `@login` text until the message is sent.

Deliverable: stop surfacing usernames in the mention UI — at minimum drop the
`@username` sub-label from the suggestion list (avatar + display name only). Decide
whether to also hide the login in the composed text (render the mention as the
display name / a chip and store an id-based token instead of `@username`), which means
changing the stored token format and the `TOKEN_RE` + `usersByUsername` resolution in
`MessageText.tsx`; or keep the `@username` token internally and only change what's
displayed.

## 17. Attribute-based access control

Replace the coarse admin/member binary with finer-grained, per-user
attributes/capabilities that gate specific actions and reads. The first capabilities
to enforce:
- **Project creation & archival** — who may create a project, and who may
  archive/unarchive one.
- **History / activity / pulse reads** — who may see task activity logs and the
  reporting surfaces (pulse, calendar/day-report).

Current state (starting point):
- Access is a coarse binary: `users.role` is `"admin" | "member"` (`User.IsAdmin()`),
  enforced by the `requireAdmin` middleware. There is no per-capability flag, so any
  finer rule needs a new model.
- Both target areas are currently open to every authenticated member:
  - Project create/archive run under plain `requireAuth` — `POST /api/projects`
    (`handleCreateProject`) and `PATCH /api/projects/{id}` (`handleUpdateProject`,
    which toggles `archived`). The frontend shows "New project" and "Archive" to
    everyone (the project-selector menu in `Projects.tsx`).
  - Reporting/history reads are also `requireAuth`: `GET /pulse`,
    `GET /projects/{id}/pulse`, `GET /calendar`, `GET /calendar/day/{date}`, and the
    `logs` array inside `GET /tasks/{id}`.
- This item owns the read-gating that #12 originally described. #12 has been narrowed
  to its render-only "postponed ×N" tag; the capability model and server-side
  enforcement for the history/pulse reads live here, so there's a single mechanism
  rather than two.
- Relationship to #18: this gates by global capability; #18 (project membership) scopes
  by project. They compose — decide whether capability holders / admins see everything
  while membership governs the rest.

Deliverable: choose an access model (per-user capability flags vs. a small role set
vs. true attribute rules) and a single server-side enforcement point — middleware/
helpers that check a capability — applied to project create/archive and to the
history/reporting reads (gating the payload, not just hiding UI), with the matching
entry points hidden in the frontend for users who lack each capability. Decide the
granularity (separate "manage projects" / "view reporting" / "view history"
capabilities vs. bundles) and how capabilities are assigned and managed (an admin
control in user management).

## 18. Project membership: author can invite members

Make project access membership-based: a project has an explicit member list, and its
author can invite other users to it. Today every authenticated user implicitly sees
every project; this scopes a project to the people who belong to it.

Current state (starting point):
- Projects are global — there is no membership concept. `ListProjects` returns all
  projects to any authenticated user (`GET /api/projects`, plain `requireAuth`), and
  there's no `project_members` table or per-project access check anywhere.
- The author is already recorded: `projects.created_by` (`store.go`) identifies the
  creator — the natural owner for managing invites.
- "member" in the codebase is the global `users.role`, not project membership — a
  different axis from what's needed here.
- Related: #17 (attribute-based access control) gates by global capability; project
  membership instead scopes by project. Decide how the two compose (e.g. admins /
  capability holders still see everything, membership governs the rest).

Deliverable: introduce per-project membership — a `project_members` table (project,
user, added_by/at), an invite/remove flow the author (and admins) can use, and
membership-scoped reads so `ListProjects` and project-scoped endpoints (tasks, pulse,
files, calendar) only return projects the user belongs to. Decide: whether the author
invites existing users only or can trigger account creation; whether non-members are
fully blind to a project or can request access; whether admins bypass membership; and
what happens to a member's task assignments when they're removed.

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
