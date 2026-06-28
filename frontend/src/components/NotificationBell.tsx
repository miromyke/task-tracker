import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Loader2 } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, type Notification } from "@/lib/api";
import { displayName, formatDateTime } from "@/lib/format";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// How often (ms) to refresh the unread badge. The list itself is fetched on open.
const POLL_MS = 30000;

// notificationLine renders the human-readable summary for a notification, using the
// resolved actor name + task title / channel name the server attached to the row.
function NotificationLine({ n }: { n: Notification }) {
  const actor = n.actor ? displayName(n.actor) : "Someone";
  const task = n.taskTitle ?? "a task";
  const channel = n.channelName ?? "chat";
  if (n.type === "mention") {
    return (
      <Trans>
        <span className="font-medium">{actor}</span> mentioned you in #{channel}
      </Trans>
    );
  }
  if (n.type === "task_assigned") {
    return (
      <Trans>
        <span className="font-medium">{actor}</span> assigned you <span className="font-medium">{task}</span>
      </Trans>
    );
  }
  // task_activity — coalesced; count > 1 reads as "N updates".
  if (n.count > 1) {
    return (
      <Trans>
        <span className="font-medium">{n.count} updates</span> on <span className="font-medium">{task}</span>
      </Trans>
    );
  }
  return (
    <Trans>
      <span className="font-medium">{actor}</span> updated <span className="font-medium">{task}</span>
    </Trans>
  );
}

export function NotificationBell() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notification[] | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const { count } = await api.notificationsUnreadCount();
      setCount(count);
    } catch {
      /* transient — keep the last known count */
    }
  }, []);

  // Poll the unread count, and refresh on focus so the badge is current when the
  // user returns to the tab.
  useEffect(() => {
    void refreshCount();
    const timer = window.setInterval(() => void refreshCount(), POLL_MS);
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCount]);

  async function loadList() {
    setItems(null);
    try {
      setItems(await api.listNotifications());
    } catch {
      setItems([]);
    }
  }

  function onOpenChange(o: boolean) {
    setOpen(o);
    if (o) void loadList();
  }

  function destination(n: Notification): string | null {
    if (n.taskId) return `/tasks/${n.taskId}`;
    if (n.channelId) return `/chat?channel=${n.channelId}`;
    return null;
  }

  async function openNotification(n: Notification) {
    setOpen(false);
    if (!n.read) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? prev);
      setCount((c) => Math.max(0, c - 1));
      try {
        await api.markNotificationRead(n.id);
      } catch {
        void refreshCount();
      }
    }
    const to = destination(n);
    if (to) navigate(to);
  }

  async function markAll() {
    setItems((prev) => prev?.map((x) => ({ ...x, read: true })) ?? prev);
    setCount(0);
    try {
      await api.markAllNotificationsRead();
    } catch {
      void refreshCount();
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-label={t`Notifications`}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">
            <Trans>Notifications</Trans>
          </span>
          {count > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={markAll}>
              <Trans>Mark all read</Trans>
            </Button>
          )}
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {items === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              <Trans>You're all caught up.</Trans>
            </p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void openNotification(n)}
                className={cn(
                  "flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-muted",
                  !n.read && "bg-primary/5"
                )}
              >
                {n.actor && (
                  <UserAvatar name={n.actor.name} avatarPath={n.actor.avatarPath} className="mt-0.5 h-7 w-7 shrink-0 text-[10px]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block leading-snug">
                    <NotificationLine n={n} />
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{formatDateTime(n.updatedAt)}</span>
                </span>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
