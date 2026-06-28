package main

import (
	"database/sql"
	"net/http"
	"sort"
	"strconv"
	"time"
)

// CalendarDay is one cell in the activity calendar. Coloring mirrors the project
// Pulse: zinc (none) / lime (activity) / deeper lime (has attachment) / purple
// (a task was completed). Count and attachment totals drive the hover tooltip.
type CalendarDay struct {
	Date        string `json:"date"`        // YYYY-MM-DD (in the configured timezone)
	Count       int    `json:"count"`       // number of log entries that day
	Attachments int    `json:"attachments"` // number of log entries with an image
	Gold        bool   `json:"gold"`        // true if any transition INTO "done" happened
}

// DayEventTask is the task context embedded in a day-report event.
type DayEventTask struct {
	ID          int64    `json:"id"`
	Title       string   `json:"title"`
	ProjectID   int64    `json:"projectId"`
	ProjectName string   `json:"projectName"`
	Tags        []string `json:"tags"`
}

// DayEvent is one entry in a day's carousel report.
type DayEvent struct {
	ID          int64        `json:"id"`
	Type        string       `json:"type"` // note | status_change
	Text        string       `json:"text"`
	FromStatus  *string      `json:"fromStatus"`
	ToStatus    *string      `json:"toStatus"`
	Attachments []Asset      `json:"attachments"`
	CreatedAt   string       `json:"createdAt"`
	User        User         `json:"user"`
	Task        DayEventTask `json:"task"`
}

// reportScope resolves membership scoping for a reporting read. When projectID is
// a specific project it enforces per-project access (writing 404 and returning
// ok=false for non-members) and returns a nil scope (the project filter already
// constrains it). For the cross-project aggregate it returns the user's visible
// project scope (nil for admins). On any error it writes the response and returns
// ok=false.
func (s *Server) reportScope(w http.ResponseWriter, r *http.Request, projectID int64) (scope []int64, ok bool) {
	if projectID > 0 {
		if !s.requireProjectAccess(w, r, projectID) {
			return nil, false
		}
		return nil, true
	}
	scope, err := s.visibleProjectScope(currentUser(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return nil, false
	}
	return scope, true
}

func (s *Server) handleCalendar(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to := q.Get("from"), q.Get("to")
	tag := q.Get("tag")
	projectID, _ := strconv.ParseInt(q.Get("project"), 10, 64) // 0 = all projects
	if from == "" || to == "" {
		writeErr(w, http.StatusBadRequest, "from and to are required (YYYY-MM-DD)")
		return
	}
	loc := s.cfg.Location
	fromT, err := time.ParseInLocation("2006-01-02", from, loc)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid from date")
		return
	}
	toT, err := time.ParseInLocation("2006-01-02", to, loc)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid to date")
		return
	}
	startUTC := fromT.UTC().Format(time.RFC3339)
	endUTC := toT.AddDate(0, 0, 1).UTC().Format(time.RFC3339) // exclusive end

	scope, ok := s.reportScope(w, r, projectID)
	if !ok {
		return
	}
	includeArchived := q.Get("archived") == "1"
	rows, err := s.store.LogsInRange(startUTC, endUTC, tag, projectID, includeArchived, scope)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	type agg struct {
		count       int
		attachments int
		gold        bool
	}
	byDay := map[string]*agg{}
	for _, lr := range rows {
		t, err := time.Parse(time.RFC3339, lr.CreatedAt)
		if err != nil {
			continue
		}
		day := t.In(loc).Format("2006-01-02")
		a := byDay[day]
		if a == nil {
			a = &agg{}
			byDay[day] = a
		}
		a.count++
		if lr.Type == "status_change" && lr.ToStatus != nil && *lr.ToStatus == "done" {
			a.gold = true
		}
		if lr.Attachments > 0 {
			a.attachments++
		}
	}

	out := make([]CalendarDay, 0, len(byDay))
	for day, a := range byDay {
		out = append(out, CalendarDay{Date: day, Count: a.count, Attachments: a.attachments, Gold: a.gold})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCalendarDay(w http.ResponseWriter, r *http.Request) {
	date := r.PathValue("date")
	tag := r.URL.Query().Get("tag")
	loc := s.cfg.Location
	dayT, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid date")
		return
	}
	startUTC := dayT.UTC().Format(time.RFC3339)
	endUTC := dayT.AddDate(0, 0, 1).UTC().Format(time.RFC3339)

	projectID, _ := strconv.ParseInt(r.URL.Query().Get("project"), 10, 64) // 0 = all projects
	scope, ok := s.reportScope(w, r, projectID)
	if !ok {
		return
	}
	includeArchived := r.URL.Query().Get("archived") == "1"
	events, err := s.store.DayEvents(startUTC, endUTC, tag, projectID, includeArchived, scope)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	minor, err := s.store.DayMinorEvents(startUTC, endUTC, tag, projectID, includeArchived, scope)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"date": date, "events": events, "minor": minor})
}

// PulseDay is one bar in the project pulse chart.
type PulseDay struct {
	Date        string `json:"date"`
	Count       int    `json:"count"`
	Gold        bool   `json:"gold"`
	Attachments int    `json:"attachments"`
}

// handleProjectPulse serves the pulse for one project (path id).
func (s *Server) handleProjectPulse(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	scope, ok := s.reportScope(w, r, id)
	if !ok {
		return
	}
	s.writePulse(w, id, r.URL.Query().Get("archived") == "1", scope)
}

// handlePulse serves the pulse across all projects, or one via ?project=<id>.
func (s *Server) handlePulse(w http.ResponseWriter, r *http.Request) {
	projectID, _ := strconv.ParseInt(r.URL.Query().Get("project"), 10, 64) // 0 = all projects
	scope, ok := s.reportScope(w, r, projectID)
	if !ok {
		return
	}
	s.writePulse(w, projectID, r.URL.Query().Get("archived") == "1", scope)
}

// writePulse builds and writes the activity pulse; projectID == 0 spans all projects.
// Logs from archived tasks/projects are excluded unless includeArchived is set. A
// non-nil scope restricts the aggregate to those project ids (membership scoping).
func (s *Server) writePulse(w http.ResponseWriter, projectID int64, includeArchived bool, scope []int64) {
	loc := s.cfg.Location
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	const window = 180 // days returned; the frontend slices to the selected span
	start := today.AddDate(0, 0, -(window - 1))

	rows, err := s.store.ProjectLogsSince(projectID, start.UTC().Format(time.RFC3339), includeArchived, scope)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	type agg struct {
		count       int
		gold        bool
		attachments int
	}
	byDay := map[string]*agg{}
	for _, lr := range rows {
		t, err := time.Parse(time.RFC3339, lr.CreatedAt)
		if err != nil {
			continue
		}
		d := t.In(loc).Format("2006-01-02")
		a := byDay[d]
		if a == nil {
			a = &agg{}
			byDay[d] = a
		}
		a.count++
		if lr.Type == "status_change" && lr.ToStatus != nil && *lr.ToStatus == "done" {
			a.gold = true
		}
		if lr.Attachments > 0 {
			a.attachments++
		}
	}

	days := make([]PulseDay, 0, window)
	for i := window - 1; i >= 0; i-- {
		d := today.AddDate(0, 0, -i).Format("2006-01-02")
		pd := PulseDay{Date: d}
		if a := byDay[d]; a != nil {
			pd.Count = a.count
			pd.Gold = a.gold
			pd.Attachments = a.attachments
		}
		days = append(days, pd)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"days": days,
	})
}

// ---- store queries for the calendar ----

// LogRangeRow is a lightweight row used to build the calendar rollup.
// Attachments is the number of assets attached to the log entry.
type LogRangeRow struct {
	CreatedAt   string
	Type        string
	ToStatus    *string
	Attachments int
}

// logRangeCols selects the rollup fields plus a per-log attachment count.
const logRangeCols = "li.created_at, li.type, li.to_status, (SELECT COUNT(*) FROM assets a WHERE a.log_id = li.id)"

// reportEventTypes restricts a log query to the entries the day report (DayEvents)
// actually renders. The pulse/calendar counts share it so a day's bar height always
// matches what opening that day shows — otherwise minor entries (created, edit,
// due_date_change, criterion_check, archive…) inflate the count but render nothing,
// most visibly on archived projects whose history is dominated by them.
const reportEventTypes = "li.type IN ('note', 'status_change')"

func scanLogRange(rows *sql.Rows) (LogRangeRow, error) {
	var lr LogRangeRow
	var to *string
	if err := rows.Scan(&lr.CreatedAt, &lr.Type, &to, &lr.Attachments); err != nil {
		return lr, err
	}
	lr.ToStatus = to
	return lr, nil
}

// LogsInRange returns log rows in [startUTC, endUTC); projectID == 0 spans all projects.
// Logs from archived tasks/projects are excluded unless includeArchived is set.
func (s *Store) LogsInRange(startUTC, endUTC, tag string, projectID int64, includeArchived bool, scope []int64) ([]LogRangeRow, error) {
	q := "SELECT " + logRangeCols + " FROM log_items li"
	args := []any{}
	if projectID != 0 || !includeArchived || scope != nil {
		q += " JOIN tasks t ON t.id = li.task_id"
	}
	q += " WHERE " + reportEventTypes + " AND li.created_at >= ? AND li.created_at < ?"
	args = append(args, startUTC, endUTC)
	if !includeArchived {
		q += " AND t.archived_at IS NULL AND t.project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)"
	}
	if tag != "" {
		q += " AND EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = li.task_id AND tt.tag = ?)"
		args = append(args, tag)
	}
	if projectID != 0 {
		q += " AND t.project_id = ?"
		args = append(args, projectID)
	} else {
		q += projectScopeClause("t.project_id", scope, false, &args)
	}
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LogRangeRow{}
	for rows.Next() {
		lr, err := scanLogRange(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, lr)
	}
	return out, rows.Err()
}

// ProjectLogsSince returns log rows since startUTC; projectID == 0 spans all projects.
// Logs from archived tasks/projects are excluded unless includeArchived is set.
func (s *Store) ProjectLogsSince(projectID int64, startUTC string, includeArchived bool, scope []int64) ([]LogRangeRow, error) {
	q := "SELECT " + logRangeCols + ` FROM log_items li
		 JOIN tasks t ON t.id = li.task_id
		 WHERE ` + reportEventTypes + ` AND li.created_at >= ?`
	args := []any{startUTC}
	if !includeArchived {
		q += " AND t.archived_at IS NULL AND t.project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)"
	}
	if projectID != 0 {
		q += " AND t.project_id = ?"
		args = append(args, projectID)
	} else {
		q += projectScopeClause("t.project_id", scope, false, &args)
	}
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LogRangeRow{}
	for rows.Next() {
		lr, err := scanLogRange(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, lr)
	}
	return out, rows.Err()
}

// DayEvents returns notes and status changes for a day, enriched with user and
// task/project context, ordered chronologically for the carousel report.
func (s *Store) DayEvents(startUTC, endUTC, tag string, projectID int64, includeArchived bool, scope []int64) ([]DayEvent, error) {
	q := `
		SELECT li.id, li.type, li.text, li.from_status, li.to_status, li.created_at,
		       u.id, u.username, u.name, u.job_role, u.avatar_path,
		       t.id, t.title, t.project_id, p.name
		FROM log_items li
		JOIN users u ON u.id = li.user_id
		JOIN tasks t ON t.id = li.task_id
		JOIN projects p ON p.id = t.project_id
		WHERE li.created_at >= ? AND li.created_at < ?
		  AND ` + reportEventTypes
	args := []any{startUTC, endUTC}
	if !includeArchived {
		q += " AND t.archived_at IS NULL AND p.archived_at IS NULL"
	}
	if tag != "" {
		q += " AND EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id AND tt.tag = ?)"
		args = append(args, tag)
	}
	if projectID > 0 {
		q += " AND t.project_id = ?"
		args = append(args, projectID)
	} else {
		q += projectScopeClause("t.project_id", scope, false, &args)
	}
	q += " ORDER BY li.created_at, li.id"

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []DayEvent{}
	ids := []int64{}
	taskIDs := []int64{}
	for rows.Next() {
		var e DayEvent
		var from, to, avatar *string
		if err := rows.Scan(
			&e.ID, &e.Type, &e.Text, &from, &to, &e.CreatedAt,
			&e.User.ID, &e.User.Username, &e.User.Name, &e.User.JobRole, &avatar,
			&e.Task.ID, &e.Task.Title, &e.Task.ProjectID, &e.Task.ProjectName,
		); err != nil {
			return nil, err
		}
		e.FromStatus, e.ToStatus = from, to
		e.User.AvatarPath = avatar
		e.Attachments = []Asset{}
		e.Task.Tags = []string{}
		out = append(out, e)
		ids = append(ids, e.ID)
		taskIDs = append(taskIDs, e.Task.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	byLog, err := s.assetsByLogIDs(ids)
	if err != nil {
		return nil, err
	}
	tagsByTask, err := s.tagsByTaskIDs(taskIDs)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if a := byLog[out[i].ID]; a != nil {
			out[i].Attachments = a
		}
		if tg := tagsByTask[out[i].Task.ID]; tg != nil {
			out[i].Task.Tags = tg
		}
	}
	return out, nil
}

// MinorEvent is a lightweight log entry the day report doesn't narrate as a story
// line (edits, due-date/assignee changes, archive, checklist tweaks…). The carousel
// rolls these up into an "also today" footer and lists them in the detailed view.
type MinorEvent struct {
	Type        string `json:"type"`
	CreatedAt   string `json:"createdAt"`
	UserName    string `json:"userName"`
	TaskTitle   string `json:"taskTitle"`
	ProjectName string `json:"projectName"`
}

// DayMinorEvents returns the day's log entries that DayEvents excludes (everything
// outside reportEventTypes), with the same tag/project/archived scoping, ordered
// chronologically. The frontend aggregates them by type for the footer summary.
func (s *Store) DayMinorEvents(startUTC, endUTC, tag string, projectID int64, includeArchived bool, scope []int64) ([]MinorEvent, error) {
	q := `
		SELECT li.type, li.created_at, u.name, t.title, p.name
		FROM log_items li
		JOIN users u ON u.id = li.user_id
		JOIN tasks t ON t.id = li.task_id
		JOIN projects p ON p.id = t.project_id
		WHERE li.created_at >= ? AND li.created_at < ?
		  AND NOT (` + reportEventTypes + `)`
	args := []any{startUTC, endUTC}
	if !includeArchived {
		q += " AND t.archived_at IS NULL AND p.archived_at IS NULL"
	}
	if tag != "" {
		q += " AND EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id AND tt.tag = ?)"
		args = append(args, tag)
	}
	if projectID > 0 {
		q += " AND t.project_id = ?"
		args = append(args, projectID)
	} else {
		q += projectScopeClause("t.project_id", scope, false, &args)
	}
	q += " ORDER BY li.created_at, li.id"

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MinorEvent{}
	for rows.Next() {
		var m MinorEvent
		if err := rows.Scan(&m.Type, &m.CreatedAt, &m.UserName, &m.TaskTitle, &m.ProjectName); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
