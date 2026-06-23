import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Archive, ArchiveRestore, CalendarDays, ChevronDown, FolderKanban, FolderPlus, Images, Loader2, MoreVertical, Plus, Users, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, ApiError, can, criteriaMet, type Project, type Pulse, type Status, type Task, type User } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { UserAvatar } from "@/components/UserAvatar";
import { KanbanBoard } from "@/components/KanbanBoard";
import { PulseCard } from "@/components/PulseCard";
import { BlockTaskDialog } from "@/components/BlockTaskDialog";
import { CalendarView } from "@/components/CalendarView";
import { FilesView } from "@/components/FilesView";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ALL = "__all__";

// Membership is managed by the project's author or any admin (#18).
function canManageMembers(user: User | null | undefined, project: Project): boolean {
  if (!user) return false;
  return user.role === "admin" || project.createdBy === user.id;
}

function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (p: Project) => void;
}) {
  const { t } = useLingui();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await api.createProject(name.trim(), description.trim());
      onCreated(p);
      setName("");
      setDescription("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>New project</Trans>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pname">
              <Trans>Name</Trans>
            </Label>
            <Input id="pname" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t`e.g. Kitchen Remodel`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pdesc">
              <Trans>Description</Trans>
            </Label>
            <Textarea id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ManageMembersDialog lets a project's author (or an admin) see who belongs to the
// project, add existing users, and remove members (#18). The author can't be
// removed. Removed members keep their existing task assignments but lose access.
function ManageMembersDialog({
  open,
  onOpenChange,
  project,
  allUsers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  allUsers: User[];
}) {
  const { t } = useLingui();
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addId, setAddId] = useState<string>("");

  // Load members whenever the dialog opens. Driven by `open` (not Dialog's
  // onOpenChange) because the dialog is opened programmatically from the menu,
  // which never fires onOpenChange — relying on it left the spinner stuck.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setAddId("");
    setLoading(true);
    let active = true;
    api
      .listProjectMembers(project.id)
      .then((m) => active && setMembers(m))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, project.id]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  // Only non-members (and not disabled) can be invited.
  const candidates = useMemo(
    () => allUsers.filter((u) => !u.disabled && !memberIds.has(u.id)),
    [allUsers, memberIds]
  );

  async function add() {
    if (!addId) return;
    setBusy(true);
    setError(null);
    try {
      setMembers(await api.addProjectMember(project.id, Number(addId)));
      setAddId("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t`Could not add member`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: number) {
    setBusy(true);
    setError(null);
    try {
      setMembers(await api.removeProjectMember(project.id, userId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t`Could not remove member`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Trans>Members of {project.name}</Trans>
          </DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label>
              <Trans>Add a member</Trans>
            </Label>
            <Select value={addId} onValueChange={setAddId}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={t`Choose a user`} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={busy || !addId} onClick={add}>
            <Trans>Add</Trans>
          </Button>
        </div>

        <div className="space-y-1.5">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            members.map((m) => {
              const isAuthor = m.id === project.createdBy;
              return (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <UserAvatar
                      name={m.name}
                      firstName={m.firstName}
                      surname={m.surname}
                      avatarPath={m.avatarPath}
                      className="h-7 w-7"
                    />
                    <span className="truncate text-sm">{m.name}</span>
                    {isAuthor && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        <Trans>author</Trans>
                      </span>
                    )}
                  </div>
                  {!isAuthor && (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(m.id)}>
                      <Trans>Remove</Trans>
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectTile({
  label,
  count,
  active,
  archived,
  onClick,
}: {
  label: React.ReactNode;
  count: number;
  active: boolean;
  archived?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors lg:w-full",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-border hover:bg-muted",
        archived && !active && "opacity-60"
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
        {archived && <Archive className="h-3.5 w-3.5 shrink-0 opacity-70" />}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn("text-xs tabular-nums", active ? "text-white/60" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}

// Mobile filter modal: pick the project and (when the view is tag-filtered) the
// tag from one sheet, replacing the two stacked dropdowns. Selections apply
// immediately; the footer just dismisses.
function FilterDialog({
  open,
  onOpenChange,
  projects,
  selectedId,
  allCount,
  onSelectProject,
  showTags,
  tags,
  tag,
  onSelectTag,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  selectedId: number | null;
  allCount: number;
  onSelectProject: (id: number | null) => void;
  showTags: boolean;
  tags: string[];
  tag: string;
  onSelectTag: (tag: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Trans>Filter</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              <Trans>Project</Trans>
            </h3>
            <div className="flex flex-col gap-2">
              <ProjectTile
                label={<Trans>All projects</Trans>}
                count={allCount}
                active={selectedId === null}
                onClick={() => onSelectProject(null)}
              />
              {projects.map((p) => (
                <ProjectTile
                  key={p.id}
                  label={p.name}
                  count={p.taskCount}
                  active={selectedId === p.id}
                  archived={p.archived}
                  onClick={() => onSelectProject(p.id)}
                />
              ))}
            </div>
          </div>
          {showTags && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                <Trans>Tags</Trans>
              </h3>
              <div className="flex flex-wrap gap-2">
                {[ALL, ...tags].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => onSelectTag(g)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      tag === g
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {g === ALL ? <Trans>All tags</Trans> : `#${g}`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            <Trans>Done</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { t } = useLingui();
  const { user: me } = useAuth();
  const canManageProjects = can(me, "manageProjects");
  const canViewReporting = can(me, "viewReporting");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("project") ? Number(searchParams.get("project")) : null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [tag, setTag] = useState<string>(ALL);
  const [view, setView] = useState<"board" | "calendar" | "files">("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [blockTask, setBlockTask] = useState<Task | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [noProjectsOpen, setNoProjectsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  async function loadBase() {
    const [p, t, u, g] = await Promise.all([
      api.listProjects(showArchived),
      api.listAllTasks({ includeArchived: showArchived }),
      api.listUsers(),
      api.listTags(),
    ]);
    setProjects(p);
    setTasks(t);
    setUsers(u);
    setTags(g);
  }

  // The selected project filters the board and pulse; null => all projects.
  const selectedProject = useMemo(
    () => (selectedId ? projects.find((p) => p.id === selectedId) ?? null : null),
    [projects, selectedId]
  );

  useEffect(() => {
    setLoading(true);
    loadBase().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  // Pulse is scoped server-side, so refetch whenever the selection or the
  // archived view changes. Reporting is gated by the view_reporting capability —
  // skip the fetch entirely for users without it (the endpoint would 403).
  useEffect(() => {
    if (!canViewReporting) {
      setPulse(null);
      return;
    }
    api.getPulse(selectedId ?? undefined, showArchived).then(setPulse);
  }, [selectedId, showArchived, canViewReporting]);

  // The calendar tab is reporting-gated; never leave the view stuck on it.
  useEffect(() => {
    if (view === "calendar" && !canViewReporting) setView("board");
  }, [view, canViewReporting]);

  function select(id: number | null) {
    setSearchParams(id ? { project: String(id) } : {}, { replace: true });
  }

  // Refresh the pulse after an action that changes activity — no-op without the
  // view_reporting capability (the endpoint is gated).
  function refreshPulse() {
    if (!canViewReporting) return;
    api.getPulse(selectedId ?? undefined, showArchived).then(setPulse);
  }

  // A task always needs a project, so there's nothing to add into when none exist
  // yet — alert and point the user at creating one instead of opening a dead-end form.
  function openTaskForm() {
    if (projects.length === 0) {
      setNoProjectsOpen(true);
      return;
    }
    setFormOpen(true);
  }

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  // Title lookup over all loaded tasks so blocked cards can name their blocker
  // even when the tag filter hides it from the board.
  const taskTitleById = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);
  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (t) => (!selectedId || t.projectId === selectedId) && (tag === ALL || t.tags.includes(tag))
      ),
    [tasks, selectedId, tag]
  );

  async function onMove(task: Task, to: Status) {
    if (task.status === to) return;
    // Guard the done-gate up front so the card never visibly jumps and snaps back.
    if (to === "done" && !criteriaMet(task)) {
      setMoveError(t`"${task.title}" still has unchecked success criteria — open it to finish them first.`);
      return;
    }
    // Blocking needs a required reference (and optional reason): collect it first
    // rather than moving the card optimistically.
    if (to === "blocked") {
      setMoveError(null);
      setBlockTask(task);
      return;
    }
    setMoveError(null);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: to } : t)));
    try {
      await api.updateTask(task.id, { status: to });
      refreshPulse();
    } catch {
      loadBase();
    }
  }

  // Apply a block once the dialog has gathered the blocking task + reason.
  async function applyBlock(blockedByTaskId: number, reason: string) {
    if (!blockTask) return;
    const res = await api.updateTask(blockTask.id, { status: "blocked", blockedByTaskId, blockedReason: reason });
    setTasks((prev) => prev.map((t) => (t.id === res.task.id ? res.task : t)));
    refreshPulse();
  }

  // Archive / unarchive the selected project. When archiving while archived items
  // are hidden, the project drops out of the list, so deselect it.
  async function setProjectArchived(archived: boolean) {
    if (!selectedProject) return;
    await api.setProjectArchived(selectedProject.id, archived);
    if (archived && !showArchived) select(null);
    await loadBase();
  }

  // Archiving a project hides it (and its tasks) from the default view, so guard
  // it behind a confirm dialog. Unarchiving is the safe direction and stays direct.
  function onArchiveProjectClick() {
    if (!selectedProject) return;
    if (selectedProject.archived) setProjectArchived(false);
    else setArchiveConfirmOpen(true);
  }

  // The view switch (Tasks/Calendar/Files): shown in a desktop top strip over the
  // content column, or inline in the mobile header.
  const viewTabs = (
    <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
      <TabsList>
        {(
          [
            { key: "board", icon: FolderKanban, label: <Trans>Tasks</Trans> },
            // Calendar is a reporting surface, gated by the view_reporting capability.
            ...(canViewReporting
              ? ([{ key: "calendar", icon: CalendarDays, label: <Trans>Calendar</Trans> }] as const)
              : []),
            { key: "files", icon: Images, label: <Trans>Files</Trans> },
          ] as const
        ).map(({ key, icon: Icon, label }) => (
          <TabsTrigger key={key} value={key} className="gap-1.5">
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  // Heading reflects the active tab and whether a project is selected.
  const heading = selectedProject ? (
    view === "calendar" ? (
      <Trans>Events for {selectedProject.name}</Trans>
    ) : view === "files" ? (
      <Trans>Files for {selectedProject.name}</Trans>
    ) : (
      <Trans>Tasks for {selectedProject.name}</Trans>
    )
  ) : view === "calendar" ? (
    <Trans>All events</Trans>
  ) : view === "files" ? (
    <Trans>All files</Trans>
  ) : (
    <Trans>All tasks</Trans>
  );

  // Mobile: page actions collapse into a labelled overflow menu (the desktop
  // header shows them as individual buttons instead). Each item closes the menu.
  const menuItemClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent";
  function runMenu(fn: () => void) {
    setMenuOpen(false);
    fn();
  }
  const actionMenu = (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t`Actions`}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {view === "board" && (
          <button type="button" className={menuItemClass} onClick={() => runMenu(openTaskForm)}>
            <Plus className="h-4 w-4" />
            <Trans>Add task</Trans>
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
  // The header menu now only carries "Add task" (New project and Archive live in the
  // project selector's menu), so hide it outside the board.
  const hasHeaderActions = view === "board";

  // Tag filtering only applies to the task board and the calendar.
  const usesTags = view === "board" || view === "calendar";

  return (
    <div className="flex flex-col gap-10 pt-1 lg:gap-12">
      {/* Mobile: the project selector sits above the view tabs (desktop keeps it
          in the left sidebar). The button shows the current selection as its value. */}
      <div className="lg:hidden">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-9 min-w-0 flex-1 justify-between font-normal"
            onClick={() => setFilterOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FolderKanban className="h-4 w-4 shrink-0 opacity-70" />
              <span className="truncate">
                {selectedProject ? selectedProject.name : <Trans>All projects</Trans>}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
          </Button>
          <Popover open={projMenuOpen} onOpenChange={setProjMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label={t`Project actions`}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1">
              {selectedProject && canManageProjects && (
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    setProjMenuOpen(false);
                    onArchiveProjectClick();
                  }}
                >
                  {selectedProject.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  {selectedProject.archived ? <Trans>Unarchive this project</Trans> : <Trans>Archive this project</Trans>}
                </button>
              )}
              {selectedProject && canManageMembers(me, selectedProject) && (
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    setProjMenuOpen(false);
                    setMembersOpen(true);
                  }}
                >
                  <Users className="h-4 w-4" />
                  <Trans>Manage members</Trans>
                </button>
              )}
              {canManageProjects && (
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    setProjMenuOpen(false);
                    setCreateOpen(true);
                  }}
                >
                  <FolderPlus className="h-4 w-4" />
                  <Trans>New project</Trans>
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Archive className="h-3.5 w-3.5" />
          {showArchived ? <Trans>Hide archived</Trans> : <Trans>Show archived</Trans>}
        </button>
      </div>

      {/* Tabs in a top strip; on desktop they align over the content column. */}
      <div className="flex flex-row lg:gap-16">
        <div className="hidden lg:block lg:w-64 lg:shrink-0 xl:w-72" aria-hidden />
        <div className="min-w-0 flex-1">{viewTabs}</div>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-16">
        {/* Projects stack — desktop only; mobile uses the compact selector above. */}
        <aside className="hidden lg:block lg:w-64 lg:shrink-0 xl:w-72">
        <div className="mb-5 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold tracking-tight">
            <Trans>Projects</Trans>
          </h1>
          {canManageProjects && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              <Trans>New</Trans>
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <ProjectTile
            label={<Trans>All</Trans>}
            count={tasks.length}
            active={selectedId === null}
            onClick={() => select(null)}
          />
          {projects.map((p) => (
            <ProjectTile
              key={p.id}
              label={p.name}
              count={p.taskCount}
              active={selectedId === p.id}
              archived={p.archived}
              onClick={() => select(p.id)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Archive className="h-3.5 w-3.5" />
          {showArchived ? <Trans>Hide archived</Trans> : <Trans>Show archived</Trans>}
        </button>

        {usesTags && (
          <div className="mt-4 hidden lg:mt-6 lg:block">
            <h2 className="mb-2 text-lg font-bold tracking-tight lg:mb-5">
              <Trans>Tags</Trans>
            </h2>
            <Select value={tag} onValueChange={setTag}>
              <SelectTrigger className="h-9 w-full">
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
          </div>
        )}
      </aside>

      {/* Main content: board or calendar, scoped to the selection */}
      <div className="min-w-0 flex-1 space-y-6 lg:space-y-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold tracking-tight lg:text-2xl">{heading}</h2>
            {selectedProject?.description && (
              <p className="mt-1 text-sm text-muted-foreground">{selectedProject.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Add task shows from tablet up; phones use the overflow menu below.
                Archive is desktop-only here — phone/tablet reach it from the
                project selector's menu. */}
            <div className="flex items-center gap-2">
              {selectedProject && canManageMembers(me, selectedProject) && (
                <Button variant="outline" className="hidden lg:inline-flex" onClick={() => setMembersOpen(true)}>
                  <Users className="h-4 w-4" />
                  <Trans>Members</Trans>
                </Button>
              )}
              {selectedProject && canManageProjects && (
                <Button variant="outline" className="hidden lg:inline-flex" onClick={onArchiveProjectClick}>
                  {selectedProject.archived ? (
                    <>
                      <ArchiveRestore className="h-4 w-4" />
                      <Trans>Unarchive this project</Trans>
                    </>
                  ) : (
                    <>
                      <Archive className="h-4 w-4" />
                      <Trans>Archive this project</Trans>
                    </>
                  )}
                </Button>
              )}
              {view === "board" && (
                <Button className="hidden sm:inline-flex" onClick={openTaskForm}>
                  <Plus className="h-4 w-4" />
                  <Trans>Add task</Trans>
                </Button>
              )}
            </div>
            {/* Phone: Add task collapses into a labelled overflow menu. */}
            {hasHeaderActions && <div className="sm:hidden">{actionMenu}</div>}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : view === "calendar" ? (
          <CalendarView
            projectId={selectedId ?? undefined}
            tag={tag === ALL ? undefined : tag}
            includeArchived={showArchived}
          />
        ) : view === "files" ? (
          <FilesView projectId={selectedId ?? undefined} projects={projects} usersById={usersById} />
        ) : (
          <>
            {moveError && (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                <span>{moveError}</span>
                <button
                  type="button"
                  onClick={() => setMoveError(null)}
                  className="shrink-0 text-amber-500 hover:text-amber-900 dark:hover:text-amber-200"
                  aria-label={t`Dismiss`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {pulse && (
              // Desktop-only: the mobile tasks view intentionally drops the pulse.
              <div className="hidden md:block">
                <PulseCard pulse={pulse} projectId={selectedId ?? undefined} includeArchived={showArchived} />
              </div>
            )}
            <KanbanBoard
              tasks={visibleTasks}
              usersById={usersById}
              taskTitleById={taskTitleById}
              onCardClick={(taskId) => navigate(`/tasks/${taskId}`)}
              onMove={onMove}
            />
          </>
        )}
      </div>
      </div>

      <FilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        projects={projects}
        selectedId={selectedId}
        allCount={tasks.length}
        onSelectProject={select}
        showTags={usesTags}
        tags={tags}
        tag={tag}
        onSelectTag={setTag}
      />

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(p) => {
          setProjects((prev) => [p, ...prev]);
          select(p.id);
        }}
      />

      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={selectedId ?? undefined}
        projects={projects}
        users={users}
        tags={tags}
        onSaved={() => loadBase()}
      />

      <BlockTaskDialog
        open={!!blockTask}
        onOpenChange={(o) => !o && setBlockTask(null)}
        projectId={blockTask?.projectId}
        currentTaskId={blockTask?.id}
        onConfirm={applyBlock}
      />

      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title={<Trans>Archive this project?</Trans>}
        description={
          <Trans>
            The project and its tasks will be hidden from the default view. You can unarchive it later with “Show
            archived”.
          </Trans>
        }
        confirmLabel={<Trans>Archive project</Trans>}
        onConfirm={() => setProjectArchived(true)}
      />

      <ConfirmDialog
        open={noProjectsOpen}
        onOpenChange={setNoProjectsOpen}
        title={<Trans>Create a project first</Trans>}
        description={<Trans>You need at least one project before you can add a task.</Trans>}
        confirmLabel={<Trans>New project</Trans>}
        onConfirm={() => setCreateOpen(true)}
      />

      {selectedProject && (
        <ManageMembersDialog
          open={membersOpen}
          onOpenChange={setMembersOpen}
          project={selectedProject}
          allUsers={users}
        />
      )}
    </div>
  );
}
