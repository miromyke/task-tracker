package main

import (
	"database/sql"
	"log"
	"net/http"
	"regexp"
	"strconv"
)

// Personalized notifications (ROADMAP #14). Per-user rows fanned out on three
// triggers: chat @-mentions, activity on tasks you created/are assigned, and being
// assigned a task. Task-activity coalesces per (recipient, task) while unread;
// mentions and assignments are discrete. The acting user is never a recipient of
// their own action.

// mentionRE matches @-mention tokens in message text. Mirrors TOKEN_RE in
// MessageText.tsx so server-side detection agrees with client-side rendering.
// Mentions are id-based (@[userID], #16) so a login is never embedded in the
// stored text; the legacy @username form is matched too for messages stored
// before the switch.
var mentionRE = regexp.MustCompile(`@\[(\d+)\]|@([A-Za-z0-9_.-]+)`)

// NotifActor is the user who caused a notification (latest actor for coalesced rows).
type NotifActor struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	AvatarPath *string `json:"avatarPath"`
}

// NotificationView is an enriched notification row for the client: refs resolved to
// titles/names so the bell can render a line without extra lookups.
type NotificationView struct {
	ID          int64       `json:"id"`
	Type        string      `json:"type"` // mention | task_assigned | task_activity
	Count       int         `json:"count"`
	Read        bool        `json:"read"`
	CreatedAt   string      `json:"createdAt"`
	UpdatedAt   string      `json:"updatedAt"`
	Actor       *NotifActor `json:"actor"`
	TaskID      *int64      `json:"taskId"`
	TaskTitle   *string     `json:"taskTitle"`
	ChannelID   *int64      `json:"channelId"`
	ChannelName *string     `json:"channelName"`
	MessageID   *int64      `json:"messageId"`
}

// ---- store methods ----

// CoalesceTaskActivity records task activity for a recipient. If an unread
// task_activity notification already exists for this (recipient, task), it bumps the
// count and refreshes actor/timestamp in place; otherwise it inserts a fresh row.
func (s *Store) CoalesceTaskActivity(recipient, taskID, actorID int64) error {
	now := nowUTC()
	res, err := s.db.Exec(
		`UPDATE notifications SET count = count + 1, actor_id = ?, updated_at = ?
		 WHERE recipient_id = ? AND type = 'task_activity' AND task_id = ? AND read_at IS NULL`,
		actorID, now, recipient, taskID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return nil
	}
	_, err = s.db.Exec(
		`INSERT INTO notifications (recipient_id, type, task_id, actor_id, count, created_at, updated_at)
		 VALUES (?, 'task_activity', ?, ?, 1, ?, ?)`,
		recipient, taskID, actorID, now, now)
	return err
}

// AddNotification inserts a discrete notification (mention or task_assigned). Unused
// ref pointers are stored NULL.
func (s *Store) AddNotification(recipient int64, typ string, taskID, channelID, messageID *int64, actorID int64) error {
	now := nowUTC()
	_, err := s.db.Exec(
		`INSERT INTO notifications (recipient_id, type, task_id, channel_id, message_id, actor_id, count, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		recipient, typ, taskID, channelID, messageID, actorID, now, now)
	return err
}

// ListNotifications returns a recipient's notifications newest-first, enriched with
// actor/task/channel context for rendering.
func (s *Store) ListNotifications(recipient int64, limit int) ([]NotificationView, error) {
	rows, err := s.db.Query(
		`SELECT n.id, n.type, n.count, n.created_at, n.updated_at, n.read_at,
		        n.task_id, t.title, n.channel_id, c.name, n.message_id,
		        n.actor_id, u.name, u.avatar_path
		 FROM notifications n
		 LEFT JOIN tasks t    ON t.id = n.task_id
		 LEFT JOIN channels c ON c.id = n.channel_id
		 LEFT JOIN users u    ON u.id = n.actor_id
		 WHERE n.recipient_id = ?
		 ORDER BY n.updated_at DESC, n.id DESC
		 LIMIT ?`, recipient, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []NotificationView{}
	for rows.Next() {
		var v NotificationView
		var readAt, taskTitle, channelName, actorName, actorAvatar sql.NullString
		var taskID, channelID, messageID, actorID sql.NullInt64
		if err := rows.Scan(&v.ID, &v.Type, &v.Count, &v.CreatedAt, &v.UpdatedAt, &readAt,
			&taskID, &taskTitle, &channelID, &channelName, &messageID,
			&actorID, &actorName, &actorAvatar); err != nil {
			return nil, err
		}
		v.Read = readAt.Valid
		if taskID.Valid {
			v.TaskID = &taskID.Int64
		}
		if taskTitle.Valid {
			v.TaskTitle = &taskTitle.String
		}
		if channelID.Valid {
			v.ChannelID = &channelID.Int64
		}
		if channelName.Valid {
			v.ChannelName = &channelName.String
		}
		if messageID.Valid {
			v.MessageID = &messageID.Int64
		}
		if actorID.Valid {
			a := &NotifActor{ID: actorID.Int64, Name: actorName.String}
			if actorAvatar.Valid {
				a.AvatarPath = &actorAvatar.String
			}
			v.Actor = a
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// UnreadNotificationCount returns how many unread notifications a recipient has.
func (s *Store) UnreadNotificationCount(recipient int64) (int, error) {
	var n int
	err := s.db.QueryRow(
		"SELECT COUNT(*) FROM notifications WHERE recipient_id = ? AND read_at IS NULL", recipient).Scan(&n)
	return n, err
}

// MarkNotificationRead marks one notification read, scoped to its recipient so a user
// can't touch another user's rows.
func (s *Store) MarkNotificationRead(id, recipient int64) error {
	_, err := s.db.Exec(
		"UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_id = ? AND read_at IS NULL",
		nowUTC(), id, recipient)
	return err
}

// MarkAllNotificationsRead marks every unread notification for a recipient read.
func (s *Store) MarkAllNotificationsRead(recipient int64) error {
	_, err := s.db.Exec(
		"UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL",
		nowUTC(), recipient)
	return err
}

// ---- server fan-out (best-effort: log on error, never fail the request) ----

// notifyTaskActivity coalesces a task-activity notification for the task's creator and
// current assignee, excluding the actor.
func (s *Server) notifyTaskActivity(t *Task, actorID int64) {
	if t == nil {
		return
	}
	recipients := map[int64]bool{}
	if t.CreatedBy != actorID {
		recipients[t.CreatedBy] = true
	}
	if t.AssigneeID != nil && *t.AssigneeID != actorID {
		recipients[*t.AssigneeID] = true
	}
	for r := range recipients {
		if err := s.store.CoalesceTaskActivity(r, t.ID, actorID); err != nil {
			log.Printf("notify task activity (task=%d recipient=%d): %v", t.ID, r, err)
		}
	}
}

// notifyAssignment records a discrete "assigned to you" notification when the assignee
// changes to someone other than the actor.
func (s *Server) notifyAssignment(newAssignee, oldAssignee *int64, taskID, actorID int64) {
	if newAssignee == nil || *newAssignee == actorID {
		return
	}
	if oldAssignee != nil && *oldAssignee == *newAssignee {
		return // unchanged
	}
	tid := taskID
	if err := s.store.AddNotification(*newAssignee, "task_assigned", &tid, nil, nil, actorID); err != nil {
		log.Printf("notify assignment (task=%d recipient=%d): %v", taskID, *newAssignee, err)
	}
}

// notifyMentions records a mention notification for each distinct @-mentioned user in a
// message, excluding the author.
func (s *Server) notifyMentions(text string, channelID, messageID, actorID int64) {
	seen := map[int64]bool{}
	for _, m := range mentionRE.FindAllStringSubmatch(text, -1) {
		var u *User
		var err error
		if m[1] != "" { // @[id]
			var id int64
			id, err = strconv.ParseInt(m[1], 10, 64)
			if err == nil {
				u, err = s.store.GetUser(id)
			}
		} else { // legacy @username
			u, err = s.store.GetUserByUsername(m[2])
		}
		if err != nil || u == nil || u.ID == actorID || seen[u.ID] {
			continue
		}
		seen[u.ID] = true
		cid, mid := channelID, messageID
		if err := s.store.AddNotification(u.ID, "mention", nil, &cid, &mid, actorID); err != nil {
			log.Printf("notify mention (msg=%d recipient=%d): %v", messageID, u.ID, err)
		}
	}
}

// ---- handlers ----

func (s *Server) handleListNotifications(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListNotifications(currentUser(r).ID, 30)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleNotificationsUnreadCount(w http.ResponseWriter, r *http.Request) {
	n, err := s.store.UnreadNotificationCount(currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": n})
}

func (s *Server) handleMarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := s.store.MarkNotificationRead(id, currentUser(r).ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleMarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	if err := s.store.MarkAllNotificationsRead(currentUser(r).ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
