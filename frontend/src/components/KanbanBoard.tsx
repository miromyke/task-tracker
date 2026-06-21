import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock, CheckCircle2, ListChecks, RotateCcw } from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Status, Task, User } from "@/lib/api";
import { STATUS_DOT, STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { daysOverdue, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface BoardProps {
  tasks: Task[];
  usersById: Map<number, User>;
  onCardClick: (id: number) => void;
  onMove: (task: Task, to: Status) => void;
}

function CardBody({ task, usersById }: { task: Task; usersById: Map<number, User> }) {
  const { t } = useLingui();
  const assignee = task.assigneeId ? usersById.get(task.assigneeId) : undefined;
  const done = task.status === "done";
  const closed = done || task.status === "abandoned";
  const overdueDays = task.dueDate ? daysOverdue(task.dueDate) : 0;
  // Open + overdue is urgent (red); closed (done/abandoned) + overdue is just
  // historical (neutral); done + met the due date is a win (green).
  const openOverdue = overdueDays > 0 && !closed;
  const closedOverdue = overdueDays > 0 && closed;
  const doneOnTime = done && !!task.dueDate && overdueDays === 0;
  const criteria = (task.criteria ?? []).filter((c) => !c.abandoned);
  const criteriaDone = criteria.filter((c) => c.done).length;
  const criteriaAllDone = criteria.length > 0 && criteriaDone === criteria.length;
  return (
    <>
      <div className="mb-2 text-sm font-medium leading-snug">{task.title}</div>
      <div className="flex flex-wrap items-center gap-2">
        {task.dueDate &&
          (openOverdue || closedOverdue ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
                closedOverdue
                  ? "bg-accent text-accent-foreground"
                  : overdueDays > 7
                    ? "bg-red-600 text-white"
                    : "bg-red-200 text-red-900"
              )}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <Plural value={overdueDays} one="Overdue by # day" other="Overdue by # days" />
            </span>
          ) : doneOnTime ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <Trans>Completed on time</Trans>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatShortDate(task.dueDate)}
            </span>
          ))}
        {criteria.length > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
              criteriaAllDone ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"
            )}
            title={t`Success criteria`}
          >
            <ListChecks className="h-3.5 w-3.5" />
            {criteriaDone}/{criteria.length}
          </span>
        )}
        {task.postponeCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
            title={t`Due date pushed back`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <Trans>Postponed</Trans>
            {task.postponeCount > 1 && <span className="font-semibold">×{task.postponeCount}</span>}
          </span>
        )}
        {assignee && (
          <div className="ml-auto">
            <UserAvatar name={assignee.name} avatarPath={assignee.avatarPath} className="h-6 w-6 text-[10px]" />
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Desktop: 4 columns, drag to move ---------- */

function DraggableCard({ task, usersById, onClick }: { task: Task; usersById: Map<number, User>; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={cn(
        "cursor-grab touch-none rounded-lg border bg-card p-3 shadow-sm active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
    >
      <CardBody task={task} usersById={usersById} />
    </div>
  );
}

function Column({
  status,
  tasks,
  usersById,
  onCardClick,
}: {
  status: Status;
  tasks: Task[];
  usersById: Map<number, User>;
  onCardClick: (id: number) => void;
}) {
  const { i18n } = useLingui();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
        <span className="text-sm font-semibold">{i18n._(STATUS_LABEL[status])}</span>
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl border border-dashed p-2 transition-colors",
          isOver ? "border-foreground bg-accent" : "border-border bg-muted/40"
        )}
      >
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} usersById={usersById} onClick={() => onCardClick(t.id)} />
        ))}
        {tasks.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            <Trans>No tasks</Trans>
          </p>
        )}
      </div>
    </div>
  );
}

function DesktopBoard({ tasks, usersById, onCardClick, onMove }: BoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragStart(e: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === e.active.id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const to = e.over?.id as Status | undefined;
    if (!to) return;
    const task = tasks.find((t) => t.id === e.active.id);
    if (task && task.status !== to) onMove(task, to);
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveTask(null)}>
      <div className="grid grid-cols-4 gap-3">
        {STATUS_ORDER.map((s) => (
          <Column
            key={s}
            status={s}
            tasks={tasks.filter((t) => t.status === s)}
            usersById={usersById}
            onCardClick={onCardClick}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="w-64 rotate-1 rounded-lg border bg-card p-3 shadow-md">
            <CardBody task={activeTask} usersById={usersById} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/* ---------- Mobile: status tabs, one column ---------- */

function MobileBoard({ tasks, usersById, onCardClick, onMove }: BoardProps) {
  const { i18n } = useLingui();
  const [active, setActive] = useState<Status>("in_progress");
  const colTasks = tasks.filter((t) => t.status === active);
  const activeLabel = i18n._(STATUS_LABEL[active]);

  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {STATUS_ORDER.map((s) => {
          const count = tasks.filter((t) => t.status === s).length;
          const on = active === s;
          return (
            <button
              key={s}
              onClick={() => setActive(s)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                on ? "border-transparent bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[s])} />
              {i18n._(STATUS_LABEL[s])}
              <span className={cn("text-xs", on ? "text-primary-foreground/70" : "text-muted-foreground")}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        {colTasks.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            <Trans>No tasks in {activeLabel}.</Trans>
          </p>
        ) : (
          colTasks.map((t) => (
            <div key={t.id} className="rounded-lg border bg-card p-3 shadow-sm">
              <div onClick={() => onCardClick(t.id)}>
                <CardBody task={t} usersById={usersById} />
              </div>
              <div className="mt-2 flex items-center justify-end border-t pt-2">
                <Select value={t.status} onValueChange={(v) => onMove(t, v as Status)}>
                  <SelectTrigger className="h-7 w-auto gap-1 border-none px-2 text-xs text-muted-foreground shadow-none">
                    <span className="text-muted-foreground">
                      <Trans>Move:</Trans>
                    </span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {i18n._(STATUS_LABEL[s])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function KanbanBoard(props: BoardProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  return isDesktop ? <DesktopBoard {...props} /> : <MobileBoard {...props} />;
}
