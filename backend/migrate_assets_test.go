package main

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// Simulates an existing database whose assets.project_id is still NOT NULL, then
// checks that Migrate rebuilds it nullable, preserves rows, and allows a
// project-less insert afterwards.
func TestMigrateAssetsProjectNullable(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "old.db")
	dsn := "file:" + path + "?_pragma=foreign_keys(on)"

	// Hand-build the legacy schema: projects + users + a NOT NULL assets table
	// with one existing row.
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_by INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  task_id INTEGER, log_id INTEGER,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL, mime TEXT NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL,
  thumb_path TEXT, size INTEGER NOT NULL DEFAULT 0, width INTEGER, height INTEGER,
  duration REAL, created_at TEXT NOT NULL
);
INSERT INTO projects (id, name, created_at) VALUES (1, 'P', '2026-01-01T00:00:00Z');
INSERT INTO users (id, name) VALUES (1, 'U');
INSERT INTO assets (project_id, uploaded_by, kind, mime, filename, path, created_at)
  VALUES (1, 1, 'image', 'image/png', 'a.png', '/api/uploads/x', '2026-01-01T00:00:00Z');
`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Open through the real Store and migrate.
	s, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// project_id must now be nullable.
	var notnull int
	if err := s.db.QueryRow(
		`SELECT "notnull" FROM pragma_table_info('assets') WHERE name='project_id'`).Scan(&notnull); err != nil {
		t.Fatal(err)
	}
	if notnull != 0 {
		t.Fatalf("project_id still NOT NULL after migrate")
	}

	// The pre-existing row survived.
	a, err := s.GetAsset(1)
	if err != nil || a == nil {
		t.Fatalf("existing asset lost: %v", err)
	}
	if a.ProjectID == nil || *a.ProjectID != 1 {
		t.Fatalf("existing asset project_id = %v, want 1", a.ProjectID)
	}

	// A project-less insert now works and reads back as null, carrying its source.
	out, err := s.AddAssets(nil, 1, "chat", []SavedFile{{Path: "/api/uploads/y", Filename: "b.png", Mime: "image/png", Kind: "image"}})
	if err != nil {
		t.Fatalf("orphan insert: %v", err)
	}
	got, err := s.GetAsset(out[0].ID)
	if err != nil || got == nil {
		t.Fatalf("orphan asset missing: %v", err)
	}
	if got.ProjectID != nil {
		t.Fatalf("orphan project_id = %v, want nil", *got.ProjectID)
	}
	if got.Source != "chat" {
		t.Fatalf("orphan source = %q, want \"chat\"", got.Source)
	}

	// Running migrate again is a no-op (idempotent).
	if err := s.Migrate(); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
}
