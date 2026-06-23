import { Fragment } from "react";
import { Link } from "react-router-dom";
import { FileText, Hash } from "lucide-react";
import type { Asset, Task, User } from "@/lib/api";

// Resolution maps passed down from the chat page. Messages store raw tokens; we
// resolve them at render time so stored text stays language-neutral and survives
// renames / never goes stale.
export interface RefMaps {
  usersById: Record<number, User>;
  usersByUsername: Record<string, User>; // legacy @username tokens
  tasksById: Record<number, Task>;
  assetsById: Record<number, Asset>;
}

// Matches the reference tokens. Mentions are id-based (@[id], #16); the legacy
// @username form is still matched so messages stored before the switch resolve.
// #file<id> is listed before #<id> so a file token never parses as a task token.
const TOKEN_RE = /(@\[\d+\])|(@[A-Za-z0-9_.-]+)|(#file\d+)|(#\d+)/g;

function Mention({ name }: { name: string }) {
  return (
    <span className="rounded bg-primary/10 px-1 font-medium text-primary">@{name}</span>
  );
}

function TaskRef({ id, title }: { id: number; title: string }) {
  return (
    <Link
      to={`/tasks/${id}`}
      className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 font-medium text-primary hover:underline"
    >
      <Hash className="h-3 w-3 shrink-0" />
      <span className="truncate">{title}</span>
    </Link>
  );
}

function FileRef({ asset }: { asset: Asset }) {
  const isImage = asset.kind === "image";
  if (isImage) {
    return (
      <a href={asset.path} target="_blank" rel="noreferrer" className="my-1 block">
        <img
          src={asset.path}
          alt={asset.filename}
          className="max-h-48 max-w-[16rem] rounded-lg border object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={asset.path}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-primary hover:underline"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{asset.filename}</span>
    </a>
  );
}

// MessageText renders a raw message string into React nodes, turning reference
// tokens into chips/links. Unresolved references (deleted task, unknown user,
// not-yet-loaded file) fall back to plain text — rendering never throws.
export function MessageText({ text, refs }: { text: string; refs: RefMaps }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const token = m[0];
    const start = m.index ?? 0;
    if (start > last) out.push(<Fragment key={key++}>{text.slice(last, start)}</Fragment>);
    last = start + token.length;

    if (m[1]) {
      // @[id] — id-based mention
      const id = Number(token.slice(2, -1));
      const user = refs.usersById[id];
      out.push(user ? <Mention key={key++} name={user.name} /> : <Fragment key={key++}>{token}</Fragment>);
    } else if (m[2]) {
      // @username — legacy mention
      const username = token.slice(1);
      const user = refs.usersByUsername[username];
      out.push(user ? <Mention key={key++} name={user.name} /> : <Fragment key={key++}>{token}</Fragment>);
    } else if (m[3]) {
      // #file<id>
      const id = Number(token.slice(5));
      const asset = refs.assetsById[id];
      out.push(asset ? <FileRef key={key++} asset={asset} /> : <Fragment key={key++}>{token}</Fragment>);
    } else {
      // #<id>
      const id = Number(token.slice(1));
      const task = refs.tasksById[id];
      out.push(
        task ? <TaskRef key={key++} id={id} title={task.title} /> : <Fragment key={key++}>{token}</Fragment>
      );
    }
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <span className="whitespace-pre-wrap break-words">{out}</span>;
}

// referencedFileIds extracts the asset ids referenced by #file<id> tokens in a
// message, so the chat page can lazily fetch any it hasn't loaded yet.
export function referencedFileIds(text: string): number[] {
  const ids: number[] = [];
  for (const m of text.matchAll(/#file(\d+)/g)) ids.push(Number(m[1]));
  return ids;
}
