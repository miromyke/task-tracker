import { useEffect, useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, ApiError, type Capability, type User } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// ChangePasswordDialog lets the signed-in user replace their own password
// (notably the temp one an admin handed them).
export function ChangePasswordDialog() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setDone(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError(t`Passwords do not match`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t`Could not change password`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <KeyRound className="h-4 w-4" />
          <Trans>Change password</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>
            <Trans>Change password</Trans>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cp-current">
              <Trans>Current password</Trans>
            </Label>
            <Input
              id="cp-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-next">
              <Trans>New password</Trans>
            </Label>
            <Input id="cp-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">
              <Trans>Confirm new password</Trans>
            </Label>
            <Input
              id="cp-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {done && (
            <p className="text-sm text-green-600">
              <Trans>Password changed.</Trans>
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy || !current || !next}>
            <Trans>Update password</Trans>
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({ user, onChanged }: { user: User; onChanged: () => void }) {
  const { t } = useLingui();
  const { user: me } = useAuth();
  const [resetting, setResetting] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const isSelf = me?.id === user.id;

  async function resetPassword() {
    setBusy(true);
    try {
      await api.updateUser(user.id, { password: pw });
      setResetting(false);
      setPw("");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled() {
    setBusy(true);
    try {
      await api.updateUser(user.id, { disabled: !user.disabled });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // Tolerate a payload without capabilities (e.g. an older API response) by
  // treating every capability as off.
  const userCaps = user.capabilities ?? { manageProjects: false, viewReporting: false, viewHistory: false };

  async function toggleCapability(cap: Capability) {
    setBusy(true);
    try {
      await api.updateUser(user.id, {
        capabilities: { ...userCaps, [cap]: !userCaps[cap] },
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // Admins implicitly hold every capability, so the toggles are only meaningful
  // for members. Self is excluded alongside the other account actions.
  const showCaps = !isSelf && user.role !== "admin";
  const caps: { key: Capability; label: string }[] = [
    { key: "manageProjects", label: t`Manage projects` },
    { key: "viewReporting", label: t`View reporting` },
    { key: "viewHistory", label: t`View history` },
  ];

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <UserAvatar name={user.name} avatarPath={user.avatarPath} className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium">{user.name}</span>
            {user.role === "admin" && (
              <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">
                <Trans>admin</Trans>
              </Badge>
            )}
            {user.disabled && (
              <Badge className="border-transparent bg-muted text-muted-foreground">
                <Trans>disabled</Trans>
              </Badge>
            )}
            {isSelf && (
              <Badge className="border-transparent bg-muted text-muted-foreground">
                <Trans>you</Trans>
              </Badge>
            )}
          </div>
          <div className="truncate text-sm text-muted-foreground">@{user.username}</div>
        </div>
      </div>

      {showCaps && (
        <div className="flex flex-wrap gap-1.5">
          {caps.map(({ key, label }) => {
            const on = userCaps[key];
            return (
              <button
                key={key}
                type="button"
                disabled={busy}
                onClick={() => toggleCapability(key)}
                aria-pressed={on}
                className={
                  "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 " +
                  (on
                    ? "border-transparent bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {resetting && (
        <div className="flex gap-2">
          <Input
            type="text"
            autoFocus
            placeholder={t`New temp password`}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <Button size="sm" disabled={busy || pw.length < 6} onClick={resetPassword}>
            <Trans>Save</Trans>
          </Button>
        </div>
      )}

      {!isSelf && (
        <div className="mt-auto flex gap-1 border-t pt-3">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setResetting((v) => !v)}>
            <KeyRound className="h-4 w-4" />
            <Trans>Reset password</Trans>
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={toggleDisabled}>
            {user.disabled ? <Trans>Enable</Trans> : <Trans>Disable</Trans>}
          </Button>
        </div>
      )}
    </div>
  );
}

// AddMemberDialog is the modal create form: a new member with a temp password.
function AddMemberDialog({ onAdded }: { onAdded: () => void }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setUsername("");
    setName("");
    setPassword("");
    setError(null);
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ username: username.trim(), name: name.trim(), password, role: "member" });
      onAdded();
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t`Could not add member`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4" />
          <Trans>Add member</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            <Trans>Add member</Trans>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={addMember} className="space-y-3">
          <div className="space-y-1.5">
            <Label>
              <Trans>Username</Trans>
            </Label>
            <Input
              autoFocus
              placeholder={t`Username`}
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              <Trans>Display name</Trans>
            </Label>
            <Input placeholder={t`Display name`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>
              <Trans>Temp password</Trans>
            </Label>
            <Input placeholder={t`Temp password`} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !username.trim() || password.length < 6}>
            <Trans>Add member</Trans>
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// UserManagementPanel is the admin-only member management surface (its own page):
// add members (via a modal), reset passwords, enable/disable accounts, and toggle
// per-user capabilities. Users are laid out as a responsive card grid.
export function UserManagementPanel() {
  const [users, setUsers] = useState<User[]>([]);

  async function load() {
    setUsers(await api.listUsers());
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6 lg:space-y-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight lg:text-2xl">
          <Trans>Users</Trans>
        </h1>
        <AddMemberDialog onAdded={load} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {users.map((u) => (
          <UserRow key={u.id} user={u} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
