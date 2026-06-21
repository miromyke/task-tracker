# Roadmap — planned features

Captured 2026-06-21. These are planned, not finalized — details may change. Notes
reference the current implementation so the work has a starting point.

## 3. Activity log: record structured action details ✅ Done

The activity log should capture the specifics of each action, not just a generic
summary. Currently `log_items` carries `text` + `from_status`/`to_status`, and:
some actions log only a vague "edit" entry, archiving isn't logged at all, and the
blocker task isn't recorded.

Record details per action type:
- **Blocked** — record both the **reason** and the **blocker task** (today the
  reason is stuffed into the `status_change` text; the blocker id isn't in the log).
- **Due-date change** — record **from → to** dates (partially done: logs
  `"Due date: X → Y"`; make it structured/queryable).
- **Archived / unarchived** — log the action (currently intentionally NOT logged).
- **Tag change** — record which tags were added/removed (today: generic "Updated tags").
- **Criteria change** — record what changed (today: generic "Updated checklist").

Likely needs a structured `details` payload on `log_items` (e.g. a JSON column)
rather than English text, so it survives translation and stays queryable. Keep the
"actor: message" / no-gendered-verb rendering rule.

Implemented: added a nullable JSON `details` column to `log_items` (migrated via
`addColumnIfMissing`). The lumped `edit` entry was fully decomposed — `UpdateTask`
now emits one dedicated, structured entry per action: `status_change` (blocked
`{reason, blockedByTaskId}`), `due_date_change` `{from, to}`, `assignee_change`
`{fromUser, toUser}`, `title_change` `{from, to}`, `description_change` (action
only — descriptions are long/markdown), `tags_change` `{added, removed}`,
`criteria_change` `{added, abandoned, restored}`, and `archive` `{archived}`. The
inline checklist also logs now: `SetCriterion` records `criterion_check`
`{criterion, done}` when an item is checked/unchecked, and a single-item
`criteria_change` when abandoned/restored (matching the dialog vocabulary); both
return `newLogs` so the feed updates live. The task activity feed renders each via
`LogDetailView` (blocker link, due/title/assignee from→to with resolved names,
+/− tag and checklist chips, the checked criterion text); legacy `edit` rows fall
back to their old bundled rendering. Strings extracted + translated to Ukrainian.

## 4. Files: soft delete with admin purge ✅ Done

Allow deleting files, but don't remove them immediately:
- A delete action moves the asset into a hidden **"Submitted for deletion"** tab
  in the Files view (a pending-deletion state on the `assets` row, e.g.
  `deletion_requested_at` + who requested).
- An **admin** permanently deletes from that tab — which removes the DB row **and**
  the file bytes from the uploads volume.
- Non-admins only see the normal Files grid; the pending tab is admin-facing (or
  shows only what they requested). Decide visibility.

Implemented: added nullable `deletion_requested_at` + `deletion_requested_by`
columns to `assets` (migrated via `addColumnIfMissing`). `ListAssets` now takes a
`pending` flag — the live grid filters `deletion_requested_at IS NULL`, the queue
filters `IS NOT NULL`. New endpoints: `POST /api/assets/{id}/delete` (any signed-in
user — soft-delete into the queue), `POST /api/assets/{id}/restore` (admin — clears
the stamps), and `DELETE /api/assets/{id}` (admin — purges the row and unlinks the
file bytes, plus any thumb, from the uploads volume). Purge is guarded: an asset
must be in the queue first, so a stray DELETE can't wipe a live file; byte removal
is best-effort (`filepath.Base` guards traversal). The `pending=1` list param is
admin-only server-side. Visibility decision: the queue is **admin-only** — members
see just the live grid but can submit any file for deletion. Frontend: the Files
lightbox gains a trash action (confirm → submit for deletion); admins get a
"Submitted for deletion" toggle showing the queue, where each item's lightbox shows
who requested it (resolved name), a Restore action, and a permanent-delete action
(confirm, irreversible). Strings extracted + translated to Ukrainian.

## 5. Global chat with channels ✅ Done

A new global chat feature — channels people can talk in. Keep it simple ("nothing
too fancy"). New backend tables (channels, messages) + a chat UI; realtime via
polling or SSE (avoid heavy infra unless needed).

- **Mention people by name** — `@name` references that resolve to users.
- **Reference tasks** — link to a task inline (e.g. `#123` or a task picker) that
  renders as a link to the task page.
- **Reference files** — link an uploaded file/asset inline (picker or token) that
  renders as a link/preview to that file.

Implemented: two new tables — `channels` (name, description, created_by,
`archived_at` for reversible archive, mirroring projects) and `messages`
(channel_id, user_id, text, created_at). Messages are **append-only** (no
edit/delete, matching the app philosophy) and store **raw reference tokens** in
`text` — `@username`, `#<taskId>`, `#file<assetId>` — resolved at render time so
the stored text stays language-neutral and never goes stale on rename. A default
`general` channel is seeded on first boot (`seedDefaultChannel` in main.go). New
endpoints (all `requireAuth`): `GET/POST /api/channels`, `PATCH /api/channels/{id}`
(archive), `GET/POST /api/channels/{id}/messages` (the GET takes `?after=<id>` for
the polling delta and `?limit=`), plus `GET /api/assets/{id}` to resolve referenced
files by id. Realtime is **short polling** (3s interval + refetch on window focus),
chosen over SSE to avoid connection/broadcast infra. Chat lives at a dedicated
**`/chat`** route with a `MessageCircle` icon in the left rail (it's global, not
project-scoped, so it isn't a Projects tab). Frontend: `pages/Chat.tsx` (channel
sidebar + message pane + composer) with a lightweight `@`/`#` autocomplete popover
(caret-token detection → user/task match → insert token; Tab/Enter accepts) and a
paperclip file-reference picker reusing `listAssets`; `components/MessageText.tsx`
tokenizes a message into mention chips, task links (`/tasks/:id`), and file
links/thumbnails, falling back to plain text for unresolved refs. Strings extracted
+ translated to Ukrainian. Out of scope for v1 (deferred): edit/delete messages,
threads/reactions, unread badges, typing indicators, in-chat file uploads, per-channel
membership.

## 6. Chat: show referenced task/file names, not ids ✅ Done

When a message references a task or file, render the **name/title only** — not the
numeric id. Today `components/MessageText.tsx` renders a task ref as `#<id> <title>`
(`TaskRef`) and the inserted token in the composer shows the raw `#<id>` / `#file<id>`
text. Drop the `#id` prefix from the rendered chip (link still goes to `/tasks/:id`),
and consider showing a friendly label in the composer too (e.g. a chip that displays
the title while the underlying stored token stays `#<id>`). Files already render by
filename; keep that. Falls back to the raw token only when the ref can't be resolved.

Implemented: `TaskRef` in `MessageText.tsx` now renders the task **title only** as a
highlighted chip — a `Hash` icon + title on a `bg-primary/10` pill (matching the
`@mention` chip styling) linking to `/tasks/:id`, with the numeric id dropped. When
the task can't be resolved (deleted / not loaded) it falls back to the raw `#<id>`
token as plain text instead of a dead link. Files keep rendering by filename. The
composer's stored tokens stay raw `#<id>` (language-neutral, never goes stale); the
`@`/`#` autocomplete dropdown still shows the id for disambiguation while typing.
No new user-facing strings (the title is dynamic content), so no i18n extract needed.

## 7. Chat: upload a file directly ✅ Done

Let users attach a brand-new file in the chat composer (not just reference an existing
upload). Today the composer only inserts a `#file<id>` token via the picker over
`listAssets`. Add an upload path (reuse `saveUpload` + the `assets` table, like the
task-note composer in `handleAddLog`). Since chat isn't project-scoped, this needs
asset `project_id` to be optional — **see item 9** (shared prerequisite). On upload,
record the asset and insert its `#file<id>` token (or attach it to the message
directly). Respect the same inline-render/`nosniff` safety rules as other uploads.

Implemented: the chat composer gained an upload button (an `Upload` icon next to the
existing paperclip reference-picker) backed by a hidden multi-file `<input>`. On pick
it calls `api.uploadOrphanAssets` (the project-less `POST /api/assets` endpoint from
item 9 — no project, since chat is global), then inserts the resulting `#file<id>`
token(s) at the caret via a generalized `insertFiles` helper (the existing reference
picker now routes through the same helper). A spinner disables the button while
uploading. Uploads flow through the same `saveUpload` + `/api/uploads` serving path as
every other upload, so the `nosniff`/inline-render safety rules are inherited for free.
Sent messages resolve the new file via the existing `referencedFileIds` → `getAsset`
lazy-resolution. Strings extracted + translated to Ukrainian.

## 8. Files: drop the "approval" framing from deletion ✅ Done

The soft-delete UI currently surfaces the admin-purge workflow to everyone —
"Submitted for deletion", "submit for deletion", language about an admin approving
the purge. Simplify the member-facing copy so deleting a file reads like a normal
delete (e.g. "Delete" / "Deleted"), without exposing the approval/queue mechanics.
The two-stage soft-delete + admin purge can stay under the hood (`assets`
`deletion_requested_at`, the admin-only pending tab in `FilesView.tsx`); this is a
copy/UX change, not a model change. Decide what, if anything, a member sees after they
delete (likely: the file just disappears from their grid).

Implemented: purely a member-facing copy change in `FilesView.tsx` — no model/endpoint
change. The delete confirm dialog was reworded from queue/admin language ("Submit this
file for deletion?" / "It will be moved to the deletion queue… An admin can restore it…"
/ "Submit for deletion") to a plain delete ("Delete this file?" / "It will be removed
from Files." / "Delete"). The lightbox trash action already read "Delete". On confirm the
file just disappears from the member's grid (existing `removeFromView` after the
soft-delete `requestDeleteAsset` call), with no after-state shown. The two-stage
soft-delete + admin purge is untouched under the hood: the admin-only "Submitted for
deletion" toggle, the queued-files banner, "Deletion requested by", restore, and the
permanent-delete dialog keep their explicit language. Strings extracted + the two new
member-facing strings translated to Ukrainian.

## 9. Files: make the project optional on upload ✅ Done

Allow uploading a file **without** attaching it to a project — make the project
reference optional in the Files view. Today `assets.project_id` is `NOT NULL` and
`AddProjectAssets` / `POST /api/projects/{id}/assets` require a project; the Files grid
filters by the selected project. Make `project_id` nullable (migration via
`addColumnIfMissing` is additive, but dropping NOT NULL needs care on SQLite — likely a
new nullable column path or table rebuild), add an upload endpoint that doesn't require
a project, and show project-less files under an "All files" / "No project" bucket. This
is the shared prerequisite for **item 7** (chat uploads have no project).

## 10. Files: collect & show upload metadata (who / when / context)

Surface the provenance of each uploaded file: **who** uploaded it, **when**, and **in
what context** — chat, a task (`#<id>`), or a direct Files-page upload. Some of this is
already stored but never shown; the chat context isn't recorded at all yet.

Current state (starting point):
- `assets.uploaded_by` + `assets.created_at` already capture who/when, but the Files
  grid/lightbox (`FilesView.tsx`) only shows filename, size, and date — not the
  uploader (resolve via `usersById`).
- Context is partially derivable: `task_id`/`log_id` ⇒ a task upload, `project_id` ⇒ a
  Files-page project upload, all three null ⇒ a project-less Files upload **or** a chat
  upload — the two are indistinguishable today because chat uploads (`AddAssets(nil, …)`
  via `POST /api/assets`) don't link back to the message/channel.
- To label chat uploads, record the chat context on the asset (e.g. a nullable
  `message_id`/`channel_id`, or a generic `source`/`context` enum) at upload time, or
  backfill the link when the message that references `#file<id>` is posted.

Deliverable: show "Uploaded by <name> · <date> · <context>" in the Files lightbox (and
maybe a context chip on the grid), with the context resolving to a link where it makes
sense (task page, channel). Decide whether to add an explicit context column vs. infer
it from the existing `task_id`/`project_id` + a new chat link.

Implemented: `assets.project_id` is now nullable. Fresh DBs get it from the updated
canonical schema; existing DBs are migrated by `migrateAssetsProjectNullable` — SQLite
can't drop a NOT NULL in place, so it rebuilds the table (no other table references
`assets`, so the drop/rename is FK-safe) once, idempotently, after the `deletion_*`
columns are added. The Go `Asset.ProjectID` became `*int64` (scanned via
`sql.NullInt64`); `AddProjectAssets` is now `AddAssets(projectID *int64, …)` and inserts
`NULL` when nil. New endpoint `POST /api/assets` (`handleUploadOrphanAssets`, any signed-in
user) uploads project-less files; the shared multipart parsing was extracted into
`readMultipartUploads`. `ListAssets` gained a project-less bucket: a negative `projectID`
→ `project_id IS NULL`, surfaced over the API as `?project=none`. Project-less files also
appear in the existing "All files" view (projectID 0 returns NULL rows too). Frontend:
`Asset.projectId` is `number | null`; `api.uploadOrphanAssets` + a `"No project"` option
in the Files upload picker (`AddFilesDialog`) let you upload without a project. A focused
migration regression test (`migrate_assets_test.go`) covers the NOT NULL→nullable rebuild,
row survival, orphan insert, and idempotency. Strings extracted + translated to Ukrainian.

This **unblocks item 7** (chat file uploads).