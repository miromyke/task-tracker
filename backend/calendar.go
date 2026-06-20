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
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	ProjectID   int64  `json:"projectId"`
	ProjectName string `json:"projectName"`
	Tag         string `json:"tag"`
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

	rows, err := s.store.LogsInRange(startUTC, endUTC, tag, projectID)
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
	events, err := s.store.DayEvents(startUTC, endUTC, tag, projectID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"date": date, "events": events})
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
	s.writePulse(w, id)
}

// handlePulse serves the pulse across all projects, or one via ?project=<id>.
func (s *Server) handlePulse(w http.ResponseWriter, r *http.Request) {
	projectID, _ := strconv.ParseInt(r.URL.Query().Get("project"), 10, 64) // 0 = all projects
	s.writePulse(w, projectID)
}

// writePulse builds and writes the activity pulse; projectID == 0 spans all projects.
func (s *Server) writePulse(w http.ResponseWriter, projectID int64) {
	loc := s.cfg.Location
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	const window = 180 // days returned; the frontend slices to the selected span
	start := today.AddDate(0, 0, -(window - 1))

	rows, err := s.store.ProjectLogsSince(projectID, start.UTC().Format(time.RFC3339))
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
func (s *Store) LogsInRange(startUTC, endUTC, tag string, projectID int64) ([]LogRangeRow, error) {
	q := "SELECT " + logRangeCols + " FROM log_items li"
	args := []any{}
	if tag != "" || projectID != 0 {
		q += " JOIN tasks t ON t.id = li.task_id"
	}
	q += " WHERE li.created_at >= ? AND li.created_at < ?"
	args = append(args, startUTC, endUTC)
	if tag != "" {
		q += " AND t.tag = ?"
		args = append(args, tag)
	}
	if projectID != 0 {
		q += " AND t.project_id = ?"
		args = append(args, projectID)
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
func (s *Store) ProjectLogsSince(projectID int64, startUTC string) ([]LogRangeRow, error) {
	q := "SELECT " + logRangeCols + ` FROM log_items li
		 JOIN tasks t ON t.id = li.task_id
		 WHERE li.created_at >= ?`
	args := []any{startUTC}
	if projectID != 0 {
		q += " AND t.project_id = ?"
		args = append(args, projectID)
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
func (s *Store) DayEvents(startUTC, endUTC, tag string, projectID int64) ([]DayEvent, error) {
	q := `
		SELECT li.id, li.type, li.text, li.from_status, li.to_status, li.created_at,
		       u.id, u.username, u.name, u.avatar_path,
		       t.id, t.title, t.project_id, p.name, t.tag
		FROM log_items li
		JOIN users u ON u.id = li.user_id
		JOIN tasks t ON t.id = li.task_id
		JOIN projects p ON p.id = t.project_id
		WHERE li.created_at >= ? AND li.created_at < ?
		  AND li.type IN ('note', 'status_change')`
	args := []any{startUTC, endUTC}
	if tag != "" {
		q += " AND t.tag = ?"
		args = append(args, tag)
	}
	if projectID > 0 {
		q += " AND t.project_id = ?"
		args = append(args, projectID)
	}
	q += " ORDER BY li.created_at, li.id"

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []DayEvent{}
	ids := []int64{}
	for rows.Next() {
		var e DayEvent
		var from, to, avatar *string
		if err := rows.Scan(
			&e.ID, &e.Type, &e.Text, &from, &to, &e.CreatedAt,
			&e.User.ID, &e.User.Username, &e.User.Name, &avatar,
			&e.Task.ID, &e.Task.Title, &e.Task.ProjectID, &e.Task.ProjectName, &e.Task.Tag,
		); err != nil {
			return nil, err
		}
		e.FromStatus, e.ToStatus = from, to
		e.User.AvatarPath = avatar
		e.Attachments = []Asset{}
		out = append(out, e)
		ids = append(ids, e.ID)
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
