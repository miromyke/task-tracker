import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CalendarClock, CalendarDays, ChevronLeft, KanbanSquare, Loader2 } from "lucide-react";
import { api, type Project, type Task, type User } from "@/lib/api";
import { STATUS_DOT, STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { deriveMembers, deriveProgress, nextDue, upNext } from "@/lib/project";
import { formatShortDate, isPast } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ProjectOverviewPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getProject(projectId), api.listTasks(projectId), api.listUsers()])
      .then(([p, t, u]) => {
        setProject(p);
        setTasks(t);
        setUsers(u);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const progress = useMemo(() => deriveProgress(tasks), [tasks]);
  const members = useMemo(() => deriveMembers(tasks, project, usersById), [tasks, project, usersById]);
  const due = useMemo(() => nextDue(tasks), [tasks]);
  const next = useMemo(() => upNext(tasks), [tasks]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Projects
        </Link>
        <p>Project not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Projects
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
        {project.description && <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>}
      </div>

      {/* Progress */}
      <Card className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">
            {progress.done} of {progress.total} tasks done
          </span>
          <span className="text-sm font-semibold tabular-nums">{progress.percent}%</span>
        </div>
        <ProgressBar counts={progress.counts} total={progress.total} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} />
              {STATUS_LABEL[s]} {progress.counts[s]}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        {/* Up next */}
        <Card className="p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Up next</h2>
          {next.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nothing open — nice work.</p>
          ) : (
            <ul className="divide-y">
              {next.map((t) => {
                const overdue = t.dueDate && isPast(t.dueDate);
                return (
                  <li key={t.id}>
                    <Link to={`/tasks/${t.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[t.status])} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                      <StatusBadge status={t.status} className="hidden sm:inline-flex" />
                      {t.dueDate && (
                        <span className={cn("inline-flex items-center gap-1 text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
                          <CalendarClock className="h-3.5 w-3.5" />
                          {formatShortDate(t.dueDate)}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Meta rail */}
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Members</h2>
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <UserAvatar name={m.name} avatarPath={m.avatarPath} className="h-6 w-6 text-[10px]" />
                  <span className="text-sm">{m.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatShortDate(project.createdAt.slice(0, 10))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Next due</span>
              <span>{due ? formatShortDate(due) : "—"}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={() => navigate(`/projects/${projectId}/board`)}>
          <KanbanSquare className="h-4 w-4" />
          Open board
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => navigate("/calendar")}>
          <CalendarDays className="h-4 w-4" />
          Activity calendar
        </Button>
      </div>
    </div>
  );
}
