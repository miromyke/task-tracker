import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, type Task } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// useBlockCandidates loads the tasks in a project that a task can be blocked by
// (every active task except itself), but only while `enabled` is true.
export function useBlockCandidates(projectId: number | undefined, currentTaskId: number | undefined, enabled: boolean) {
  const [candidates, setCandidates] = useState<Task[]>([]);
  useEffect(() => {
    if (!enabled || !projectId) {
      setCandidates([]);
      return;
    }
    let alive = true;
    api
      .listTasks(projectId)
      .then((ts) => alive && setCandidates(ts.filter((t) => t.id !== currentTaskId)))
      .catch(() => alive && setCandidates([]));
    return () => {
      alive = false;
    };
  }, [projectId, currentTaskId, enabled]);
  return candidates;
}

// BlockedBySelect is the task picker for "blocked by"; value is the task id as a
// string ("" = none).
export function BlockedBySelect({
  candidates,
  value,
  onChange,
}: {
  candidates: Task[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useLingui();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={candidates.length ? t`Select the blocking task` : t`No other tasks to block on`} />
      </SelectTrigger>
      <SelectContent>
        {candidates.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number | undefined;
  currentTaskId: number | undefined;
  initialBlockedBy?: number | null;
  initialReason?: string;
  onConfirm: (blockedByTaskId: number, reason: string) => Promise<void> | void;
}

// BlockTaskDialog collects the required blocking-task reference plus an optional
// reason when a task is moved to "Blocked" from the board or the task status menu.
export function BlockTaskDialog({
  open,
  onOpenChange,
  projectId,
  currentTaskId,
  initialBlockedBy,
  initialReason,
  onConfirm,
}: Props) {
  const { t } = useLingui();
  const candidates = useBlockCandidates(projectId, currentTaskId, open);
  const [blockedBy, setBlockedBy] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBlockedBy(initialBlockedBy ? String(initialBlockedBy) : "");
    setReason(initialReason ?? "");
    setBusy(false);
  }, [open, initialBlockedBy, initialReason]);

  async function confirm() {
    if (!blockedBy) return;
    setBusy(true);
    try {
      await onConfirm(Number(blockedBy), reason.trim());
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
            <Trans>Block this task</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>
              <Trans>Blocked by</Trans>
            </Label>
            <BlockedBySelect candidates={candidates} value={blockedBy} onChange={setBlockedBy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="block-reason">
              <Trans>Reason</Trans>{" "}
              <span className="font-normal text-muted-foreground">
                <Trans>(optional)</Trans>
              </span>
            </Label>
            <Textarea
              id="block-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t`e.g. waiting on the electrician to finish first`}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="button" onClick={confirm} disabled={busy || !blockedBy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            <Trans>Block task</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
