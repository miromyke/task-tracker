import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Loader2, Plus } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import { api, type Project, type Pulse, type Status, type Task, type User } from "@/lib/api";
import { PulseCard } from "@/components/PulseCard";
import { KanbanBoard } from "@/components/KanbanBoard";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { Button } from "@/components/ui/button";

export function ProjectOverviewPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  async function load() {
    const [p, t, u, pl, g] = await Promise.all([
      api.getProject(projectId),
      api.listTasks(projectId),
      api.listUsers(),
      api.getProjectPulse(projectId),
      api.listTags(),
    ]);
    setProject(p);
    setTasks(t);
    setUsers(u);
    setPulse(pl);
    setTags(g);
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function onMove(task: Task, to: Status) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: to } : t)));
    try {
      await api.updateTask(task.id, { status: to });
    } catch {
      load();
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center text-sm text-zinc-500 hover:text-zinc-900">
          <ChevronLeft className="h-4 w-4" /> <Trans>Projects</Trans>
        </Link>
        <p>
          <Trans>Project not found.</Trans>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-6">
      <Link to="/" className="inline-flex items-center text-sm text-zinc-500 hover:text-zinc-900">
        <ChevronLeft className="h-4 w-4" /> <Trans>Projects</Trans>
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          {project.description && <p className="mt-1 text-sm text-zinc-500">{project.description}</p>}
        </div>
        <Button onClick={() => setFormOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">
            <Trans>Add task</Trans>
          </span>
        </Button>
      </div>

      {/* Pulse */}
      {pulse && <PulseCard pulse={pulse} projectId={projectId} />}

      {/* Board */}
      <KanbanBoard
        tasks={tasks}
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
        onSaved={() => load()}
      />
    </div>
  );
}
