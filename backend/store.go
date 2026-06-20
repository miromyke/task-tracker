package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// ---- Models ----

type User struct {
	ID         int64   `json:"id"`
	Username   string  `json:"username"`
	Name       string  `json:"name"`
	AvatarPath *string `json:"avatarPath"`
}

type Project struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedBy   int64  `json:"createdBy"`
	CreatedAt   string `json:"createdAt"`
	TaskCount   int    `json:"taskCount"`
}

type Task struct {
	ID          int64   `json:"id"`
	ProjectID   int64   `json:"projectId"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Tag         string  `json:"tag"`
	AssigneeID  *int64  `json:"assigneeId"`
	DueDate     *string `json:"dueDate"`
	Status      string  `json:"status"`
	CreatedBy   int64   `json:"createdBy"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

type LogItem struct {
	ID          int64   `json:"id"`
	TaskID      int64   `json:"taskId"`
	UserID      int64   `json:"userId"`
	Type        string  `json:"type"` // created | note | status_change | due_date_change | edit
	Text        string  `json:"text"`
	FromStatus  *string `json:"fromStatus"`
	ToStatus    *string `json:"toStatus"`
	Attachments []Asset `json:"attachments"`
	CreatedAt   string  `json:"createdAt"`
}

// Asset is an uploaded file (image, video, document, or other). Bytes live on
// the uploads volume; this row holds the metadata. project_id is denormalized so
// the Files page can filter without walking tasks/logs. thumb_path/width/height/
// duration are reserved (e.g. for future video posters) and may be null.
type Asset struct {
	ID         int64    `json:"id"`
	ProjectID  int64    `json:"projectId"`
	TaskID     *int64   `json:"taskId"`
	LogID      *int64   `json:"logId"`
	UploadedBy int64    `json:"uploadedBy"`
	Kind       string   `json:"kind"` // image | video | document | other
	Mime       string   `json:"mime"`
	Filename   string   `json:"filename"` // original name, for display + download
	Path       string   `json:"path"`     // /api/uploads/<random>
	ThumbPath  *string  `json:"thumbPath"`
	Size       int64    `json:"size"`
	Width      *int     `json:"width"`
	Height     *int     `json:"height"`
	Duration   *float64 `json:"duration"`
	CreatedAt  string   `json:"createdAt"`
}

// TaskChanges describes a partial update; only fields that are set are applied.
type TaskChanges struct {
	Title       *string
	Description *string
	Tag         *string
	SetAssignee bool
	AssigneeID  *int64 // nil with SetAssignee=true clears the assignee
	SetDueDate  bool
	DueDate     *string // nil/empty with SetDueDate=true clears the due date
	Status      *string
}

// ---- Store ----

type Store struct{ db *sql.DB }

func OpenStore(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite handles a single writer at a time; serialize to avoid "database is locked".
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  avatar_path TEXT,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tag         TEXT NOT NULL,
  assignee_id INTEGER REFERENCES users(id),
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'todo',
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS log_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  text        TEXT NOT NULL DEFAULT '',
  from_status TEXT,
  to_status   TEXT,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  task_id     INTEGER REFERENCES tasks(id),
  log_id      INTEGER REFERENCES log_items(id),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  filename    TEXT NOT NULL,
  path        TEXT NOT NULL,
  thumb_path  TEXT,
  size        INTEGER NOT NULL DEFAULT 0,
  width       INTEGER,
  height      INTEGER,
  duration    REAL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_logs_task ON log_items(task_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON log_items(created_at);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assets_log ON assets(log_id);
`

func (s *Store) Migrate() error {
	_, err := s.db.Exec(schema)
	return err
}

func nowUTC() string { return time.Now().UTC().Format(time.RFC3339) }

func nullInt(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullStr(p *string) any {
	if p == nil || *p == "" {
		return nil
	}
	return *p
}

func eqInt64Ptr(a, b *int64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func coalesce(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func eqStrPtr(a, b *string) bool { return coalesce(a) == coalesce(b) }

func dueDisplay(p *string) string {
	if p == nil || *p == "" {
		return "none"
	}
	return *p
}

// ---- Users ----

const userCols = "id, username, name, avatar_path"

type scanner interface{ Scan(dest ...any) error }

func scanUser(sc scanner) (*User, error) {
	var u User
	var avatar sql.NullString
	if err := sc.Scan(&u.ID, &u.Username, &u.Name, &avatar); err != nil {
		return nil, err
	}
	if avatar.Valid {
		v := avatar.String
		u.AvatarPath = &v
	}
	return &u, nil
}

func (s *Store) SeedUsers(users map[string]string) error {
	now := nowUTC()
	for username, name := range users {
		_, err := s.db.Exec(
			`INSERT INTO users (username, name, created_at) VALUES (?,?,?)
			 ON CONFLICT(username) DO UPDATE SET name=excluded.name`,
			username, name, now)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) GetUserByUsername(username string) (*User, error) {
	row := s.db.QueryRow("SELECT "+userCols+" FROM users WHERE username=?", username)
	u, err := scanUser(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func (s *Store) GetUser(id int64) (*User, error) {
	row := s.db.QueryRow("SELECT "+userCols+" FROM users WHERE id=?", id)
	u, err := scanUser(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query("SELECT " + userCols + " FROM users ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func (s *Store) SetAvatar(id int64, path string) error {
	_, err := s.db.Exec("UPDATE users SET avatar_path=? WHERE id=?", path, id)
	return err
}

// ---- Projects ----

func (s *Store) ListProjects() ([]Project, error) {
	rows, err := s.db.Query(`
		SELECT p.id, p.name, p.description, p.created_by, p.created_at,
		       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS cnt
		FROM projects p ORDER BY p.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.CreatedBy, &p.CreatedAt, &p.TaskCount); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) GetProject(id int64) (*Project, error) {
	row := s.db.QueryRow("SELECT id, name, description, created_by, created_at FROM projects WHERE id=?", id)
	var p Project
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.CreatedBy, &p.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &p, err
}

func (s *Store) CreateProject(name, desc string, by int64) (*Project, error) {
	now := nowUTC()
	res, err := s.db.Exec("INSERT INTO projects (name, description, created_by, created_at) VALUES (?,?,?,?)",
		name, desc, by, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetProject(id)
}

// ---- Tasks ----

const taskCols = "id, project_id, title, description, tag, assignee_id, due_date, status, created_by, created_at, updated_at"

func scanTask(sc scanner) (*Task, error) {
	var t Task
	var assignee sql.NullInt64
	var due sql.NullString
	if err := sc.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Description, &t.Tag,
		&assignee, &due, &t.Status, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return nil, err
	}
	if assignee.Valid {
		v := assignee.Int64
		t.AssigneeID = &v
	}
	if due.Valid {
		v := due.String
		t.DueDate = &v
	}
	return &t, nil
}

func (s *Store) ListTasks(projectID int64, status, tag string) ([]Task, error) {
	// projectID == 0 means "all projects".
	q := "SELECT " + taskCols + " FROM tasks WHERE 1=1"
	args := []any{}
	if projectID != 0 {
		q += " AND project_id=?"
		args = append(args, projectID)
	}
	if status != "" {
		q += " AND status=?"
		args = append(args, status)
	}
	if tag != "" {
		q += " AND tag=?"
		args = append(args, tag)
	}
	q += ` ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
	        COALESCE(due_date, '9999-99-99'), id`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func (s *Store) GetTask(id int64) (*Task, error) {
	row := s.db.QueryRow("SELECT "+taskCols+" FROM tasks WHERE id=?", id)
	t, err := scanTask(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return t, err
}

func (s *Store) CreateTask(projectID int64, title, desc, tag string, assignee *int64, due *string, status string, by int64) (*Task, error) {
	now := nowUTC()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(`INSERT INTO tasks
		(project_id, title, description, tag, assignee_id, due_date, status, created_by, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?)`,
		projectID, title, desc, tag, nullInt(assignee), nullStr(due), status, by, now, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()

	if _, err := tx.Exec(
		`INSERT INTO log_items (task_id, user_id, type, text, created_at) VALUES (?,?,?,?,?)`,
		id, by, "created", "Created task", now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetTask(id)
}

// UpdateTask applies the given changes, appending log items for status changes,
// due-date changes, and field edits. Returns the updated task and any new logs.
func (s *Store) UpdateTask(taskID, actor int64, ch TaskChanges) (*Task, []LogItem, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	cur, err := scanTask(tx.QueryRow("SELECT "+taskCols+" FROM tasks WHERE id=?", taskID))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil, nil
		}
		return nil, nil, err
	}

	nt := *cur
	var edits []string
	if ch.Title != nil && *ch.Title != cur.Title {
		nt.Title = *ch.Title
		edits = append(edits, "title")
	}
	if ch.Description != nil && *ch.Description != cur.Description {
		nt.Description = *ch.Description
		edits = append(edits, "description")
	}
	if ch.Tag != nil && *ch.Tag != cur.Tag {
		nt.Tag = *ch.Tag
		edits = append(edits, "tag")
	}
	if ch.SetAssignee && !eqInt64Ptr(ch.AssigneeID, cur.AssigneeID) {
		nt.AssigneeID = ch.AssigneeID
		edits = append(edits, "assignee")
	}

	dueChanged := false
	var oldDue, newDue string
	if ch.SetDueDate && !eqStrPtr(ch.DueDate, cur.DueDate) {
		oldDue, newDue = dueDisplay(cur.DueDate), dueDisplay(ch.DueDate)
		nt.DueDate = ch.DueDate
		dueChanged = true
	}

	statusChanged := false
	var fromS, toS string
	if ch.Status != nil && *ch.Status != cur.Status {
		fromS, toS = cur.Status, *ch.Status
		nt.Status = *ch.Status
		statusChanged = true
	}

	now := nowUTC()
	nt.UpdatedAt = now
	if _, err := tx.Exec(
		`UPDATE tasks SET title=?, description=?, tag=?, assignee_id=?, due_date=?, status=?, updated_at=? WHERE id=?`,
		nt.Title, nt.Description, nt.Tag, nullInt(nt.AssigneeID), nullStr(nt.DueDate), nt.Status, now, taskID); err != nil {
		return nil, nil, err
	}

	var logs []LogItem
	addLog := func(typ, text string, from, to *string) error {
		res, err := tx.Exec(
			`INSERT INTO log_items (task_id, user_id, type, text, from_status, to_status, created_at)
			 VALUES (?,?,?,?,?,?,?)`,
			taskID, actor, typ, text, nullStr(from), nullStr(to), now)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		logs = append(logs, LogItem{ID: id, TaskID: taskID, UserID: actor, Type: typ, Text: text,
			FromStatus: from, ToStatus: to, CreatedAt: now})
		return nil
	}

	if statusChanged {
		if err := addLog("status_change", "", &fromS, &toS); err != nil {
			return nil, nil, err
		}
	}
	if dueChanged {
		if err := addLog("due_date_change", fmt.Sprintf("Due date: %s → %s", oldDue, newDue), nil, nil); err != nil {
			return nil, nil, err
		}
	}
	if len(edits) > 0 {
		if err := addLog("edit", "Updated "+strings.Join(edits, ", "), nil, nil); err != nil {
			return nil, nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return &nt, logs, nil
}

// ---- Logs ----

const logCols = "id, task_id, user_id, type, text, from_status, to_status, created_at"

func scanLog(sc scanner) (*LogItem, error) {
	var l LogItem
	var from, to sql.NullString
	if err := sc.Scan(&l.ID, &l.TaskID, &l.UserID, &l.Type, &l.Text, &from, &to, &l.CreatedAt); err != nil {
		return nil, err
	}
	if from.Valid {
		v := from.String
		l.FromStatus = &v
	}
	if to.Valid {
		v := to.String
		l.ToStatus = &v
	}
	l.Attachments = []Asset{}
	return &l, nil
}

// SavedFile is the metadata for a file already written to the uploads volume,
// ready to be recorded as an asset row.
type SavedFile struct {
	Path     string
	Filename string
	Mime     string
	Kind     string
	Size     int64
}

// AddNote appends a manual note plus any attached files, recording each file as
// an asset linked to the new log entry. Runs in one transaction.
func (s *Store) AddNote(taskID, userID, projectID int64, text string, files []SavedFile) (*LogItem, error) {
	now := nowUTC()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO log_items (task_id, user_id, type, text, created_at) VALUES (?,?,?,?,?)`,
		taskID, userID, "note", text, now)
	if err != nil {
		return nil, err
	}
	logID, _ := res.LastInsertId()

	li := &LogItem{ID: logID, TaskID: taskID, UserID: userID, Type: "note", Text: text,
		Attachments: []Asset{}, CreatedAt: now}
	for _, f := range files {
		ar, err := tx.Exec(
			`INSERT INTO assets (project_id, task_id, log_id, uploaded_by, kind, mime, filename, path, size, created_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?)`,
			projectID, taskID, logID, userID, f.Kind, f.Mime, f.Filename, f.Path, f.Size, now)
		if err != nil {
			return nil, err
		}
		aid, _ := ar.LastInsertId()
		tid, lid := taskID, logID
		li.Attachments = append(li.Attachments, Asset{
			ID: aid, ProjectID: projectID, TaskID: &tid, LogID: &lid, UploadedBy: userID,
			Kind: f.Kind, Mime: f.Mime, Filename: f.Filename, Path: f.Path, Size: f.Size, CreatedAt: now,
		})
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return li, nil
}

func (s *Store) ListLogs(taskID int64) ([]LogItem, error) {
	rows, err := s.db.Query("SELECT "+logCols+" FROM log_items WHERE task_id=? ORDER BY created_at, id", taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LogItem{}
	ids := []int64{}
	for rows.Next() {
		l, err := scanLog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
		ids = append(ids, l.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	byLog, err := s.assetsByLogIDs(ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if a := byLog[out[i].ID]; a != nil {
			out[i].Attachments = a
		}
	}
	return out, nil
}

// ---- Assets ----

const assetCols = "id, project_id, task_id, log_id, uploaded_by, kind, mime, filename, path, thumb_path, size, width, height, duration, created_at"

func scanAsset(sc scanner) (*Asset, error) {
	var a Asset
	var taskID, logID sql.NullInt64
	var thumb sql.NullString
	var width, height sql.NullInt64
	var duration sql.NullFloat64
	if err := sc.Scan(&a.ID, &a.ProjectID, &taskID, &logID, &a.UploadedBy, &a.Kind, &a.Mime,
		&a.Filename, &a.Path, &thumb, &a.Size, &width, &height, &duration, &a.CreatedAt); err != nil {
		return nil, err
	}
	if taskID.Valid {
		a.TaskID = &taskID.Int64
	}
	if logID.Valid {
		a.LogID = &logID.Int64
	}
	if thumb.Valid {
		a.ThumbPath = &thumb.String
	}
	if width.Valid {
		v := int(width.Int64)
		a.Width = &v
	}
	if height.Valid {
		v := int(height.Int64)
		a.Height = &v
	}
	if duration.Valid {
		a.Duration = &duration.Float64
	}
	return &a, nil
}

// assetColsQ is assetCols with the assets table aliased as `a`, for queries that
// join other tables (column names like id/project_id would otherwise be ambiguous).
const assetColsQ = "a.id, a.project_id, a.task_id, a.log_id, a.uploaded_by, a.kind, a.mime, a.filename, a.path, a.thumb_path, a.size, a.width, a.height, a.duration, a.created_at"

// ListAssets returns uploaded files newest-first, optionally scoped by project,
// kind, and task tag. projectID == 0 means all projects; empty kind/tag skip that
// filter. limit/offset paginate.
func (s *Store) ListAssets(projectID int64, kind, tag string, limit, offset int) ([]Asset, error) {
	q := "SELECT " + assetColsQ + " FROM assets a"
	args := []any{}
	if tag != "" {
		q += " JOIN tasks t ON t.id = a.task_id"
	}
	q += " WHERE 1=1"
	if projectID != 0 {
		q += " AND a.project_id = ?"
		args = append(args, projectID)
	}
	if kind != "" {
		q += " AND a.kind = ?"
		args = append(args, kind)
	}
	if tag != "" {
		q += " AND t.tag = ?"
		args = append(args, tag)
	}
	q += " ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Asset{}
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// assetsByLogIDs returns the assets for the given log entries, grouped by log_id.
func (s *Store) assetsByLogIDs(ids []int64) (map[int64][]Asset, error) {
	out := map[int64][]Asset{}
	if len(ids) == 0 {
		return out, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := s.db.Query("SELECT "+assetCols+" FROM assets WHERE log_id IN ("+ph+") ORDER BY id", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		if a.LogID != nil {
			out[*a.LogID] = append(out[*a.LogID], *a)
		}
	}
	return out, rows.Err()
}

func (s *Store) ListTags() ([]string, error) {
	rows, err := s.db.Query("SELECT DISTINCT tag FROM tasks WHERE tag <> '' ORDER BY tag")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
