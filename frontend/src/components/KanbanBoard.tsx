import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock } from "lucide-react";
import type { Status, Task, User } from "@/lib/api";
import { STATUSES, STATUS_DOT, STATUS_LABEL } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { formatShortDate, isPast } from "@/lib/format";
import { cn } from "@/lib/utils";

interface BoardProps {
  tasks: Task[];
  usersById: Map<number, User>;
  onCardClick: (id: number) => void;
  onMove: (task: Task, to: Status) => void;
}

function CardBody({ task, usersById }: { task: Task; usersById: Map<number, User> }) {
  const assignee = task.assigneeId ? usersById.get(task.assigneeId) : undefined;
  const overdue = task.dueDate && isPast(task.dueDate) && task.status !== "done" && task.status !== "abandoned";
  return (
    <>
      <div className="mb-2 text-sm font-medium leading-snug">{task.title}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-secondary text-secondary-foreground">#{task.tag}</Badge>
        {task.dueDate && (
          <span className={cn("inline-flex items-center gap-1 text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
            <CalendarClock className="h-3.5 w-3.5" />
            {formatShortDate(task.dueDate)}
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
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
        <span className="text-sm font-semibold">{STATUS_LABEL[status]}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl border border-dashed p-2 transition-colors",
          isOver ? "border-primary bg-accent" : "border-border bg-muted/40"
        )}
      >
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} usersById={usersById} onClick={() => onCardClick(t.id)} />
        ))}
        {tasks.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">No tasks</p>}
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
        {STATUSES.map((s) => (
          <Column
            key={s.key}
            status={s.key}
            tasks={tasks.filter((t) => t.status === s.key)}
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
  const [active, setActive] = useState<Status>("todo");
  const colTasks = tasks.filter((t) => t.status === active);

  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {STATUSES.map((s) => {
          const count = tasks.filter((t) => t.status === s.key).length;
          const on = active === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                on ? "border-transparent bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[s.key])} />
              {s.label}
              <span className={cn("text-xs", on ? "text-primary-foreground/70" : "text-muted-foreground")}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        {colTasks.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No tasks in {STATUS_LABEL[active]}.</p>
        ) : (
          colTasks.map((t) => (
            <div key={t.id} className="rounded-lg border bg-card p-3 shadow-sm">
              <div onClick={() => onCardClick(t.id)}>
                <CardBody task={t} usersById={usersById} />
              </div>
              <div className="mt-2 flex items-center justify-end border-t pt-2">
                <Select value={t.status} onValueChange={(v) => onMove(t, v as Status)}>
                  <SelectTrigger className="h-7 w-auto gap-1 border-none px-2 text-xs text-muted-foreground shadow-none">
                    <span className="text-muted-foreground">Move:</span>
                    <SelectValue />
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
