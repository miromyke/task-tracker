#!/usr/bin/env python3
"""Seed the local DB with backdated demo history.

The API always stamps created_at = now, so historical activity (for the Pulse
chart and the activity calendar) has to be written directly. This script
resets the three demo projects and recreates them with activity spread across
the last few weeks. It is idempotent (matches demo projects by name) and leaves
any other projects/users untouched.

Usage:  python3 seed-history.py [path/to/app.db]   (default: backend/data/app.db)
"""
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

DB = sys.argv[1] if len(sys.argv) > 1 else "backend/data/app.db"
DEMO = ["Kitchen Remodel", "Master Bath", "Living Room"]
NOW = datetime.now(timezone.utc)


def ts(days_ago, hour=12):
    d = (NOW - timedelta(days=days_ago)).replace(hour=hour, minute=0, second=0, microsecond=0)
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def day(days_ago):
    return (NOW - timedelta(days=days_ago)).strftime("%Y-%m-%d")


con = sqlite3.connect(DB)
con.execute("PRAGMA foreign_keys=off")
cur = con.cursor()

# users
users = {username: uid for username, uid in cur.execute("SELECT username, id FROM users").fetchall()}
for required in ("mykhailo", "anna", "sofia"):
    if required not in users:
        # create the user if the DB was started without it
        cur.execute("INSERT INTO users (username,name,created_at) VALUES (?,?,?)",
                    (required, required.capitalize(), ts(40)))
        users[required] = cur.lastrowid
MY, AN, SO = users["mykhailo"], users["anna"], users["sofia"]

# wipe existing demo projects (and their tasks/logs) by name
ph = ",".join("?" for _ in DEMO)
old = [r[0] for r in cur.execute(f"SELECT id FROM projects WHERE name IN ({ph})", DEMO).fetchall()]
for pid in old:
    tids = [r[0] for r in cur.execute("SELECT id FROM tasks WHERE project_id=?", (pid,)).fetchall()]
    for tid in tids:
        cur.execute("DELETE FROM log_items WHERE task_id=?", (tid,))
    cur.execute("DELETE FROM tasks WHERE project_id=?", (pid,))
cur.execute(f"DELETE FROM projects WHERE name IN ({ph})", DEMO)


def project(name, desc, created_days):
    cur.execute("INSERT INTO projects (name,description,created_by,created_at) VALUES (?,?,?,?)",
                (name, desc, MY, ts(created_days)))
    return cur.lastrowid


def task(pid, title, tag, assignee, status, created_days, due_days, events):
    """events: list of (days_ago, 'note'|'status', payload). payload=text or (from,to).
    tag may be a single string or a list of tags."""
    created_at = ts(created_days, 9)
    due = day(-due_days) if due_days is not None else None
    last = created_at
    cur.execute(
        """INSERT INTO tasks (project_id,title,description,assignee_id,due_date,status,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (pid, title, "", assignee, due, status, MY, created_at, created_at))
    tid = cur.lastrowid
    tags = [tag] if isinstance(tag, str) else tag
    for tg in tags:
        cur.execute("INSERT OR IGNORE INTO task_tags (task_id,tag) VALUES (?,?)", (tid, tg))
    cur.execute("INSERT INTO log_items (task_id,user_id,type,text,created_at) VALUES (?,?,?,?,?)",
                (tid, MY, "created", "Created task", created_at))
    for days_ago, kind, payload in events:
        when = ts(days_ago, 8 + (days_ago % 9))
        last = max(last, when)
        if kind == "note":
            text, who = payload if isinstance(payload, tuple) else (payload, assignee)
            cur.execute("INSERT INTO log_items (task_id,user_id,type,text,created_at) VALUES (?,?,?,?,?)",
                        (tid, who, "note", text, when))
        else:
            frm, to = payload
            cur.execute("INSERT INTO log_items (task_id,user_id,type,from_status,to_status,created_at) VALUES (?,?,?,?,?,?)",
                        (tid, assignee, "status_change", frm, to, when))
    cur.execute("UPDATE tasks SET updated_at=? WHERE id=?", (last, tid))


# ---- Kitchen Remodel — the busiest project, dense recent activity ----
k = project("Kitchen Remodel", "New cabinets, quartz counters & backsplash. Targeting end of July.", 26)
task(k, "Demo old cabinets", "demo", AN, "done", 24, None, [
    (23, "status", ("todo", "in_progress")),
    (23, "note", "Old cabinets out, walls patched."),
    (22, "note", ("Hauled debris to the dump.", MY)),
    (21, "status", ("in_progress", "done")),
])
task(k, "Rewire kitchen outlets", "electrical", SO, "done", 20, None, [
    (16, "status", ("todo", "in_progress")),
    (14, "note", "Ran new 20A circuit for the counter outlets."),
    (8, "note", "Inspector signed off."),
    (7, "status", ("in_progress", "done")),
])
task(k, "Install countertops", "counters", MY, "in_progress", 12, -2, [
    (5, "note", "Templated for the quartz slab."),
    (3, "status", ("todo", "in_progress")),
    (1, "note", ("Slab delivered, dry-fit looks good.", MY)),
])
task(k, "Tile backsplash", "tile", MY, "in_progress", 9, -4, [
    (4, "note", "Picked the subway tile + herringbone for behind the range."),
    (2, "status", ("todo", "in_progress")),
    (0, "note", "Started the first row this morning."),
])
task(k, "Paint walls", "paint", AN, "todo", 7, -6, [
    (2, "note", "Got samples up — leaning warm white."),
])
task(k, "Order cabinet hardware", "kitchen", AN, "abandoned", 18, None, [
    (15, "note", "Backordered 8 weeks — looking for alternatives."),
    (10, "status", ("todo", "abandoned")),
])

# ---- Master Bath ----
b = project("Master Bath", "Re-tile, new vanity, fix the plumbing.", 22)
task(b, "Fix leaky faucet", "plumbing", SO, "done", 19, None, [
    (12, "status", ("todo", "in_progress")),
    (4, "note", "Replaced the cartridge — no more drip."),
    (3, "status", ("in_progress", "done")),
])
task(b, "Re-tile shower", "tile", MY, "in_progress", 14, -8, [
    (6, "note", "Demoed the old tile, redid the waterproofing."),
    (5, "status", ("todo", "in_progress")),
    (1, "note", "Niche framed, ready to set tile."),
])
task(b, "Replace vanity", "plumbing", AN, "todo", 10, -12, [
    (6, "note", "Measured for a 48\" double vanity."),
])

# ---- Living Room ----
l = project("Living Room", "Paint, wall framing, built-in shelves.", 20)
task(l, "Paint ceiling", "paint", AN, "done", 18, None, [
    (11, "status", ("todo", "in_progress")),
    (9, "note", "Two coats done, looks crisp."),
    (9, "status", ("in_progress", "done")),
])
task(l, "Frame accent wall", "framing", MY, "in_progress", 12, -5, [
    (3, "note", "Studs up, wiring for sconces roughed in."),
    (2, "status", ("todo", "in_progress")),
])
task(l, "Build bookshelves", "carpentry", SO, "todo", 8, -14, [
    (5, "note", "Sketched the built-in layout for the alcove."),
])

con.commit()

# summary
print("Seeded demo history. Activity by day (last 30):")
for d, c in con.execute(
        "SELECT substr(created_at,1,10) d, count(*) FROM log_items GROUP BY d ORDER BY d DESC LIMIT 12").fetchall():
    print(f"  {d}: {c}")
print("totals:", con.execute("SELECT count(*) FROM log_items").fetchone()[0], "log items,",
      con.execute("SELECT count(*) FROM tasks").fetchone()[0], "tasks,",
      con.execute("SELECT count(*) FROM projects").fetchone()[0], "projects")
con.close()
