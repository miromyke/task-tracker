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

## 25. Restructure the desktop layout of the main projects page

Rework the desktop projects page from its current two-column shape into a single
full-width column, lifting the project selector up to sit on the tab row and moving the
tag filter next to "Add task".

Planned changes:
- **Project selector → dropdown, aligned with the tabs.** Replace the dedicated
  left-hand project column with a project dropdown lifted up onto the tab row (Tasks /
  Calendar / Files), rather than occupying its own column.
- **Tag filter next to "Add task".** Move the tag filter out of its current spot and
  place it alongside the "Add task" button.
- **Pulse + tasks board span the full width.** With the project selector no longer a
  separate column, the layout becomes a single column — the pulse and the tasks board
  take up the full available width.
- **Heading: "Tasks" instead of "Tasks for …".** Drop the project name from the board
  heading (`<Trans>Tasks for {selectedProject.name}</Trans>` in `Projects.tsx`) — now
  that the selected project is shown in the dropdown, the heading is just "Tasks".
- **Don't truncate the project title in the selector.** The current project tile
  truncates the name (`truncate` on the label in `ProjectTile`); in the new dropdown,
  show the full project title rather than clipping it.
- **Highlight the selector when "All projects" is selected.** Make the "All projects"
  state more noticeable by visually highlighting the selector (it's easy to miss that
  no single project is filtered), so it's clear you're looking across all projects.

> Scope note: desktop only — the mobile projects view already collapsed project + tag
> selection into one compact selector above the tabs (#13). This brings the desktop
> layout closer to that single-column shape.

## 26. Users: add a "role" label shown after the name

Give a user a free-text **role** (e.g. their job/function — "Architect", "Foreman"),
stored alongside `first_name` / `surname` (#19), and show it in round braces after the
display name everywhere a user name appears — e.g. `Jane Doe (Architect)`.

> Naming caution: `users.role` is already taken — it's the access role (`"admin"` /
> `"member"`, see the `User.Role` field in `store.go`). This new label needs a distinct
> column/field name (e.g. `title`, `position`, or `job_role`) so it doesn't collide with
> the admin/member role.

Current state (starting point):
- A user is `username` + the structured `first_name` / `surname` with a denormalized
  `name` display field (`User` in `store.go`, `userCols`). There is no job/role label.
- The display name is rendered in many places, all reading `user.name` — assignee on
  the board (`KanbanBoard.tsx`), mentions (`MessageText.tsx`), member/user lists
  (`UserManagement.tsx`), activity (`DayCarousel.tsx`), notifications
  (`NotificationBell.tsx`), the account menu (`AppLayout.tsx`). A "(role)" suffix would
  need to appear consistently across these.

Deliverable: add the label field (schema column + create/edit-user and profile forms +
API), and render it in round braces after the name wherever a user name is shown.
Decide: whether to centralize the "name (role)" formatting in one helper (e.g. extend
`lib/format.ts`) so every consumer stays consistent rather than concatenating ad hoc;
whether the role is free-text or a fixed list; whether it's optional (omit the braces
entirely when empty); and whether it appears in compact contexts like mentions/avatars
or only in fuller lists.

## 27. Users page: clearer permissions UI + edit-user modal

Tidy up the admin users page (`UserManagement.tsx`): make per-user permissions read
more clearly as toggles, and move per-user editing into a modal instead of expanding
inline on the card.

Planned changes:
- **Checkboxes instead of badges for capabilities.** The three capability toggles
  (`manageProjects` / `viewReporting` / `viewHistory`, #17) currently render as
  pill-shaped on/off buttons in `UserRow` — visually they read like status badges, so
  it's unclear they're interactive controls. Replace them with explicit checkboxes (a
  labeled checkbox per capability) so the on/off state and "this is editable" are
  obvious.
- **Edit-user modal instead of inline editing.** Today "Edit name" and "Reset password"
  expand inline inputs inside the card, and capability toggles / role / enable-disable
  are scattered across the card's footer. Consolidate per-user editing into a single
  "Edit user" modal (mirroring `AddMemberDialog`) — name, password reset, capabilities,
  admin role, and enable/disable in one place — leaving the card itself as a clean
  read-only summary (avatar, name, login, role/disabled/you badges).
- **Allow user deletion.** Today an account can only be soft-disabled (cannot log in) —
  there is no delete. Add a delete action (in the edit-user modal), removing the user
  outright. This needs a new backend endpoint + `api.deleteUser` (neither exists yet),
  and a decision on what happens to a deleted user's references — authored/assigned
  tasks, log entries, mentions, project/channel memberships — vs. keeping disable as the
  non-destructive option. Guard against deleting yourself / the last admin, with a
  confirm step.
- **Table layout instead of cards.** Switch the users display from the responsive card
  grid to a table — a row per user with columns for name/login, role, capabilities (the
  checkboxes), status, and actions — which reads more densely and lines the permission
  checkboxes up into scannable columns.

Current state (starting point):
- `UserManagement.tsx` lays users out as a responsive card grid; each `UserRow` holds
  all the editing affordances inline (the `editingName` / `resetting` expanders, the
  capability pill-buttons via `toggleCapability`, and the footer actions for role and
  disable). Everything already routes through `api.updateUser`.
- Capabilities are hidden for admins and for your own row (`showCaps`); the role action
  has its own confirm step (`ConfirmDialog`) and self-demotion is blocked server-side.
  A modal would need to preserve these same guards.

Deliverable: switch the users display to a table, swap the capability pill-buttons for
checkboxes, move per-user editing into an "Edit user" modal, and add user deletion
(new endpoint + `api.deleteUser`). Decide: whether the modal is one combined form or
tabbed sections; whether quick actions (disable, make-admin) stay in the table row or
move fully into the modal; what becomes of a deleted user's references (vs. keeping
disable as the soft option); and keep the existing admin/self guards intact.

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
