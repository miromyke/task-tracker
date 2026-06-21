# Roadmap — planned features

Captured 2026-06-21. These are planned, not finalized — details may change. Notes
reference the current implementation so the work has a starting point.

## 1. Split Tasks / Calendar / Files into separate pages

Today these are three tabs driven by a `view` state inside `frontend/src/pages/Projects.tsx`
(the `TabsList`). Refactor them into three real routes (e.g. `/`, `/calendar`,
`/files`) so each is its own page.

- **Navigation stays outside and is reused** — the nav (and likely the shared
  layout shell in `AppLayout.tsx`) wraps all three; only the content area swaps.
- Decide what's shared vs per-page for the project sidebar + tag filter
  (currently the `aside` in Projects.tsx). See feature 2 for the Tasks-page layout.

## 2. Tasks page: pulse + project filter in one container, board below

On the Tasks page, group the **activity pulse** (`PulseCard`) and the **project
filter** into a single top container, then place the **kanban board below it**
full-width so the board gets more vertical space (it's the primary surface).

- Currently the pulse is a card above the board and the project/tag filter lives
  in the left `aside`. This consolidates the chrome into one header block.

## 3. Activity log: record structured action details

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

## 6. Make archiving more deliberate ✅ Done

The archived state should be **more visible**, and the archive **action should be
less easy** to trigger by accident.

- More visible: today an archived item is just dimmed with a small badge — make the
  status clearer (e.g. stronger banner/treatment on the task page and cards).
- Less easy: today archive is a single icon-button click — guard it (confirmation
  dialog, or move it behind an overflow menu) so it isn't a one-tap mistake.

Implemented: a reusable `ConfirmDialog` now guards the archive direction on both the
task page and the project (unarchive stays one click); the task page shows an amber
archived banner; and archived cards get a dashed muted border + clearer badge.
