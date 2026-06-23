# Roadmap — planned features

These are planned, not finalized — details may change. Notes reference the current
implementation so the work has a starting point. Numbers are stable ids (commits
reference them as `ROADMAP #N`); shipped items are kept as a one-line changelog below
rather than renumbered.

## 12. Task activity: "postponed ×N" tag

Surface how often a task's due date has slipped, as a visible **"postponed ×N"** badge
in its activity view.

> Scope note: this item originally also covered gating reporting and the task activity
> log behind a per-user capability. That access-control half shipped in **#17**
> (attribute-based access control), which owns the capability model and server-side
> enforcement for the history/pulse reads. What's left here is the render-only tag.

Current state (starting point):
- `tasks.postpone_count` already exists and is incremented on a later-due-date move
  (`UpdateTask`, `store.go`), and `due_date_change` log entries are recorded — but the
  count isn't surfaced anywhere as a tag/badge.
- The task activity log ships inside `GET /tasks/{id}` (`{task, logs}`) and renders in
  `pages/Task.tsx`, where the badge would live.

Deliverable: render a "postponed ×N" tag on tasks (driven by `postpone_count`) within
the activity view. Pure frontend over data that already exists.

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

## 19. Users: separate surname, initials-aware avatars

Give users a structured surname (first + last name) instead of one free-form name, and
derive avatar initials from it explicitly.

Current state (starting point):
- A user has a single display field: `users.name` (`store.go`), alongside `username`.
  There is no separate first/last name. Names are set in user management (admin create
  + the profile "Display name" field).
- Avatar initials are derived heuristically from that one string by `initials()` in
  `lib/format.ts`: split on whitespace, take the first letter of the first and last
  word (or the first two chars for a single word). It already yields two letters for a
  two-word name, but it's a guess over a free-form string, not a real first/last split
  (`UserAvatar.tsx` calls `initials(name)`).

Deliverable: add a surname field to users (schema column + create/edit-user and profile
forms + API), and compute avatar initials from first name + surname directly rather than
the whitespace heuristic. Decide: best-effort split of existing `name` values into
first/last on migration vs. keeping `name` as the display value and adding `surname`
alongside; whether surname is required; and how the full name renders everywhere it's
shown (mentions, assignee, activity log, member lists).

## 20. Per-project user permissions

Let a project manager grant permissions to a project's members per-project, so what a
user may do is scoped to the individual project rather than set globally. Builds on #17
(global capabilities) and #18 (membership): today membership only records *whether* a
user belongs to a project, not *what they may do* inside it.

Current state (starting point):
- Membership is binary. `project_members` (project_id, user_id, added_by, added_at)
  records belonging only — there is no per-member role or permission set (`store.go`).
- Capabilities are global, not per-project: `users.cap_manage_projects`,
  `cap_view_reporting`, `cap_view_history` apply across every project a user can see
  (shipped #17). A member holds a capability everywhere or nowhere.
- Who may manage a project is hardcoded to author-or-admin: `loadManageableProject`
  checks `IsAdmin() || project.created_by == user.ID` (`handlers.go`); member
  add/remove flows through that. There is no separate "project manager" who isn't the
  author.
- Access checks have no per-project permission dimension yet: `canAccessProject`,
  `requireProjectAccess`, and the capability middleware (`auth.go`) consult global
  capability + membership only.

Deliverable: attach a role or permission set to each `project_members` row (e.g.
manager / member, or per-project flags mirroring #17's capabilities), a management UI in
the existing "Manage members" dialog for a project manager to set them, and enforcement
that consults the per-project grant alongside the global capability. Decide: whether
per-project permissions replace or layer on the global #17 capabilities (e.g. global as a
baseline, per-project can extend within that project); what a "project manager" may do
(manage members + permissions, archive, …) and whether the author is simply the first
manager; how it composes with admin bypass; and the exact permission set (reuse
manage_projects / view_reporting / view_history per-project, or a project-specific list
like manage-members / edit-tasks / view-reporting).

## Shipped

Done items, newest first — see git history for the full implementation notes.

- **#14** Personalized notifications — per-user `notifications` table fanned out on three
  triggers: chat @-mentions (parsed server-side in `handlePostMessage`), activity on tasks
  you created or are assigned (coalesced per (recipient, task) while unread — "N updates"),
  and being assigned a task (discrete). In-app only, polled; the actor is never notified of
  their own action. Surfaced via a `NotificationBell` in the nav rail (unread badge,
  dropdown list, per-row mark-read + deep-link to the task/channel, mark-all-read) backed by
  `GET /notifications`, `/notifications/unread-count`, and the read/read-all routes.
- **#18** Project membership — `project_members` table with author/admin-managed membership
  (invite existing users only), backfilled from existing project authors and task
  creators/assignees. Membership-scoped reads (`ListProjects`, all-tasks, pulse/calendar,
  files) plus per-project access checks make non-members fully blind to a project (hidden
  from lists; endpoints 404). Tasks can only be assigned to current members; removing a
  member keeps their existing assignments and records a `member_removed` log entry on the
  affected tasks. Admins bypass membership.
- **#17** Attribute-based access control — replaced the admin/member binary with three
  per-user capabilities (`manage_projects`, `view_reporting`, `view_history`); admins bypass
  all. A single server-side enforcement point (`requireCapability` + `requireProjectAccess`
  helpers) gates project create/archive, pulse/calendar, and the task activity-log payload
  (comments stay visible — only the non-note history is withheld), with matching entry points
  hidden in the UI. Capabilities are assigned from user management, which moved out of the
  account modal into its own admin-only `/users` page (responsive card grid, add-member modal).
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
