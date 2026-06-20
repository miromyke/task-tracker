# House Renovation Planner

A simple, mobile-first project planner for a house renovation. Projects → tasks →
an append-only activity log (text + images), a per-project Kanban board, and a
GitHub-style activity calendar with a per-day report carousel.

## Stack

- **Frontend:** React + Vite + TypeScript, shadcn/ui + Tailwind (mobile-first)
- **Backend:** Go (standard library), serves the API and the built frontend
- **Database:** SQLite (single file on a Docker volume)
- **Images:** stored on a Docker volume; the DB keeps the path
- **Deploy:** one container via `docker-compose`

## Concepts

- **Auth:** username-only, no passwords. Allowed usernames are pre-seeded via
  `APP_USERS`. Login issues a signed, long-lived cookie.
- **Projects** are shared — everyone sees all projects.
- **Tasks** have a required tag, optional assignee, due date, and a status
  (`todo` / `in_progress` / `done` / `abandoned`). Tasks are never deleted, only
  abandoned.
- **Log** is append-only. Manual notes (text + optional image) plus automatic
  entries on status changes, due-date changes, and field edits.
- **Calendar:** a day is **gold** if any task transitioned into `done` that day,
  otherwise **green** with intensity by activity volume. Tap a day for a report.

## Configuration (environment variables)

| Variable      | Default            | Description                                              |
| ------------- | ------------------ | -------------------------------------------------------- |
| `APP_USERS`   | `admin:Admin`      | Allowed users, `username:Display Name`, comma-separated. |
| `APP_SECRET`  | _(ephemeral)_      | Secret for signing cookies. **Set this in production.**  |
| `APP_TZ`      | `UTC`              | Timezone for grouping activity into days (IANA name).    |
| `PORT`        | `8080`             | Port to listen on.                                       |
| `DB_PATH`     | `./data/app.db`    | SQLite file path.                                        |
| `UPLOADS_DIR` | `./data/uploads`   | Directory for uploaded images.                           |
| `STATIC_DIR`  | _(empty)_          | If set, serves the built frontend (set in Docker image). |

## Deploy on a VM

Point your domain's DNS **A record** at the VM's public IP, and open ports
**80** and **443** in the firewall / cloud security group. Then:

```sh
cp .env.example .env   # edit APP_USERS, APP_SECRET, DOMAIN, ACME_EMAIL
docker compose up -d --build
```

Caddy fetches a Let's Encrypt certificate on first start and redirects
HTTP→HTTPS, so the app is served on `https://<domain>`. The Go app itself is
not exposed to the host — only Caddy faces the internet.

Port 80 must stay reachable from the internet: Let's Encrypt uses it to
validate the domain and to renew the cert automatically.

Data (DB + uploads) persists in the `reno_data` Docker volume; TLS certs live
in `caddy_data`. Back up by copying those volumes.

## Local development

Backend:

```sh
cd backend
APP_USERS="me:Me" APP_SECRET=dev go run .
# API on http://localhost:8080
```

Frontend (proxies `/api` to the backend — added in the next step):

```sh
cd frontend
npm install
npm run dev
```

## API overview

| Method | Path                         | Purpose                               |
| ------ | ---------------------------- | ------------------------------------- |
| POST   | `/api/login`                 | Log in with a username                |
| POST   | `/api/logout`                | Log out                               |
| GET    | `/api/me`                    | Current user                          |
| GET    | `/api/users`                 | List users (for assignees)            |
| POST   | `/api/users/avatar`          | Upload own avatar (multipart `image`) |
| GET    | `/api/projects`              | List projects (with task counts)      |
| POST   | `/api/projects`              | Create a project                      |
| GET    | `/api/projects/{id}`         | Get a project                         |
| GET    | `/api/projects/{id}/tasks`   | List tasks (`?status=`, `?tag=`)      |
| POST   | `/api/projects/{id}/tasks`   | Create a task                         |
| GET    | `/api/tasks/{id}`            | Task + full log                       |
| PATCH  | `/api/tasks/{id}`            | Update fields (auto-logs changes)     |
| POST   | `/api/tasks/{id}/log`        | Add a note (multipart `text`/`image`) |
| GET    | `/api/tags`                  | Distinct tags                         |
| GET    | `/api/calendar`              | Daily rollup (`?from=&to=&tag=`)      |
| GET    | `/api/calendar/day/{date}`   | Day report events (`?tag=`)           |
| GET    | `/api/uploads/{file}`        | Serve an uploaded image               |
