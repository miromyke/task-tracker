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

## 4. Files: soft delete with admin purge

Allow deleting files, but don't remove them immediately:
- A delete action moves the asset into a hidden **"Submitted for deletion"** tab
  in the Files view (a pending-deletion state on the `assets` row, e.g.
  `deletion_requested_at` + who requested).
- An **admin** permanently deletes from that tab — which removes the DB row **and**
  the file bytes from the uploads volume.
- Non-admins only see the normal Files grid; the pending tab is admin-facing (or
  shows only what they requested). Decide visibility.

## 5. Global chat with channels

A new global chat feature — channels people can talk in. Keep it simple ("nothing
too fancy"). New backend tables (channels, messages) + a chat UI; realtime via
polling or SSE (avoid heavy infra unless needed).

- **Mention people by name** — `@name` references that resolve to users.
- **Reference tasks** — link to a task inline (e.g. `#123` or a task picker) that
  renders as a link to the task page.
- **Reference files** — link an uploaded file/asset inline (picker or token) that
  renders as a link/preview to that file.