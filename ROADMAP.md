# Roadmap — planned features

These are planned, not finalized — details may change. Notes reference the current
implementation so the work has a starting point. Numbers are stable ids (commits
reference them as `ROADMAP #N`); shipped items are kept as a one-line changelog below
rather than renumbered. Open items are listed in priority order — the current focus is
**#28**.

## 28. Task comments: show most recent on top

Reverse the task comment order so the newest comment is at the top of the list instead
of the bottom, surfacing the latest discussion without scrolling to the end.

Current state (starting point):
- A task's log entries are fetched oldest-first: `GET /tasks/{id}` returns `logs` ordered
  `created_at, id` ascending (`store.go`, the `log_items WHERE task_id=? ORDER BY
  created_at, id` query).
- `pages/Task.tsx` splits them into `comments = logs.filter(type === "note")` and
  `activity` (the rest), then renders the active list in that same ascending order
  (the `.map` at the bottom of the activity panel). So comments read oldest → newest.

Deliverable: render comments newest-first. Decide whether this is comments-only or also
the activity tab; whether to reverse on the frontend (e.g. a reversed copy of `comments`
in `Task.tsx`, keeping the API ascending) vs. ordering at the query; and where the
"add comment" composer sits relative to the now top-most newest comment (it currently
sits under the list).

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

- **#16** Chat: don't expose usernames in mentions — the privacy half was already in
  place (the `@`-autocomplete carries no `@username` sub-label, the composer inserts the
  display name `@Name`, and `resolveMentions` rewrites it to an id-based `@[id]` token on
  send, so no login is shown or stored). Completed the deliverable by adding the user's
  avatar beside the display name in the suggestion list (avatar + name only). Usernames
  are still searchable in the `@` filter but never rendered.
- **#29** Chat: open files in the Files lightbox — extracted the Files viewer out of
  `FilesView.tsx` into a shared `components/Lightbox.tsx`, with list navigation (`onMove`)
  and the admin soft-delete/restore/purge actions made optional props. Chat's `FileRef`
  (`MessageText.tsx`) now opens a clicked file in that dialog via an `onOpenAsset` callback
  threaded through `MessageText` → `MessageRow` → the `ChatPage` (uploader name resolved
  from the chat's user map; no nav/delete in the chat view). The raw-new-tab `<a>` stays as
  the fallback when no `onOpenAsset` is wired.
- **#15** Chat: delete messages (admins still see deleted) — soft-delete mirroring the
  files pattern (#4): `messages.deleted_at` / `deleted_by` columns, a
  `DELETE /api/channels/{id}/messages/{mid}` route, and role-aware listing. Author or
  admin may delete; the server redacts the text for non-admins (a "This message was
  deleted." tombstone) while admins keep the original for audit, rendered prominently —
  a red **Deleted** badge with who/when, and the preserved text in a red-flagged block.
- **#26** User job-role label — a free-text `job_role` field (JSON `jobRole`, distinct
  from the access `role`) added to users (migration + create/edit-user + self-profile
  forms + API). A single `displayName(user)` helper in `lib/format.ts` renders
  `Name (Title)` — braces omitted when empty — and is used everywhere a name shows:
  board/task assignee, chat author + @mentions, notification lines, the users table,
  account menu, member lists, files uploader, and the activity carousel (the day-events
  and notification-actor payloads were extended with `job_role`). Avatars keep their
  two-letter initials.
- **#19** Structured first/last name + initials-aware avatars — `users.first_name` /
  `surname` columns (backfilled from the legacy free-form `name`, which stays as the
  denormalized display value via `composeName`), wired through create/edit-user and the
  self-profile form; `avatarInitials()` derives the two letters from the parts.
- **#21** Admin can promote/revoke admin — "Make admin" / "Revoke admin" action in user
  management (now in the #27 edit-user modal), wired to `api.updateUser({ role })` with a
  promotion confirm; server blocks self-demotion and demoting the last admin.
- **#27** Users page tidy-up (deletion deferred — see #27 above). The admin `/users`
  page moved from a responsive card grid to a table: one row per user (identity + role +
  permissions + actions). The capability pill-buttons (#17) became labelled on/off
  switches stacked in a single "Permissions" column (admins/self show "—"); per-user
  editing (rename, reset password, make/revoke admin, enable/disable) consolidated into
  one "Edit user" modal, leaving the row a read-only summary. Existing guards kept
  (last-admin demotion, self-row exclusions, admin bypass). Alongside it, the mobile
  project three-dot menu was synced to the desktop blueprint via a shared renderer
  (Members → Archive → New project → Show archived), retiring the standalone mobile
  show-archived button.
- **#25** Desktop projects page restructured into a single full-width column. The
  left-hand project column became a project dropdown lifted onto the tab row (full title,
  no clipping; highlighted when "All projects" is active), carrying the show-archived
  toggle + New project action the sidebar used to hold. The tag filter moved next to "Add
  task" in the content header; the pulse and board now span the full width. The board
  heading dropped the project name ("Tasks" / "Events" / "Files" — the selector shows the
  project). Desktop only; the mobile selector/FilterDialog path (#13) is unchanged.
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

## Cancelled

Dropped items, kept here so their ids aren't reused.

- **#27** Users: allow user deletion — won't do; accounts stay soft-disable-only.
