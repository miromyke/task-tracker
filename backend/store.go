package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// errCriteriaUnmet is returned when a task is moved to "done" while some of its
// success criteria are still unchecked. Handlers map this to a 400.
var errCriteriaUnmet = errors.New("all success criteria must be checked before marking as done")

// errBlockedRef is returned when a task is moved to "blocked" without a valid
// reference to the (other, existing) task that blocks it. Handlers map this to a 400.
var errBlockedRef = errors.New("a blocked task must reference another existing task that blocks it")

// ---- Models ----

type User struct {
	ID         int64   `json:"id"`
	Username   string  `json:"username"`
	Name       string  `json:"name"`
	AvatarPath *string `json:"avatarPath"`
	Role       string  `json:"role"`     // "admin" | "member"
	Disabled   bool    `json:"disabled"` // soft-disabled: cannot log in
	// PasswordHash is never serialized to clients. Nil means "not set up yet"
	// (the account exists but cannot log in until an admin sets a password).
	PasswordHash *string `json:"-"`
}

func (u *User) IsAdmin() bool { return u.Role == roleAdmin }

const (
	roleAdmin  = "admin"
	roleMember = "member"
)

type Project struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedBy   int64  `json:"createdBy"`
	CreatedAt   string `json:"createdAt"`
	TaskCount   int    `json:"taskCount"`
	Archived    bool   `json:"archived"`
}

type Task struct {
	ID          int64       `json:"id"`
	ProjectID   int64       `json:"projectId"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Tags        []string    `json:"tags"`
	Criteria    []Criterion `json:"criteria"`
	AssigneeID  *int64      `json:"assigneeId"`
	DueDate     *string     `json:"dueDate"`
	Status      string      `json:"status"`
	// PostponeCount is how many times the due date was pushed to a later date.
	PostponeCount int    `json:"postponeCount"`
	CreatedBy     int64  `json:"createdBy"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
	// Archived hides a task from the default board/list without abandoning it.
	// Reversible; archived tasks keep their status and full history.
	Archived bool `json:"archived"`
	// Blocked-task fields are populated only while Status == "blocked".
	// BlockedByTaskID references the task that blocks this one (required when
	// blocked); BlockedReason is an optional free-text explanation.
	BlockedByTaskID *int64 `json:"blockedByTaskId"`
	BlockedReason   string `json:"blockedReason"`
}

// Criterion is one item on a task's success-criteria checklist (its definition
// of done). Every non-abandoned criterion must be done before the task may move
// to "done". Criteria are immutable once created: their text never changes, and
// they are never deleted — only abandoned (mirroring how tasks work).
type Criterion struct {
	ID        int64  `json:"id"`
	TaskID    int64  `json:"taskId"`
	Text      string `json:"text"`
	Done      bool   `json:"done"`
	Abandoned bool   `json:"abandoned"`
	Position  int    `json:"position"`
}

// CriterionInput is one item in a checklist edit. ID is nil for a new item;
// existing items carry their ID. The form can add new items or abandon/restore
// existing ones — it never changes an existing item's text (the store ignores
// text on items that already exist).
type CriterionInput struct {
	ID        *int64 `json:"id"`
	Text      string `json:"text"`
	Abandoned bool   `json:"abandoned"`
}

type LogItem struct {
	ID         int64  `json:"id"`
	TaskID     int64  `json:"taskId"`
	UserID     int64  `json:"userId"`
	// Type values: created | note | status_change | due_date_change |
	// assignee_change | title_change | description_change | tags_change |
	// criteria_change | criterion_check | archive (legacy rows may carry the
	// retired "edit").
	Type string `json:"type"`
	Text       string `json:"text"`
	FromStatus *string `json:"fromStatus"`
	ToStatus   *string `json:"toStatus"`
	// Details is a structured, language-neutral payload describing exactly what
	// changed (block reason + blocker, due from→to, archive direction, tag and
	// checklist diffs). It supersedes Text for new entries so the activity log
	// survives translation and stays queryable; older rows have it null and fall
	// back to Text. See the *Details types below for the per-action shape.
	Details     json.RawMessage `json:"details,omitempty"`
	Attachments []Asset         `json:"attachments"`
	CreatedAt   string          `json:"createdAt"`
}

// Structured shapes serialized into LogItem.Details, one per action type. All
// fields use omitempty so an absent change leaves no key.
type blockedDetails struct {
	Reason          string `json:"reason,omitempty"`
	BlockedByTaskID *int64 `json:"blockedByTaskId,omitempty"`
}

type dueDateDetails struct {
	From *string `json:"from"` // YYYY-MM-DD or null (no prior date)
	To   *string `json:"to"`   // YYYY-MM-DD or null (date cleared)
}

type assigneeDetails struct {
	FromUser *int64 `json:"fromUser"` // prior assignee id, or null (was unassigned)
	ToUser   *int64 `json:"toUser"`   // new assignee id, or null (now unassigned)
}

type archiveDetails struct {
	Archived bool `json:"archived"`
}

type titleChangeDetails struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type criterionCheckDetails struct {
	Criterion string `json:"criterion"`
	Done      bool   `json:"done"`
}

// tagDiff is the payload for a tags_change entry; criteriaDiff for criteria_change.
type tagDiff struct {
	Added   []string `json:"added,omitempty"`
	Removed []string `json:"removed,omitempty"`
}

type criteriaDiff struct {
	Added     []string `json:"added,omitempty"`
	Abandoned []string `json:"abandoned,omitempty"`
	Restored  []string `json:"restored,omitempty"`
}

// Asset is an uploaded file (image, video, document, or other). Bytes live on
// the uploads volume; this row holds the metadata. project_id is denormalized so
// the Files page can filter without walking tasks/logs; it's null for files not
// tied to a project (e.g. chat uploads). thumb_path/width/height/duration are
// reserved (e.g. for future video posters) and may be null.
type Asset struct {
	ID         int64    `json:"id"`
	ProjectID  *int64   `json:"projectId"`
	TaskID     *int64   `json:"taskId"`
	LogID      *int64   `json:"logId"`
	// Source records where a project-less upload originated when it isn't otherwise
	// derivable — currently "chat" for files uploaded from the chat composer, ""
	// for a direct Files-page upload. Task/project context is read from the ids above.
	Source     string   `json:"source"`
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
	// Soft-deletion: when DeletionRequestedAt is set the asset is hidden from the
	// normal Files grid and waits in the admin-facing "Submitted for deletion" tab
	// until an admin purges it (row + bytes) or restores it. Both nil otherwise.
	DeletionRequestedAt *string `json:"deletionRequestedAt"`
	DeletionRequestedBy *int64  `json:"deletionRequestedBy"`
}

// Channel is a global chat channel. Like projects, channels are shared (everyone
// sees every channel) and reversibly archived rather than deleted. MessageCount
// and LastMessageAt are denormalized for the channel-list display.
type Channel struct {
	ID            int64   `json:"id"`
	Name          string  `json:"name"`
	Description   string  `json:"description"`
	CreatedBy     int64   `json:"createdBy"`
	CreatedAt     string  `json:"createdAt"`
	Archived      bool    `json:"archived"`
	MessageCount  int     `json:"messageCount"`
	LastMessageAt *string `json:"lastMessageAt"`
}

// Message is one chat message. Text stores raw reference tokens (@username,
// #<taskID>, #file<assetID>) that the frontend resolves at render time, so the
// stored text stays language-neutral and survives renames. Append-only: messages
// are never edited or deleted.
type Message struct {
	ID        int64  `json:"id"`
	ChannelID int64  `json:"channelId"`
	UserID    int64  `json:"userId"`
	Text      string `json:"text"`
	CreatedAt string `json:"createdAt"`
}

// TaskChanges describes a partial update; only fields that are set are applied.
type TaskChanges struct {
	Title       *string
	Description *string
	Tags        *[]string         // non-nil replaces the full tag set
	Criteria    *[]CriterionInput // non-nil replaces the full criteria set
	SetAssignee bool
	AssigneeID  *int64 // nil with SetAssignee=true clears the assignee
	SetDueDate  bool
	DueDate     *string // nil/empty with SetDueDate=true clears the due date
	Status      *string
	SetArchived bool
	Archived    bool
	// SetBlockedBy reports whether the request carried a blockedByTaskId; the value
	// (nil clears it). BlockedReason is non-nil when the request set a reason. These
	// only take effect when the resulting status is "blocked".
	SetBlockedBy    bool
	BlockedByTaskID *int64
	BlockedReason   *string
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
  created_at  TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id INTEGER REFERENCES users(id),
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'todo',
  postpone_count INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT,
  blocked_by_task_id INTEGER REFERENCES tasks(id),
  blocked_reason     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  tag     TEXT NOT NULL,
  PRIMARY KEY (task_id, tag)
);
CREATE TABLE IF NOT EXISTS task_criteria (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  text       TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  abandoned  INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS log_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  text        TEXT NOT NULL DEFAULT '',
  from_status TEXT,
  to_status   TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES projects(id),
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
CREATE TABLE IF NOT EXISTS channels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_logs_task ON log_items(task_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON log_items(created_at);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assets_log ON assets(log_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag);
CREATE INDEX IF NOT EXISTS idx_criteria_task ON task_criteria(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);
`

func (s *Store) Migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	if err := s.migrateTaskTags(); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("tasks", "postpone_count", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("task_criteria", "abandoned", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("users", "role", "TEXT NOT NULL DEFAULT 'member'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("users", "disabled", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("users", "password_hash", "TEXT"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("projects", "archived_at", "TEXT"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("tasks", "archived_at", "TEXT"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("tasks", "blocked_by_task_id", "INTEGER"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("tasks", "blocked_reason", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("log_items", "details", "TEXT"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("assets", "deletion_requested_at", "TEXT"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("assets", "deletion_requested_by", "INTEGER"); err != nil {
		return err
	}
	if err := s.migrateAssetsProjectNullable(); err != nil {
		return err
	}
	// source is added after the project-nullable rebuild (which copies a fixed
	// column set) so the rebuild can't drop it. Marks where an upload came from
	// (e.g. "chat") when it isn't derivable from the task/project ids.
	return s.addColumnIfMissing("assets", "source", "TEXT NOT NULL DEFAULT ''")
}

// migrateAssetsProjectNullable drops the NOT NULL constraint on assets.project_id
// so files can be uploaded without a project (e.g. chat uploads). SQLite can't
// alter a column constraint in place, so existing databases need a table rebuild;
// no other table references assets, which makes the drop/rename FK-safe. Runs once
// — once project_id is nullable this is a no-op. Must run after the deletion_*
// columns are added so the rebuilt table carries the full, current column set.
func (s *Store) migrateAssetsProjectNullable() error {
	var notnull int
	if err := s.db.QueryRow(
		"SELECT \"notnull\" FROM pragma_table_info('assets') WHERE name='project_id'").Scan(&notnull); err != nil {
		return err
	}
	if notnull == 0 {
		return nil // already nullable (fresh DB or already migrated)
	}
	const rebuild = `
CREATE TABLE assets_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES projects(id),
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
  created_at  TEXT NOT NULL,
  deletion_requested_at TEXT,
  deletion_requested_by INTEGER
);
INSERT INTO assets_new
  SELECT id, project_id, task_id, log_id, uploaded_by, kind, mime, filename, path,
         thumb_path, size, width, height, duration, created_at,
         deletion_requested_at, deletion_requested_by
  FROM assets;
DROP TABLE assets;
ALTER TABLE assets_new RENAME TO assets;
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assets_log ON assets(log_id);
`
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(rebuild); err != nil {
		return err
	}
	return tx.Commit()
}

// addColumnIfMissing adds a column to a table if it isn't there yet, so existing
// databases pick up new fields. CREATE TABLE IF NOT EXISTS never alters an
// existing table, so additive schema changes need this.
func (s *Store) addColumnIfMissing(table, column, def string) error {
	var has int
	if err := s.db.QueryRow(
		"SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?", table, column).Scan(&has); err != nil {
		return err
	}
	if has > 0 {
		return nil
	}
	_, err := s.db.Exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + def)
	return err
}

// migrateTaskTags moves the legacy single tasks.tag column into the task_tags
// table. Tasks used to carry exactly one tag; they can now carry many. This runs
// once: the presence of the old column is the "not yet migrated" marker, so after
// the backfill we drop it and subsequent startups become no-ops.
func (s *Store) migrateTaskTags() error {
	var hasCol int
	if err := s.db.QueryRow(
		"SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'tag'").Scan(&hasCol); err != nil {
		return err
	}
	if hasCol == 0 {
		return nil // already migrated (or a fresh database)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		"INSERT OR IGNORE INTO task_tags (task_id, tag) SELECT id, tag FROM tasks WHERE tag <> ''"); err != nil {
		return err
	}
	if _, err := tx.Exec("ALTER TABLE tasks DROP COLUMN tag"); err != nil {
		return err
	}
	return tx.Commit()
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

// marshalDetails serializes a log entry's structured details to JSON, returning
// nil when there's nothing worth recording (so the column stays null).
func marshalDetails(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	switch string(b) {
	case "null", "{}":
		return nil
	}
	return b
}

// nullJSON stores a details payload as a TEXT value (string), or null when empty.
func nullJSON(b json.RawMessage) any {
	if len(b) == 0 {
		return nil
	}
	return string(b)
}

// diffStrings returns the members of a that are not in b. Both are expected to be
// the normalized (sorted, de-duplicated) tag sets.
func diffStrings(a, b []string) []string {
	set := make(map[string]bool, len(b))
	for _, x := range b {
		set[x] = true
	}
	out := []string{}
	for _, x := range a {
		if !set[x] {
			out = append(out, x)
		}
	}
	return out
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

const userCols = "id, username, name, avatar_path, role, disabled, password_hash"

type scanner interface{ Scan(dest ...any) error }

func scanUser(sc scanner) (*User, error) {
	var u User
	var avatar, hash sql.NullString
	if err := sc.Scan(&u.ID, &u.Username, &u.Name, &avatar, &u.Role, &u.Disabled, &hash); err != nil {
		return nil, err
	}
	if avatar.Valid {
		v := avatar.String
		u.AvatarPath = &v
	}
	if hash.Valid {
		v := hash.String
		u.PasswordHash = &v
	}
	return &u, nil
}

// EnsureAdmin upserts the bootstrap admin. The user is always promoted to admin
// and re-enabled; the password is set only when passwordHash is non-empty, so an
// empty APP_ADMIN_PASSWORD on a later boot never wipes an existing password.
func (s *Store) EnsureAdmin(username, name, passwordHash string) error {
	now := nowUTC()
	var hash any
	if passwordHash != "" {
		hash = passwordHash
	}
	_, err := s.db.Exec(
		`INSERT INTO users (username, name, role, disabled, password_hash, created_at)
		 VALUES (?,?,?,0,?,?)
		 ON CONFLICT(username) DO UPDATE SET
		   role='admin',
		   disabled=0,
		   password_hash=COALESCE(excluded.password_hash, users.password_hash)`,
		username, name, roleAdmin, hash, now)
	return err
}

// CreateUser inserts a new member with the given password hash.
func (s *Store) CreateUser(username, name, role, passwordHash string) (*User, error) {
	now := nowUTC()
	res, err := s.db.Exec(
		`INSERT INTO users (username, name, role, disabled, password_hash, created_at)
		 VALUES (?,?,?,0,?,?)`,
		username, name, role, passwordHash, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetUser(id)
}

func (s *Store) SetPassword(id int64, passwordHash string) error {
	_, err := s.db.Exec("UPDATE users SET password_hash=? WHERE id=?", passwordHash, id)
	return err
}

func (s *Store) SetRole(id int64, role string) error {
	_, err := s.db.Exec("UPDATE users SET role=? WHERE id=?", role, id)
	return err
}

func (s *Store) SetDisabled(id int64, disabled bool) error {
	_, err := s.db.Exec("UPDATE users SET disabled=? WHERE id=?", disabled, id)
	return err
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

// ListProjects returns projects newest-first. The task count excludes archived
// tasks. When includeArchived is false, archived projects are omitted entirely.
func (s *Store) ListProjects(includeArchived bool) ([]Project, error) {
	q := `
		SELECT p.id, p.name, p.description, p.created_by, p.created_at, p.archived_at,
		       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.archived_at IS NULL) AS cnt
		FROM projects p`
	if !includeArchived {
		q += " WHERE p.archived_at IS NULL"
	}
	q += " ORDER BY p.created_at DESC"
	rows, err := s.db.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		var archived sql.NullString
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.CreatedBy, &p.CreatedAt, &archived, &p.TaskCount); err != nil {
			return nil, err
		}
		p.Archived = archived.Valid
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) GetProject(id int64) (*Project, error) {
	row := s.db.QueryRow("SELECT id, name, description, created_by, created_at, archived_at FROM projects WHERE id=?", id)
	var p Project
	var archived sql.NullString
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.CreatedBy, &p.CreatedAt, &archived)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	p.Archived = archived.Valid
	return &p, err
}

// SetProjectArchived archives or unarchives a project (stamping archived_at).
func (s *Store) SetProjectArchived(id int64, archived bool) error {
	var at any
	if archived {
		at = nowUTC()
	}
	_, err := s.db.Exec("UPDATE projects SET archived_at=? WHERE id=?", at, id)
	return err
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

const taskCols = `id, project_id, title, description, assignee_id, due_date, status,
	postpone_count, created_by, created_at, updated_at, archived_at,
	blocked_by_task_id, blocked_reason`

func scanTask(sc scanner) (*Task, error) {
	var t Task
	var assignee sql.NullInt64
	var due, archived sql.NullString
	var blockedBy sql.NullInt64
	if err := sc.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Description,
		&assignee, &due, &t.Status, &t.PostponeCount, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt,
		&archived, &blockedBy, &t.BlockedReason); err != nil {
		return nil, err
	}
	t.Tags = []string{}
	t.Criteria = []Criterion{}
	if assignee.Valid {
		v := assignee.Int64
		t.AssigneeID = &v
	}
	if due.Valid {
		v := due.String
		t.DueDate = &v
	}
	t.Archived = archived.Valid
	if blockedBy.Valid {
		v := blockedBy.Int64
		t.BlockedByTaskID = &v
	}
	return &t, nil
}

func (s *Store) ListTasks(projectID int64, status, tag string, includeArchived bool) ([]Task, error) {
	// projectID == 0 means "all projects".
	q := "SELECT " + taskCols + " FROM tasks WHERE 1=1"
	args := []any{}
	if !includeArchived {
		// Hide archived tasks and any task belonging to an archived project.
		q += " AND tasks.archived_at IS NULL AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)"
	}
	if projectID != 0 {
		q += " AND project_id=?"
		args = append(args, projectID)
	}
	if status != "" {
		q += " AND status=?"
		args = append(args, status)
	}
	if tag != "" {
		q += " AND EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = tasks.id AND tt.tag = ?)"
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
	ids := []int64{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
		ids = append(ids, t.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	byTask, err := s.tagsByTaskIDs(ids)
	if err != nil {
		return nil, err
	}
	crByTask, err := s.criteriaByTaskIDs(ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if tg := byTask[out[i].ID]; tg != nil {
			out[i].Tags = tg
		}
		if cr := crByTask[out[i].ID]; cr != nil {
			out[i].Criteria = cr
		}
	}
	return out, nil
}

func (s *Store) GetTask(id int64) (*Task, error) {
	row := s.db.QueryRow("SELECT "+taskCols+" FROM tasks WHERE id=?", id)
	t, err := scanTask(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	tags, err := s.taskTags(id)
	if err != nil {
		return nil, err
	}
	t.Tags = tags
	criteria, err := s.taskCriteria(id)
	if err != nil {
		return nil, err
	}
	t.Criteria = criteria
	return t, nil
}

// taskTags returns one task's tags in alphabetical order.
func (s *Store) taskTags(taskID int64) ([]string, error) {
	rows, err := s.db.Query("SELECT tag FROM task_tags WHERE task_id=? ORDER BY tag", taskID)
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

// tagsByTaskIDs returns tags grouped by task_id, each group alphabetized.
func (s *Store) tagsByTaskIDs(ids []int64) (map[int64][]string, error) {
	out := map[int64][]string{}
	if len(ids) == 0 {
		return out, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := s.db.Query("SELECT task_id, tag FROM task_tags WHERE task_id IN ("+ph+") ORDER BY tag", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var tag string
		if err := rows.Scan(&id, &tag); err != nil {
			return nil, err
		}
		out[id] = append(out[id], tag)
	}
	return out, rows.Err()
}

// taskCriteria returns one task's checklist in display order.
func (s *Store) taskCriteria(taskID int64) ([]Criterion, error) {
	rows, err := s.db.Query(
		"SELECT id, task_id, text, done, abandoned, position FROM task_criteria WHERE task_id=? ORDER BY position, id", taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCriteria(rows)
}

// criteriaByTaskIDs returns checklists grouped by task_id, each in display order.
func (s *Store) criteriaByTaskIDs(ids []int64) (map[int64][]Criterion, error) {
	out := map[int64][]Criterion{}
	if len(ids) == 0 {
		return out, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := s.db.Query(
		"SELECT id, task_id, text, done, abandoned, position FROM task_criteria WHERE task_id IN ("+ph+") ORDER BY position, id", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list, err := scanCriteria(rows)
	if err != nil {
		return nil, err
	}
	for _, c := range list {
		out[c.TaskID] = append(out[c.TaskID], c)
	}
	return out, nil
}

// scanCriteria reads Criterion rows from a query selecting
// (id, task_id, text, done, abandoned, position).
func scanCriteria(rows *sql.Rows) ([]Criterion, error) {
	out := []Criterion{}
	for rows.Next() {
		var c Criterion
		if err := rows.Scan(&c.ID, &c.TaskID, &c.Text, &c.Done, &c.Abandoned, &c.Position); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// txTaskCriteria returns a task's checklist (display order) within a transaction.
func txTaskCriteria(tx *sql.Tx, taskID int64) ([]Criterion, error) {
	rows, err := tx.Query(
		"SELECT id, task_id, text, done, abandoned, position FROM task_criteria WHERE task_id=? ORDER BY position, id", taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCriteria(rows)
}

// reconcileCriteria applies a checklist edit inside a tx. Criteria are immutable
// and never deleted: items carrying an existing ID may only have their abandoned
// flag (and display position) changed — their text and done state are left
// untouched. Items without an ID are appended as new. Blank new items are
// dropped. Returns the resulting checklist in display order.
func reconcileCriteria(tx *sql.Tx, taskID int64, inputs []CriterionInput, now string) ([]Criterion, error) {
	existing := map[int64]bool{}
	rows, err := tx.Query("SELECT id FROM task_criteria WHERE task_id=?", taskID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		existing[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	pos := 0
	for _, in := range inputs {
		if in.ID != nil && existing[*in.ID] {
			// Existing item: only abandon/restore (and reposition). Text & done stay.
			if _, err := tx.Exec("UPDATE task_criteria SET abandoned=?, position=? WHERE id=? AND task_id=?",
				in.Abandoned, pos, *in.ID, taskID); err != nil {
				return nil, err
			}
		} else {
			text := strings.TrimSpace(in.Text)
			if text == "" {
				continue
			}
			if _, err := tx.Exec(
				"INSERT INTO task_criteria (task_id, text, done, abandoned, position, created_at) VALUES (?,?,0,?,?,?)",
				taskID, text, in.Abandoned, pos, now); err != nil {
				return nil, err
			}
		}
		pos++
	}
	return txTaskCriteria(tx, taskID)
}

// allCriteriaMet reports whether every non-abandoned item on a checklist is
// done. Abandoned items are ignored; an empty (or all-abandoned) checklist is
// vacuously met, so such tasks are never blocked from "done".
func allCriteriaMet(cs []Criterion) bool {
	for _, c := range cs {
		if !c.Abandoned && !c.Done {
			return false
		}
	}
	return true
}

// sameCriteria reports whether two checklists match in order, text, done, and
// abandoned state — used to decide whether an edit changed the checklist.
func sameCriteria(a, b []Criterion) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Text != b[i].Text || a[i].Done != b[i].Done || a[i].Abandoned != b[i].Abandoned {
			return false
		}
	}
	return true
}

// diffCriteria summarizes how a checklist changed: brand-new items (added) and
// items toggled into/out of the abandoned state. Criteria are matched by ID;
// text is immutable and items are never deleted, so there's no "removed". Returns
// nil when nothing notable changed.
func diffCriteria(prev, next []Criterion) *criteriaDiff {
	byID := make(map[int64]Criterion, len(prev))
	for _, c := range prev {
		byID[c.ID] = c
	}
	var d criteriaDiff
	for _, c := range next {
		old, existed := byID[c.ID]
		switch {
		case !existed:
			d.Added = append(d.Added, c.Text)
		case c.Abandoned && !old.Abandoned:
			d.Abandoned = append(d.Abandoned, c.Text)
		case !c.Abandoned && old.Abandoned:
			d.Restored = append(d.Restored, c.Text)
		}
	}
	if len(d.Added) == 0 && len(d.Abandoned) == 0 && len(d.Restored) == 0 {
		return nil
	}
	return &d
}

// taskExistsTx reports whether a task with the given id exists. Used to validate
// a blocked task's reference to the task that blocks it.
func taskExistsTx(tx *sql.Tx, id *int64) bool {
	if id == nil {
		return false
	}
	var n int
	if err := tx.QueryRow("SELECT COUNT(*) FROM tasks WHERE id=?", *id).Scan(&n); err != nil {
		return false
	}
	return n > 0
}

// txTaskTags returns a task's tags (alphabetical) within a transaction.
func txTaskTags(tx *sql.Tx, taskID int64) ([]string, error) {
	rows, err := tx.Query("SELECT tag FROM task_tags WHERE task_id=? ORDER BY tag", taskID)
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

// normalizeTags trims, drops blanks, de-duplicates, and sorts a tag list so it
// can be compared against the stored (alphabetical) set.
func normalizeTags(tags []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// setTaskTags replaces a task's tag set inside the given transaction. Blank tags
// are skipped; duplicates collapse via the primary key.
func setTaskTags(tx *sql.Tx, taskID int64, tags []string) error {
	if _, err := tx.Exec("DELETE FROM task_tags WHERE task_id=?", taskID); err != nil {
		return err
	}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if _, err := tx.Exec("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?,?)", taskID, tag); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) CreateTask(projectID int64, title, desc string, tags, criteria []string, assignee *int64, due *string, status string, blockedBy *int64, blockedReason string, by int64) (*Task, error) {
	now := nowUTC()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if status == "blocked" {
		if !taskExistsTx(tx, blockedBy) {
			return nil, errBlockedRef
		}
	} else {
		// Block fields only persist while blocked.
		blockedBy, blockedReason = nil, ""
	}

	res, err := tx.Exec(`INSERT INTO tasks
		(project_id, title, description, assignee_id, due_date, status, blocked_by_task_id, blocked_reason, created_by, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		projectID, title, desc, nullInt(assignee), nullStr(due), status, nullInt(blockedBy), blockedReason, by, now, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()

	if err := setTaskTags(tx, id, tags); err != nil {
		return nil, err
	}

	pos := 0
	for _, text := range criteria {
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if _, err := tx.Exec(
			"INSERT INTO task_criteria (task_id, text, done, position, created_at) VALUES (?,?,0,?,?)",
			id, text, pos, now); err != nil {
			return nil, err
		}
		pos++
	}

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
	curTags, err := txTaskTags(tx, taskID)
	if err != nil {
		return nil, nil, err
	}
	cur.Tags = curTags
	curCriteria, err := txTaskCriteria(tx, taskID)
	if err != nil {
		return nil, nil, err
	}
	cur.Criteria = curCriteria

	nt := *cur
	titleChanged := false
	oldTitle := cur.Title
	if ch.Title != nil && *ch.Title != cur.Title {
		nt.Title = *ch.Title
		titleChanged = true
	}
	descChanged := false
	if ch.Description != nil && *ch.Description != cur.Description {
		nt.Description = *ch.Description
		descChanged = true
	}
	tagsChanged := false
	var tagsAdded, tagsRemoved []string
	if ch.Tags != nil {
		newTags := normalizeTags(*ch.Tags)
		if !sameStrings(newTags, cur.Tags) {
			nt.Tags = newTags
			tagsChanged = true
			tagsAdded = diffStrings(newTags, cur.Tags)
			tagsRemoved = diffStrings(cur.Tags, newTags)
		}
	}
	assigneeChanged := false
	if ch.SetAssignee && !eqInt64Ptr(ch.AssigneeID, cur.AssigneeID) {
		nt.AssigneeID = ch.AssigneeID
		assigneeChanged = true
	}

	dueChanged := false
	if ch.SetDueDate && !eqStrPtr(ch.DueDate, cur.DueDate) {
		nt.DueDate = ch.DueDate
		dueChanged = true
		// A move to a strictly later date is a postponement; dates are stored as
		// YYYY-MM-DD so lexical comparison matches chronological order. Setting or
		// clearing a date (no prior/new date) doesn't count.
		if coalesce(cur.DueDate) != "" && coalesce(ch.DueDate) != "" && *ch.DueDate > *cur.DueDate {
			nt.PostponeCount = cur.PostponeCount + 1
		}
	}

	statusChanged := false
	var fromS, toS string
	if ch.Status != nil && *ch.Status != cur.Status {
		fromS, toS = cur.Status, *ch.Status
		nt.Status = *ch.Status
		statusChanged = true
	}

	// Resolve blocked-task fields. They persist only while the resulting status is
	// "blocked"; any other status clears them. A blocked task must reference a
	// different, existing task.
	if nt.Status == "blocked" {
		blockedBy := cur.BlockedByTaskID
		if ch.SetBlockedBy {
			blockedBy = ch.BlockedByTaskID
		}
		if blockedBy == nil || *blockedBy == taskID || !taskExistsTx(tx, blockedBy) {
			return nil, nil, errBlockedRef
		}
		nt.BlockedByTaskID = blockedBy
		if ch.BlockedReason != nil {
			nt.BlockedReason = strings.TrimSpace(*ch.BlockedReason)
		}
	} else {
		nt.BlockedByTaskID = nil
		nt.BlockedReason = ""
	}

	// Archive / unarchive — an organizational state, but now recorded in the
	// history (see the "archive" log entry emitted below).
	newArchived := cur.Archived
	if ch.SetArchived {
		newArchived = ch.Archived
	}
	nt.Archived = newArchived

	now := nowUTC()
	var archivedAt any
	if newArchived {
		archivedAt = now
	}

	// Reconcile the checklist (if the edit carries one) before the done-gate, so
	// the gate sees the final set the caller intends.
	criteriaChanged := false
	var critDiff *criteriaDiff
	if ch.Criteria != nil {
		reconciled, err := reconcileCriteria(tx, taskID, *ch.Criteria, now)
		if err != nil {
			return nil, nil, err
		}
		nt.Criteria = reconciled
		if !sameCriteria(curCriteria, reconciled) {
			criteriaChanged = true
			critDiff = diffCriteria(curCriteria, reconciled)
		}
	}

	// Block the move into "done" unless every success criterion is checked.
	if nt.Status == "done" && cur.Status != "done" && !allCriteriaMet(nt.Criteria) {
		return nil, nil, errCriteriaUnmet
	}

	nt.UpdatedAt = now
	if _, err := tx.Exec(
		`UPDATE tasks SET title=?, description=?, assignee_id=?, due_date=?, status=?, postpone_count=?, archived_at=?, blocked_by_task_id=?, blocked_reason=?, updated_at=? WHERE id=?`,
		nt.Title, nt.Description, nullInt(nt.AssigneeID), nullStr(nt.DueDate), nt.Status, nt.PostponeCount,
		archivedAt, nullInt(nt.BlockedByTaskID), nt.BlockedReason, now, taskID); err != nil {
		return nil, nil, err
	}
	if tagsChanged {
		if err := setTaskTags(tx, taskID, nt.Tags); err != nil {
			return nil, nil, err
		}
	}

	var logs []LogItem
	addLog := func(typ, text string, from, to *string, details json.RawMessage) error {
		res, err := tx.Exec(
			`INSERT INTO log_items (task_id, user_id, type, text, from_status, to_status, details, created_at)
			 VALUES (?,?,?,?,?,?,?,?)`,
			taskID, actor, typ, text, nullStr(from), nullStr(to), nullJSON(details), now)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		logs = append(logs, LogItem{ID: id, TaskID: taskID, UserID: actor, Type: typ, Text: text,
			FromStatus: from, ToStatus: to, Details: details, Attachments: []Asset{}, CreatedAt: now})
		return nil
	}

	if statusChanged {
		// Capture the reason on a block transition so it survives in the history
		// (the task's blocked_reason is cleared again once it's unblocked). The
		// reason stays in Text too, for the calendar day-report and legacy rows.
		text := ""
		var details json.RawMessage
		if toS == "blocked" {
			text = nt.BlockedReason
			details = marshalDetails(blockedDetails{Reason: nt.BlockedReason, BlockedByTaskID: nt.BlockedByTaskID})
		}
		if err := addLog("status_change", text, &fromS, &toS, details); err != nil {
			return nil, nil, err
		}
	}
	if dueChanged {
		// Record from→to structurally; the front end formats and translates it.
		details := marshalDetails(dueDateDetails{From: cur.DueDate, To: nt.DueDate})
		if err := addLog("due_date_change", "", nil, nil, details); err != nil {
			return nil, nil, err
		}
	}
	if assigneeChanged {
		// Record who it moved from/to (ids); the front end resolves names.
		details := marshalDetails(assigneeDetails{FromUser: cur.AssigneeID, ToUser: nt.AssigneeID})
		if err := addLog("assignee_change", "", nil, nil, details); err != nil {
			return nil, nil, err
		}
	}
	// Archive / unarchive is now part of the task history (it used to be silent).
	if ch.SetArchived && newArchived != cur.Archived {
		details := marshalDetails(archiveDetails{Archived: newArchived})
		if err := addLog("archive", "", nil, nil, details); err != nil {
			return nil, nil, err
		}
	}
	// Field edits each get their own entry (title/description/tags/checklist), so
	// the activity feed narrates exactly what changed instead of a lumped "edit".
	if titleChanged {
		details := marshalDetails(titleChangeDetails{From: oldTitle, To: nt.Title})
		if err := addLog("title_change", "", nil, nil, details); err != nil {
			return nil, nil, err
		}
	}
	if descChanged {
		// Descriptions are long/markdown — record the action, not a diff body.
		if err := addLog("description_change", "", nil, nil, nil); err != nil {
			return nil, nil, err
		}
	}
	if tagsChanged {
		details := marshalDetails(tagDiff{Added: tagsAdded, Removed: tagsRemoved})
		if err := addLog("tags_change", "", nil, nil, details); err != nil {
			return nil, nil, err
		}
	}
	if criteriaChanged {
		// critDiff is nil for a pure reorder; the entry still records that the
		// checklist changed, just without add/abandon/restore chips.
		if err := addLog("criteria_change", "", nil, nil, marshalDetails(critDiff)); err != nil {
			return nil, nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return &nt, logs, nil
}

// SetCriterion updates a single checklist item's done and/or abandoned flags
// (whichever are non-nil) and returns the updated task plus any log entries. Text
// is immutable, so it is never touched here. Checking/unchecking records a
// "criterion_check" entry; abandoning/restoring records a "criteria_change" entry
// (matching the edit-dialog vocabulary). Returns (nil, nil, nil) if the criterion
// doesn't belong to the task.
func (s *Store) SetCriterion(taskID, criterionID, actor int64, done, abandoned *bool) (*Task, []LogItem, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	var text string
	var curDone, curAbandoned bool
	err = tx.QueryRow("SELECT text, done, abandoned FROM task_criteria WHERE id=? AND task_id=?",
		criterionID, taskID).Scan(&text, &curDone, &curAbandoned)
	if err == sql.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}

	sets := []string{}
	args := []any{}
	if done != nil {
		sets = append(sets, "done=?")
		args = append(args, *done)
	}
	if abandoned != nil {
		sets = append(sets, "abandoned=?")
		args = append(args, *abandoned)
	}
	if len(sets) > 0 {
		args = append(args, criterionID, taskID)
		if _, err := tx.Exec(
			"UPDATE task_criteria SET "+strings.Join(sets, ", ")+" WHERE id=? AND task_id=?", args...); err != nil {
			return nil, nil, err
		}
	}

	now := nowUTC()
	var logs []LogItem
	addLog := func(typ string, details json.RawMessage) error {
		res, err := tx.Exec(
			`INSERT INTO log_items (task_id, user_id, type, text, details, created_at) VALUES (?,?,?,?,?,?)`,
			taskID, actor, typ, "", nullJSON(details), now)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		logs = append(logs, LogItem{ID: id, TaskID: taskID, UserID: actor, Type: typ,
			Details: details, Attachments: []Asset{}, CreatedAt: now})
		return nil
	}

	if done != nil && *done != curDone {
		if err := addLog("criterion_check",
			marshalDetails(criterionCheckDetails{Criterion: text, Done: *done})); err != nil {
			return nil, nil, err
		}
	}
	if abandoned != nil && *abandoned != curAbandoned {
		var diff criteriaDiff
		if *abandoned {
			diff.Abandoned = []string{text}
		} else {
			diff.Restored = []string{text}
		}
		if err := addLog("criteria_change", marshalDetails(diff)); err != nil {
			return nil, nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	t, err := s.GetTask(taskID)
	return t, logs, err
}

// ---- Logs ----

const logCols = "id, task_id, user_id, type, text, from_status, to_status, details, created_at"

func scanLog(sc scanner) (*LogItem, error) {
	var l LogItem
	var from, to, details sql.NullString
	if err := sc.Scan(&l.ID, &l.TaskID, &l.UserID, &l.Type, &l.Text, &from, &to, &details, &l.CreatedAt); err != nil {
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
	if details.Valid && details.String != "" {
		l.Details = json.RawMessage(details.String)
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
		pid, tid, lid := projectID, taskID, logID
		li.Attachments = append(li.Attachments, Asset{
			ID: aid, ProjectID: &pid, TaskID: &tid, LogID: &lid, UploadedBy: userID,
			Kind: f.Kind, Mime: f.Mime, Filename: f.Filename, Path: f.Path, Size: f.Size, CreatedAt: now,
		})
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return li, nil
}

// AddAssets records files uploaded straight to the Files page (not tied to a task
// or log entry). projectID may be nil for a project-less upload (e.g. from chat).
// source marks where a project-less upload came from ("chat", or "" for a direct
// Files-page upload) for provenance display. Returns the created rows.
func (s *Store) AddAssets(projectID *int64, userID int64, source string, files []SavedFile) ([]Asset, error) {
	now := nowUTC()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	out := []Asset{}
	for _, f := range files {
		res, err := tx.Exec(
			`INSERT INTO assets (project_id, source, uploaded_by, kind, mime, filename, path, size, created_at)
			 VALUES (?,?,?,?,?,?,?,?,?)`,
			nullInt(projectID), source, userID, f.Kind, f.Mime, f.Filename, f.Path, f.Size, now)
		if err != nil {
			return nil, err
		}
		id, _ := res.LastInsertId()
		out = append(out, Asset{
			ID: id, ProjectID: projectID, Source: source, UploadedBy: userID, Kind: f.Kind, Mime: f.Mime,
			Filename: f.Filename, Path: f.Path, Size: f.Size, CreatedAt: now,
		})
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
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

const assetCols = "id, project_id, task_id, log_id, source, uploaded_by, kind, mime, filename, path, thumb_path, size, width, height, duration, created_at, deletion_requested_at, deletion_requested_by"

func scanAsset(sc scanner) (*Asset, error) {
	var a Asset
	var projectID, taskID, logID, delBy sql.NullInt64
	var thumb, delAt sql.NullString
	var width, height sql.NullInt64
	var duration sql.NullFloat64
	if err := sc.Scan(&a.ID, &projectID, &taskID, &logID, &a.Source, &a.UploadedBy, &a.Kind, &a.Mime,
		&a.Filename, &a.Path, &thumb, &a.Size, &width, &height, &duration, &a.CreatedAt,
		&delAt, &delBy); err != nil {
		return nil, err
	}
	if projectID.Valid {
		a.ProjectID = &projectID.Int64
	}
	if taskID.Valid {
		a.TaskID = &taskID.Int64
	}
	if logID.Valid {
		a.LogID = &logID.Int64
	}
	if delAt.Valid {
		a.DeletionRequestedAt = &delAt.String
	}
	if delBy.Valid {
		a.DeletionRequestedBy = &delBy.Int64
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
const assetColsQ = "a.id, a.project_id, a.task_id, a.log_id, a.source, a.uploaded_by, a.kind, a.mime, a.filename, a.path, a.thumb_path, a.size, a.width, a.height, a.duration, a.created_at, a.deletion_requested_at, a.deletion_requested_by"

// ListAssets returns uploaded files newest-first, optionally scoped by project,
// kind, and task tag. projectID == 0 means all projects; a negative projectID
// selects only project-less files; empty kind/tag skip that filter. pending
// selects the soft-deletion queue (assets awaiting purge) instead of the live
// grid. limit/offset paginate.
func (s *Store) ListAssets(projectID int64, kind, tag string, pending bool, limit, offset int) ([]Asset, error) {
	q := "SELECT " + assetColsQ + " FROM assets a WHERE 1=1"
	args := []any{}
	if pending {
		q += " AND a.deletion_requested_at IS NOT NULL"
	} else {
		q += " AND a.deletion_requested_at IS NULL"
	}
	if projectID < 0 {
		q += " AND a.project_id IS NULL"
	} else if projectID != 0 {
		q += " AND a.project_id = ?"
		args = append(args, projectID)
	}
	if kind != "" {
		q += " AND a.kind = ?"
		args = append(args, kind)
	}
	if tag != "" {
		q += " AND EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = a.task_id AND tt.tag = ?)"
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

// GetAsset returns a single asset by id, or (nil, nil) if it doesn't exist.
func (s *Store) GetAsset(id int64) (*Asset, error) {
	a, err := scanAsset(s.db.QueryRow("SELECT "+assetCols+" FROM assets WHERE id=?", id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

// RequestAssetDeletion soft-deletes an asset: it leaves the row and bytes in
// place but stamps who asked and when, moving it out of the live grid into the
// admin purge queue. Idempotent — re-requesting just refreshes the stamp.
func (s *Store) RequestAssetDeletion(id, userID int64) error {
	_, err := s.db.Exec(
		"UPDATE assets SET deletion_requested_at=?, deletion_requested_by=? WHERE id=?",
		nowUTC(), userID, id)
	return err
}

// RestoreAsset cancels a pending deletion, returning the asset to the live grid.
func (s *Store) RestoreAsset(id int64) error {
	_, err := s.db.Exec(
		"UPDATE assets SET deletion_requested_at=NULL, deletion_requested_by=NULL WHERE id=?", id)
	return err
}

// DeleteAsset permanently removes the asset row. Callers are responsible for
// deleting the underlying file bytes.
func (s *Store) DeleteAsset(id int64) error {
	_, err := s.db.Exec("DELETE FROM assets WHERE id=?", id)
	return err
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

// ---- Channels & messages (global chat) ----

const channelCols = "id, name, description, created_by, created_at, archived_at"

func scanChannel(sc scanner) (*Channel, error) {
	var c Channel
	var archived sql.NullString
	if err := sc.Scan(&c.ID, &c.Name, &c.Description, &c.CreatedBy, &c.CreatedAt, &archived); err != nil {
		return nil, err
	}
	c.Archived = archived.Valid
	return &c, nil
}

// ListChannels returns channels with their message count and last-message time,
// most-recently-active first (channels with no messages fall back to creation
// time). Archived channels are omitted unless includeArchived is set.
func (s *Store) ListChannels(includeArchived bool) ([]Channel, error) {
	q := `
		SELECT c.id, c.name, c.description, c.created_by, c.created_at, c.archived_at,
		       (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id) AS cnt,
		       (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id) AS last_at
		FROM channels c`
	if !includeArchived {
		q += " WHERE c.archived_at IS NULL"
	}
	q += " ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id), c.created_at) DESC, c.id DESC"
	rows, err := s.db.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Channel{}
	for rows.Next() {
		var c Channel
		var archived, lastAt sql.NullString
		if err := rows.Scan(&c.ID, &c.Name, &c.Description, &c.CreatedBy, &c.CreatedAt, &archived, &c.MessageCount, &lastAt); err != nil {
			return nil, err
		}
		c.Archived = archived.Valid
		if lastAt.Valid {
			c.LastMessageAt = &lastAt.String
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetChannel(id int64) (*Channel, error) {
	c, err := scanChannel(s.db.QueryRow("SELECT "+channelCols+" FROM channels WHERE id=?", id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return c, err
}

func (s *Store) CreateChannel(name, desc string, by int64) (*Channel, error) {
	now := nowUTC()
	res, err := s.db.Exec("INSERT INTO channels (name, description, created_by, created_at) VALUES (?,?,?,?)",
		name, desc, by, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetChannel(id)
}

// SetChannelArchived archives or unarchives a channel (stamping archived_at).
func (s *Store) SetChannelArchived(id int64, archived bool) error {
	var at any
	if archived {
		at = nowUTC()
	}
	_, err := s.db.Exec("UPDATE channels SET archived_at=? WHERE id=?", at, id)
	return err
}

// CountChannels reports how many channels exist (used to seed a default one).
func (s *Store) CountChannels() (int, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM channels").Scan(&n)
	return n, err
}

func (s *Store) CreateMessage(channelID, userID int64, text string) (*Message, error) {
	now := nowUTC()
	res, err := s.db.Exec("INSERT INTO messages (channel_id, user_id, text, created_at) VALUES (?,?,?,?)",
		channelID, userID, text, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Message{ID: id, ChannelID: channelID, UserID: userID, Text: text, CreatedAt: now}, nil
}

// ListMessages returns a channel's messages oldest-first. afterID > 0 returns only
// messages newer than that id (the polling delta); afterID == 0 returns the most
// recent `limit` messages (initial load), still ordered oldest→newest for display.
func (s *Store) ListMessages(channelID, afterID int64, limit int) ([]Message, error) {
	var rows *sql.Rows
	var err error
	if afterID > 0 {
		rows, err = s.db.Query(
			"SELECT id, channel_id, user_id, text, created_at FROM messages WHERE channel_id=? AND id>? ORDER BY id ASC LIMIT ?",
			channelID, afterID, limit)
	} else {
		// Take the newest `limit` rows, then flip to chronological order below.
		rows, err = s.db.Query(
			"SELECT id, channel_id, user_id, text, created_at FROM messages WHERE channel_id=? ORDER BY id DESC LIMIT ?",
			channelID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.ChannelID, &m.UserID, &m.Text, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if afterID == 0 {
		// The initial load fetched newest-first; reverse to oldest→newest.
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
	}
	return out, nil
}

func (s *Store) ListTags() ([]string, error) {
	rows, err := s.db.Query("SELECT DISTINCT tag FROM task_tags WHERE tag <> '' ORDER BY tag")
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
