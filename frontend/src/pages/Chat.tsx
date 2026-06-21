import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Hash, Loader2, Paperclip, Play, Plus, Send, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  api,
  type Asset,
  type Channel,
  type Message,
  type Task,
  type User,
} from "@/lib/api";
import { useAuth } from "@/context/auth";
import { MessageText, referencedFileIds, type RefMaps } from "@/components/MessageText";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// How often (ms) to poll the active channel for new messages.
const POLL_MS = 3000;

function CreateChannelDialog({ onCreated }: { onCreated: (c: Channel) => void }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const c = await api.createChannel(name.trim(), description.trim());
      onCreated(c);
      setName("");
      setDescription("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="rounded-full">
          <Plus className="h-4 w-4" />
          <Trans>New</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>New channel</Trans>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cname">
              <Trans>Name</Trans>
            </Label>
            <Input id="cname" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t`e.g. planning`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cdesc">
              <Trans>Description</Trans>
            </Label>
            <Input id="cdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
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

// FilePickerDialog lists recent uploads and inserts a #file<id> reference token.
function FilePickerDialog({ onPick }: { onPick: (asset: Asset) => void }) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .listAssets({})
      .then((r) => setAssets(r.assets))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="icon" variant="ghost" title="Attach a file reference">
          <Paperclip className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Reference a file</Trans>
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : assets.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            <Trans>No files uploaded yet.</Trans>
          </p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {assets.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onPick(a);
                  setOpen(false);
                }}
                className="group relative aspect-square overflow-hidden rounded-lg border bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={a.filename}
              >
                {a.kind === "image" ? (
                  <img src={a.path} alt={a.filename} className="h-full w-full object-cover" />
                ) : a.kind === "video" ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <Play className="h-6 w-6 text-muted-foreground" />
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                    <span className="line-clamp-2 text-center text-[10px] text-muted-foreground">{a.filename}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// An active @/# autocomplete state derived from the caret position.
interface Suggest {
  trigger: "@" | "#";
  query: string;
  start: number; // index of the trigger char in the textarea value
}

function detectSuggest(value: string, caret: number): Suggest | null {
  // Walk back from the caret to the trigger, allowing only token chars between.
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "@" || ch === "#") {
      const before = i === 0 ? "" : value[i - 1];
      if (before === "" || /\s/.test(before)) {
        return { trigger: ch, query: value.slice(i + 1, caret), start: i };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

function Composer({
  channelId,
  users,
  tasks,
  onSent,
}: {
  channelId: number;
  users: User[];
  tasks: Task[];
  onSent: (m: Message) => void;
}) {
  const { t } = useLingui();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const matches = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.toLowerCase();
    if (suggest.trigger === "@") {
      return users
        .filter((u) => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
        .slice(0, 6)
        .map((u) => ({ key: u.id, label: u.name, sub: `@${u.username}`, token: `@${u.username}` }));
    }
    return tasks
      .filter((tk) => tk.title.toLowerCase().includes(q) || String(tk.id) === q)
      .slice(0, 6)
      .map((tk) => ({ key: tk.id, label: `#${tk.id} ${tk.title}`, sub: "", token: `#${tk.id}` }));
  }, [suggest, users, tasks]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setText(v);
    setSuggest(detectSuggest(v, e.target.selectionStart ?? v.length));
  }

  function insert(token: string) {
    if (!suggest) return;
    const before = text.slice(0, suggest.start);
    const after = text.slice(suggest.start + 1 + suggest.query.length);
    const next = `${before}${token} ${after}`;
    setText(next);
    setSuggest(null);
    // Restore focus + caret after the inserted token.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        const pos = before.length + token.length + 1;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function insertFile(asset: Asset) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const token = `#file${asset.id}`;
    const next = `${text.slice(0, caret)}${token} ${text.slice(caret)}`;
    setText(next);
    requestAnimationFrame(() => el?.focus());
  }

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const m = await api.postMessage(channelId, body);
      onSent(m);
      setText("");
      setSuggest(null);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggest && matches.length > 0 && (e.key === "Tab" || e.key === "Enter")) {
      e.preventDefault();
      insert(matches[0].token);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="relative border-t p-3">
      {suggest && matches.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
          {matches.map((m, i) => (
            <button
              key={m.key}
              type="button"
              onClick={() => insert(m.token)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                i === 0 && "bg-muted/60"
              )}
            >
              <span className="truncate">{m.label}</span>
              {m.sub && <span className="shrink-0 text-xs text-muted-foreground">{m.sub}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <FilePickerDialog onPick={insertFile} />
        <Textarea
          ref={ref}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t`Message… use @ to mention, # to link a task`}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none"
        />
        <Button size="icon" disabled={busy || !text.trim()} onClick={send}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function MessageRow({ message, author, refs }: { message: Message; author?: User; refs: RefMaps }) {
  return (
    <div className="flex gap-2.5">
      <UserAvatar name={author?.name ?? "?"} avatarPath={author?.avatarPath} className="mt-0.5 h-8 w-8 shrink-0 text-xs" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{author?.name ?? <Trans>Unknown</Trans>}</span>
          <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</span>
        </div>
        <div className="text-sm text-foreground">
          <MessageText text={message.text} refs={refs} />
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [assetsById, setAssetsById] = useState<Record<number, Asset>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);

  const urlChannel = Number(searchParams.get("channel")) || null;
  const [selectedId, setSelectedId] = useState<number | null>(urlChannel);
  const lastIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial reference data (rarely changes during a session).
  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
    api.listAllTasks({ includeArchived: true }).then(setTasks).catch(() => {});
  }, []);

  // Channel list.
  const loadChannels = useCallback(async () => {
    const list = await api.listChannels();
    setChannels(list);
    setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    setLoadingChannels(false);
  }, []);
  useEffect(() => {
    loadChannels().catch(() => setLoadingChannels(false));
  }, [loadChannels]);

  // Keep the selected channel in the URL so it survives refresh / is shareable.
  useEffect(() => {
    if (selectedId) setSearchParams({ channel: String(selectedId) }, { replace: true });
  }, [selectedId, setSearchParams]);

  const usersByUsername = useMemo(() => {
    const m: Record<string, User> = {};
    for (const u of users) m[u.username] = u;
    return m;
  }, [users]);
  const usersById = useMemo(() => {
    const m: Record<number, User> = {};
    for (const u of users) m[u.id] = u;
    return m;
  }, [users]);
  const tasksById = useMemo(() => {
    const m: Record<number, Task> = {};
    for (const tk of tasks) m[tk.id] = tk;
    return m;
  }, [tasks]);
  const refs: RefMaps = useMemo(
    () => ({ usersByUsername, tasksById, assetsById }),
    [usersByUsername, tasksById, assetsById]
  );

  // Lazily fetch any referenced files we haven't loaded yet.
  const resolveFiles = useCallback((msgs: Message[]) => {
    setAssetsById((cur) => {
      const wanted = new Set<number>();
      for (const m of msgs) for (const id of referencedFileIds(m.text)) if (!cur[id]) wanted.add(id);
      wanted.forEach((id) => {
        api
          .getAsset(id)
          .then((a) => setAssetsById((prev) => ({ ...prev, [id]: a })))
          .catch(() => {});
      });
      return cur;
    });
  }, []);

  // Load messages + poll the active channel. Resets cleanly on channel switch.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    lastIdRef.current = 0;
    setMessages([]);

    async function initial() {
      const msgs = await api.listMessages(selectedId!, { limit: 100 });
      if (cancelled) return;
      setMessages(msgs);
      lastIdRef.current = msgs.length ? msgs[msgs.length - 1].id : 0;
      resolveFiles(msgs);
    }
    async function poll() {
      if (cancelled || document.hidden) return;
      const delta = await api.listMessages(selectedId!, { after: lastIdRef.current });
      if (cancelled || delta.length === 0) return;
      setMessages((cur) => [...cur, ...delta]);
      lastIdRef.current = delta[delta.length - 1].id;
      resolveFiles(delta);
    }

    initial().catch(() => {});
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [selectedId, resolveFiles]);

  // Autoscroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const selected = channels.find((c) => c.id === selectedId) ?? null;

  function onSent(m: Message) {
    setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
    lastIdRef.current = Math.max(lastIdRef.current, m.id);
    resolveFiles([m]);
  }

  return (
    <div className="flex h-full gap-4">
      {/* Channel sidebar */}
      <aside
        className={cn(
          "flex w-full shrink-0 flex-col gap-2 sm:w-56",
          selectedId && "hidden sm:flex"
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">
            <Trans>Channels</Trans>
          </h2>
          <CreateChannelDialog
            onCreated={(c) => {
              setChannels((cur) => [c, ...cur]);
              setSelectedId(c.id);
            }}
          />
        </div>
        {loadingChannels ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col gap-1 overflow-y-auto">
            {channels.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  c.id === selectedId ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                )}
              >
                <Hash className="h-4 w-4 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                {c.messageCount > 0 && (
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      c.id === selectedId ? "text-primary-foreground/80" : "text-muted-foreground"
                    )}
                  >
                    {c.messageCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Message pane */}
      <section className={cn("flex min-w-0 flex-1 flex-col", !selectedId && "hidden sm:flex")}>
        {selected ? (
          <div className="flex h-full flex-col rounded-xl border bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <button type="button" className="sm:hidden" onClick={() => setSelectedId(null)}>
                <X className="h-5 w-5" />
              </button>
              <Hash className="h-4 w-4 opacity-70" />
              <span className="font-semibold">{selected.name}</span>
              {selected.description && (
                <span className="truncate text-sm text-muted-foreground">— {selected.description}</span>
              )}
            </div>
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  <Trans>No messages yet. Say hello!</Trans>
                </p>
              ) : (
                messages.map((m) => (
                  <MessageRow key={m.id} message={m} author={usersById[m.userId]} refs={refs} />
                ))
              )}
            </div>
            {user && <Composer channelId={selected.id} users={users} tasks={tasks} onSent={onSent} />}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border text-sm text-muted-foreground">
            <Trans>Select a channel to start chatting.</Trans>
          </div>
        )}
      </section>
    </div>
  );
}
