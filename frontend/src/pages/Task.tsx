import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CalendarClock,
  ChevronLeft,
  ImagePlus,
  Loader2,
  Pencil,
  Send,
  X,
} from "lucide-react";
import { api, type LogItem, type Status, type Task, type User } from "@/lib/api";
import { STATUSES, STATUS_LABEL } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime, formatShortDate, isPast } from "@/lib/format";
import { cn } from "@/lib/utils";

function describe(log: LogItem): string {
  switch (log.type) {
    case "created":
      return "created this task";
    case "note":
      return log.text ? "logged a note" : "attached an image";
    case "status_change": {
      const to = log.toStatus as Status | null;
      if (to === "done") return "completed this task";
      if (to === "abandoned") return "abandoned this task";
      if (to === "in_progress") return "started working on this";
      if (to === "todo") return "moved this back to To do";
      return "changed the status";
    }
    case "due_date_change":
      return log.text || "changed the due date";
    case "edit":
      return log.text || "edited this task";
    default:
      return log.text;
  }
}

function LogEntry({ log, user }: { log: LogItem; user?: User }) {
  const name = user?.name ?? "Someone";
  return (
    <div className="flex gap-3">
      <UserAvatar name={name} avatarPath={user?.avatarPath} className="mt-0.5 h-8 w-8 text-[10px]" />
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-medium">{name}</span> <span className="text-muted-foreground">{describe(log)}</span>
          <span className="ml-2 text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</span>
        </div>
        {log.type === "note" && log.text && <p className="mt-1 whitespace-pre-wrap text-sm">{log.text}</p>}
        {log.imagePath && (
          <a href={log.imagePath} target="_blank" rel="noreferrer">
            <img
              src={log.imagePath}
              alt="attachment"
              className="mt-2 max-h-64 rounded-md border object-cover"
            />
          </a>
        )}
      </div>
    </div>
  );
}

export function TaskPage() {
  const { id } = useParams();
  const taskId = Number(id);

  const [task, setTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const [noteText, setNoteText] = useState("");
  const [noteImage, setNoteImage] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    const [detail, u, g] = await Promise.all([api.getTask(taskId), api.listUsers(), api.listTags()]);
    setTask(detail.task);
    setLogs(detail.logs);
    setUsers(u);
    setTags(g);
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function changeStatus(to: Status) {
    if (!task || task.status === to) return;
    const res = await api.updateTask(task.id, { status: to });
    setTask(res.task);
    setLogs((prev) => [...prev, ...res.newLogs]);
  }

  async function postNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim() && !noteImage) return;
    setPosting(true);
    try {
      const log = await api.addLog(taskId, noteText.trim(), noteImage);
      setLogs((prev) => [...prev, log]);
      setNoteText("");
      setNoteImage(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Back
        </Link>
        <p>Task not found.</p>
      </div>
    );
  }

  const assignee = task.assigneeId ? usersById.get(task.assigneeId) : undefined;
  const overdue = task.dueDate && isPast(task.dueDate) && task.status !== "done" && task.status !== "abandoned";

  return (
    <div className="space-y-5">
      <Link
        to={`/projects/${task.projectId}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back to board
      </Link>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold leading-tight">{task.title}</h1>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        </div>

        {task.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          <Badge className="border-transparent bg-secondary text-secondary-foreground">#{task.tag}</Badge>
          {task.dueDate && (
            <span className={cn("inline-flex items-center gap-1 text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
              <CalendarClock className="h-3.5 w-3.5" />
              Due {formatShortDate(task.dueDate)}
            </span>
          )}
          {assignee && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserAvatar name={assignee.name} avatarPath={assignee.avatarPath} className="h-5 w-5 text-[9px]" />
              {assignee.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status</span>
          <Select value={task.status} onValueChange={(v) => changeStatus(v as Status)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue>{STATUS_LABEL[task.status]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Activity log */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Activity log</h2>
        <div className="space-y-4">
          {logs.map((log) => (
            <LogEntry key={log.id} log={log} user={usersById.get(log.userId)} />
          ))}
        </div>
      </div>

      {/* Note composer */}
      <Card className="sticky bottom-20">
        <CardContent className="p-3">
          <form onSubmit={postNote} className="space-y-2">
            <Textarea
              placeholder="Log an update…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="min-h-[60px]"
            />
            {noteImage && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">{noteImage.name}</span>
                <button type="button" onClick={() => setNoteImage(null)} className="text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => setNoteImage(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                <ImagePlus className="h-4 w-4" />
                Photo
              </Button>
              <Button type="submit" size="sm" disabled={posting || (!noteText.trim() && !noteImage)}>
                {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Log
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <TaskFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={task.projectId}
        task={task}
        users={users}
        tags={tags}
        onSaved={() => reload()}
      />
    </div>
  );
}
