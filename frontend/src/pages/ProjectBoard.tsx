import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Loader2, Plus } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import { api, type Project, type Status, type Task, type User } from "@/lib/api";
import { KanbanBoard } from "@/components/KanbanBoard";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all__";

export function ProjectBoardPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState<string>(ALL);
  const [formOpen, setFormOpen] = useState(false);

  async function reload() {
    const [p, t, u, g] = await Promise.all([
      api.getProject(projectId),
      api.listTasks(projectId),
      api.listUsers(),
      api.listTags(),
    ]);
    setProject(p);
    setTasks(t);
    setUsers(u);
    setTags(g);
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const visibleTasks = useMemo(
    () => (tagFilter === ALL ? tasks : tasks.filter((t) => t.tag === tagFilter)),
    [tasks, tagFilter]
  );

  async function onMove(task: Task, to: Status) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: to } : t)));
    try {
      await api.updateTask(task.id, { status: to });
    } catch {
      reload();
    }
  }

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
          <ChevronLeft className="h-4 w-4" /> <Trans>Projects</Trans>
        </Link>
        <p>
          <Trans>Project not found.</Trans>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        to={`/projects/${projectId}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> {project.name}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">
          <Trans>Board</Trans>
        </h1>
        <div className="flex items-center gap-2">
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                <Trans>All tags</Trans>
              </SelectItem>
              {tags.map((t) => (
                <SelectItem key={t} value={t}>
                  #{t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">
              <Trans>Add task</Trans>
            </span>
          </Button>
        </div>
      </div>

      <KanbanBoard
        tasks={visibleTasks}
        usersById={usersById}
        onCardClick={(taskId) => navigate(`/tasks/${taskId}`)}
        onMove={onMove}
      />

      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId}
        users={users}
        tags={tags}
        onSaved={() => reload()}
      />
    </div>
  );
}
