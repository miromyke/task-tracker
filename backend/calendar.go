package main

import (
	"net/http"
	"sort"
	"time"
)

// CalendarDay is one cell in the activity calendar.
type CalendarDay struct {
	Date  string `json:"date"`  // YYYY-MM-DD (in the configured timezone)
	Count int    `json:"count"` // number of log entries that day
	Level int    `json:"level"` // green intensity 0-4 (by log count)
	Gold  bool   `json:"gold"`  // true if any transition INTO "done" happened
}

// greenLevel buckets activity count into 4 green shades (0 = none).
func greenLevel(n int) int {
	switch {
	case n <= 0:
		return 0
	case n == 1:
		return 1
	case n <= 3:
		return 2
	case n <= 6:
		return 3
	default:
		return 4
	}
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
	ID         int64        `json:"id"`
	Type       string       `json:"type"` // note | status_change
	Text       string       `json:"text"`
	FromStatus *string      `json:"fromStatus"`
	ToStatus   *string      `json:"toStatus"`
	ImagePath  *string      `json:"imagePath"`
	CreatedAt  string       `json:"createdAt"`
	User       User         `json:"user"`
	Task       DayEventTask `json:"task"`
}

func (s *Server) handleCalendar(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to := q.Get("from"), q.Get("to")
	tag := q.Get("tag")
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

	rows, err := s.store.LogsInRange(startUTC, endUTC, tag)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	type agg struct {
		count int
		gold  bool
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
	}

	out := make([]CalendarDay, 0, len(byDay))
	for day, a := range byDay {
		out = append(out, CalendarDay{Date: day, Count: a.count, Level: greenLevel(a.count), Gold: a.gold})
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

	events, err := s.store.DayEvents(startUTC, endUTC, tag)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"date": date, "events": events})
}

// ---- store queries for the calendar ----

// LogRangeRow is a lightweight row used to build the calendar rollup.
type LogRangeRow struct {
	CreatedAt string
	Type      string
	ToStatus  *string
}

func (s *Store) LogsInRange(startUTC, endUTC, tag string) ([]LogRangeRow, error) {
	q := "SELECT li.created_at, li.type, li.to_status FROM log_items li"
	args := []any{}
	if tag != "" {
		q += " JOIN tasks t ON t.id = li.task_id"
	}
	q += " WHERE li.created_at >= ? AND li.created_at < ?"
	args = append(args, startUTC, endUTC)
	if tag != "" {
		q += " AND t.tag = ?"
		args = append(args, tag)
	}
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LogRangeRow{}
	for rows.Next() {
		var lr LogRangeRow
		var to *string
		if err := rows.Scan(&lr.CreatedAt, &lr.Type, &to); err != nil {
			return nil, err
		}
		lr.ToStatus = to
		out = append(out, lr)
	}
	return out, rows.Err()
}

// DayEvents returns notes and status changes for a day, enriched with user and
// task/project context, ordered chronologically for the carousel report.
func (s *Store) DayEvents(startUTC, endUTC, tag string) ([]DayEvent, error) {
	q := `
		SELECT li.id, li.type, li.text, li.from_status, li.to_status, li.image_path, li.created_at,
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
	q += " ORDER BY li.created_at, li.id"

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []DayEvent{}
	for rows.Next() {
		var e DayEvent
		var from, to, img, avatar *string
		if err := rows.Scan(
			&e.ID, &e.Type, &e.Text, &from, &to, &img, &e.CreatedAt,
			&e.User.ID, &e.User.Username, &e.User.Name, &avatar,
			&e.Task.ID, &e.Task.Title, &e.Task.ProjectID, &e.Task.ProjectName, &e.Task.Tag,
		); err != nil {
			return nil, err
		}
		e.FromStatus, e.ToStatus, e.ImagePath = from, to, img
		e.User.AvatarPath = avatar
		out = append(out, e)
	}
	return out, rows.Err()
}
