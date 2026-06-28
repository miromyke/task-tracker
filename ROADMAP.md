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

## 21. Admin can promote others to admin

Let an admin grant the admin role to another user (and revoke it) from user management.

Current state (starting point):
- The backend already supports the role change: `handleUpdateUser` accepts a `role` field
  and calls `SetRole` (`store.go`), promoting to `roleAdmin` or demoting to `roleMember`,
  guarded against self-demotion ("cannot change your own role"). `api.updateUser` already
  takes `role?` (`lib/api.ts`).
- The gap is purely UI: the user-management page (`UserManagement.tsx`) shows an "admin"
  badge on admins but exposes no control to change the role — `UserRow` only offers reset
  password, enable/disable, and the per-user capability toggles (#17). Capability toggles
  are deliberately hidden for admins, since admins bypass capabilities.

Deliverable: add a "Make admin" / "Revoke admin" action to `UserRow` (admin-only, hidden
on your own row to respect the self-demotion guard), wired through the existing
`api.updateUser({ role })`. Decide: a confirm step for promotion (it's a powerful grant);
whether to keep at least one admin (block demoting the last admin, server-side); and how the
admin action sits alongside the capability toggles now that an admin implicitly holds all
capabilities.

## 23. Chat: invite users to a channel

Let a channel be scoped to invited members instead of being visible to everyone, with
an invite flow to add users to it. Mirrors project membership (#18), but for channels.

Current state (starting point):
- Channels are global. The `channels` table has no membership — only
  `created_by`/`archived_at` (`store.go`) — and there is no `channel_members` table.
- Every authenticated user sees and can post to every channel: the routes
  (`GET`/`POST /api/channels`, `…/{id}/messages`) are guarded by `requireAuth` only,
  with no per-channel access check (`handlers.go`). `ListChannels` is unscoped, and
  `handleListMessages`/`handlePostMessage` load the channel by id without verifying the
  caller belongs to it.
- The pattern already exists for projects (#18): `project_members` plus membership-scoped
  reads and per-project access checks that 404 non-members. This can mirror that — a
  `channel_members` table, an invite-existing-users flow, scoped `ListChannels`, and a
  `requireChannelAccess`-style check on the message routes.

Deliverable: add channel membership (a `channel_members` table + invite UI in the chat
view, inviting existing users only), scope channel listing and message read/post to
members, and 404 non-members on a channel's messages. Decide: whether existing channels
are "open to all" (backfill every user as a member, or special-case a public flag) vs.
membership required everywhere; who may invite (channel creator/admin vs. any member);
whether removing a member keeps their past messages (it should, mirroring how #18 keeps a
removed member's task assignments); and how this composes with admin bypass and the
@-mention fan-out (don't notify a mention for a user who isn't in the channel).

## 24. Pulse/calendar: filter by user

Let the activity pulse and calendar be narrowed to a single user, so you can see just
one person's activity instead of everyone's. Mirrors the existing project/tag filters.

> **Status: parked (partially built).** WIP is archived on branch
> `roadmap-24-user-filter` (not merged). Resume from there rather than restarting.

Done so far (on the branch):
- **Backend — complete.** An optional `?user=<id>` actor filter is threaded through the
  reporting store queries (`LogsInRange`, `ProjectLogsSince`, `DayEvents`,
  `DayMinorEvents`) and the calendar/pulse handlers, gated by the existing
  `view_reporting` capability + membership scope (a non-member's logs can't leak — the
  project scope still constrains it). `api.getPulse`/`getCalendar`/`getCalendarDay` carry
  a `userId`.
- **Frontend — partial.** A "User" selector is surfaced on the **calendar view only**
  (desktop sidebar under Tags + the mobile filter sheet), populated from the visible user
  list and AND-ed with the project/tag/archived filters; it scopes the calendar heatmap
  and the day-carousel drill-down.

Left to do / open questions (why it's parked):
- **Pulse has no UI control yet.** The pulse renders as a summary card inside the *board*
  view, which isn't itself user-filtered; the backend `?user=` param is wired but no
  selector is surfaced there. Decide whether to add one (and what scoping the board pulse
  to a user should mean) vs. keeping the filter calendar-only.
- **Calendar placement.** The selector currently sits in the sidebar under Tags; consider
  a filter bar atop the calendar (next to the month nav) so it's more discoverable.
- Whether selectable users are scoped to the current project's members vs. all visible
  users (currently: all visible users).

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
