package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	cfg   *Config
	store *Store
}

func NewServer(cfg *Config, store *Store) *Server {
	return &Server{cfg: cfg, store: store}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("GET /api/users", s.requireAuth(s.handleListUsers))
	mux.HandleFunc("POST /api/users/avatar", s.requireAuth(s.handleAvatar))

	mux.HandleFunc("GET /api/projects", s.requireAuth(s.handleListProjects))
	mux.HandleFunc("POST /api/projects", s.requireAuth(s.handleCreateProject))
	mux.HandleFunc("GET /api/projects/{id}", s.requireAuth(s.handleGetProject))
	mux.HandleFunc("GET /api/projects/{id}/pulse", s.requireAuth(s.handleProjectPulse))
	mux.HandleFunc("GET /api/projects/{id}/tasks", s.requireAuth(s.handleListTasks))
	mux.HandleFunc("POST /api/projects/{id}/tasks", s.requireAuth(s.handleCreateTask))

	mux.HandleFunc("GET /api/tasks", s.requireAuth(s.handleListAllTasks))
	mux.HandleFunc("GET /api/tasks/{id}", s.requireAuth(s.handleGetTask))
	mux.HandleFunc("PATCH /api/tasks/{id}", s.requireAuth(s.handleUpdateTask))
	mux.HandleFunc("POST /api/tasks/{id}/log", s.requireAuth(s.handleAddLog))

	mux.HandleFunc("GET /api/assets", s.requireAuth(s.handleListAssets))
	mux.HandleFunc("POST /api/projects/{id}/assets", s.requireAuth(s.handleUploadAssets))

	mux.HandleFunc("GET /api/pulse", s.requireAuth(s.handlePulse))
	mux.HandleFunc("GET /api/tags", s.requireAuth(s.handleListTags))
	mux.HandleFunc("GET /api/calendar", s.requireAuth(s.handleCalendar))
	mux.HandleFunc("GET /api/calendar/day/{date}", s.requireAuth(s.handleCalendarDay))

	mux.HandleFunc("GET /api/uploads/{file}", s.handleUpload)

	if s.cfg.StaticDir != "" {
		mux.Handle("/", s.spaHandler())
	}

	return s.logRequests(mux)
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func pathInt(r *http.Request, key string) (int64, bool) {
	v, err := strconv.ParseInt(r.PathValue(key), 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func validStatus(s string) bool {
	switch s {
	case "todo", "in_progress", "done", "abandoned":
		return true
	}
	return false
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// maxUploadBytes caps a single multipart upload request (text + all files).
const maxUploadBytes = 200 << 20 // 200 MiB

// classifyKind buckets a MIME type for display/filtering. Any unknown type is
// accepted and bucketed as "other" — classification never rejects an upload.
func classifyKind(mimeType string) string {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	case mimeType == "application/pdf",
		mimeType == "text/csv",
		mimeType == "text/plain",
		mimeType == "application/msword",
		mimeType == "application/vnd.ms-excel",
		strings.Contains(mimeType, "spreadsheet"),
		strings.Contains(mimeType, "wordprocessing"),
		strings.Contains(mimeType, "presentation"):
		return "document"
	default:
		return "other"
	}
}

// inlineExt is the set of extensions safe to render inline in the app origin.
// Everything else is served as an attachment to avoid stored-XSS via uploads.
var inlineExt = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
	".avif": true, ".heic": true, ".heif": true,
	".mp4": true, ".mov": true, ".webm": true, ".m4v": true, ".ogv": true,
	".pdf": true,
}

func (s *Server) saveUpload(file multipart.File, header *multipart.FileHeader) (*SavedFile, error) {
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".bin"
	}
	name := strconv.FormatInt(time.Now().UnixNano(), 10) + "_" + randHex(6) + ext
	dst := filepath.Join(s.cfg.UploadsDir, name)
	out, err := os.Create(dst)
	if err != nil {
		return nil, err
	}
	defer out.Close()
	n, err := io.Copy(out, file)
	if err != nil {
		return nil, err
	}
	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = mime.TypeByExtension(ext)
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return &SavedFile{
		Path:     "/api/uploads/" + name,
		Filename: header.Filename,
		Mime:     mimeType,
		Kind:     classifyKind(mimeType),
		Size:     n,
	}, nil
}

// ---- auth handlers ----

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	username := strings.TrimSpace(req.Username)
	if _, allowed := s.cfg.AllowedUsers[username]; !allowed {
		writeErr(w, http.StatusUnauthorized, "unknown username")
		return
	}
	user, err := s.store.GetUserByUsername(username)
	if err != nil || user == nil {
		writeErr(w, http.StatusUnauthorized, "unknown username")
		return
	}
	s.setSession(w, username)
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.clearSession(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, currentUser(r))
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleAvatar(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid upload")
		return
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "image required")
		return
	}
	defer file.Close()
	sf, err := s.saveUpload(file, header)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save image")
		return
	}
	u := currentUser(r)
	if err := s.store.SetAvatar(u.ID, sf.Path); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	updated, _ := s.store.GetUser(u.ID)
	writeJSON(w, http.StatusOK, updated)
}

// ---- project handlers ----

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.ListProjects()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	p, err := s.store.CreateProject(strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	p, err := s.store.GetProject(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if p == nil {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// ---- task handlers ----

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	tasks, err := s.store.ListTasks(id, r.URL.Query().Get("status"), r.URL.Query().Get("tag"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tasks)
}

// handleListAllTasks lists tasks across every project (for the projects overview).
func (s *Server) handleListAllTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := s.store.ListTasks(0, r.URL.Query().Get("status"), r.URL.Query().Get("tag"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tasks)
}

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	projectID, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	proj, err := s.store.GetProject(projectID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if proj == nil {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	var req struct {
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
		AssigneeID  *int64   `json:"assigneeId"`
		DueDate     *string  `json:"dueDate"`
		Status      string   `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	tags := normalizeTags(req.Tags)
	if req.Title == "" {
		writeErr(w, http.StatusBadRequest, "title is required")
		return
	}
	if len(tags) == 0 {
		writeErr(w, http.StatusBadRequest, "at least one tag is required")
		return
	}
	if req.Status == "" {
		req.Status = "todo"
	}
	if !validStatus(req.Status) {
		writeErr(w, http.StatusBadRequest, "invalid status")
		return
	}
	t, err := s.store.CreateTask(projectID, req.Title, strings.TrimSpace(req.Description), tags,
		req.AssigneeID, req.DueDate, req.Status, currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	t, err := s.store.GetTask(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		writeErr(w, http.StatusNotFound, "task not found")
		return
	}
	logs, err := s.store.ListLogs(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t, "logs": logs})
}

func (s *Server) handleUpdateTask(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	var ch TaskChanges
	if v, ok := raw["title"]; ok {
		var str string
		if json.Unmarshal(v, &str) == nil {
			str = strings.TrimSpace(str)
			if str == "" {
				writeErr(w, http.StatusBadRequest, "title cannot be empty")
				return
			}
			ch.Title = &str
		}
	}
	if v, ok := raw["description"]; ok {
		var str string
		if json.Unmarshal(v, &str) == nil {
			ch.Description = &str
		}
	}
	if v, ok := raw["tags"]; ok {
		var list []string
		if json.Unmarshal(v, &list) == nil {
			tags := normalizeTags(list)
			if len(tags) == 0 {
				writeErr(w, http.StatusBadRequest, "at least one tag is required")
				return
			}
			ch.Tags = &tags
		}
	}
	if v, ok := raw["assigneeId"]; ok {
		ch.SetAssignee = true
		if string(v) != "null" {
			var n int64
			if json.Unmarshal(v, &n) == nil {
				ch.AssigneeID = &n
			}
		}
	}
	if v, ok := raw["dueDate"]; ok {
		ch.SetDueDate = true
		if string(v) != "null" {
			var str string
			if json.Unmarshal(v, &str) == nil && strings.TrimSpace(str) != "" {
				ch.DueDate = &str
			}
		}
	}
	if v, ok := raw["status"]; ok {
		var str string
		if json.Unmarshal(v, &str) == nil {
			if !validStatus(str) {
				writeErr(w, http.StatusBadRequest, "invalid status")
				return
			}
			ch.Status = &str
		}
	}

	t, logs, err := s.store.UpdateTask(id, currentUser(r).ID, ch)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		writeErr(w, http.StatusNotFound, "task not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t, "newLogs": logs})
}

func (s *Server) handleAddLog(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	t, err := s.store.GetTask(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		writeErr(w, http.StatusNotFound, "task not found")
		return
	}

	// Cap the total upload so a huge video can't exhaust disk/memory.
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "upload too large or invalid form")
		return
	}
	text := strings.TrimSpace(r.FormValue("text"))

	var saved []SavedFile
	if r.MultipartForm != nil {
		for _, header := range r.MultipartForm.File["files"] {
			file, err := header.Open()
			if err != nil {
				writeErr(w, http.StatusBadRequest, "could not read upload")
				return
			}
			sf, err := s.saveUpload(file, header)
			file.Close()
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "could not save file")
				return
			}
			saved = append(saved, *sf)
		}
	}

	if text == "" && len(saved) == 0 {
		writeErr(w, http.StatusBadRequest, "text or a file is required")
		return
	}

	logItem, err := s.store.AddNote(id, currentUser(r).ID, t.ProjectID, text, saved)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, logItem)
}

// handleListAssets powers the Files page: a paginated, newest-first list of
// uploads, optionally scoped by project, kind, and tag.
func (s *Server) handleListAssets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	projectID, _ := strconv.ParseInt(q.Get("project"), 10, 64) // 0 = all projects
	kind := q.Get("kind")                                      // image|video|document|other or ""
	tag := q.Get("tag")
	page, _ := strconv.Atoi(q.Get("page")) // 0-based
	if page < 0 {
		page = 0
	}
	const pageSize = 60
	// Fetch one extra row to detect whether another page exists.
	assets, err := s.store.ListAssets(projectID, kind, tag, pageSize+1, page*pageSize)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	hasMore := len(assets) > pageSize
	if hasMore {
		assets = assets[:pageSize]
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": assets, "hasMore": hasMore})
}

// handleUploadAssets stores one or more files directly on a project (no task or
// log), powering the "Add files" action on the Files page.
func (s *Server) handleUploadAssets(w http.ResponseWriter, r *http.Request) {
	projectID, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	proj, err := s.store.GetProject(projectID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if proj == nil {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "upload too large or invalid form")
		return
	}

	var saved []SavedFile
	if r.MultipartForm != nil {
		for _, header := range r.MultipartForm.File["files"] {
			file, err := header.Open()
			if err != nil {
				writeErr(w, http.StatusBadRequest, "could not read upload")
				return
			}
			sf, err := s.saveUpload(file, header)
			file.Close()
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "could not save file")
				return
			}
			saved = append(saved, *sf)
		}
	}
	if len(saved) == 0 {
		writeErr(w, http.StatusBadRequest, "at least one file is required")
		return
	}

	assets, err := s.store.AddProjectAssets(projectID, currentUser(r).ID, saved)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, assets)
}

func (s *Server) handleListTags(w http.ResponseWriter, r *http.Request) {
	tags, err := s.store.ListTags()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

// ---- uploads & static ----

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.PathValue("file")) // strip any path components
	if name == "." || name == "/" || name == "" {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	// Never let the browser sniff a different type than the extension implies,
	// and force a download for anything not on the safe inline-render list.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	ext := strings.ToLower(filepath.Ext(name))
	if !inlineExt[ext] || r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", "attachment")
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.UploadsDir, name))
}

func (s *Server) spaHandler() http.Handler {
	fs := http.FileServer(http.Dir(s.cfg.StaticDir))
	index := filepath.Join(s.cfg.StaticDir, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(s.cfg.StaticDir, filepath.Clean(r.URL.Path))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, index)
	})
}
