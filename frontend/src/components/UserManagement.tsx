import { useState } from "react";
import { KeyRound, UserPlus, Users } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, ApiError, type User } from "@/lib/api";
import { useAuth } from "@/context/auth";
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

  return (
    <div className="rounded-md border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
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
          </div>
          <div className="truncate text-sm text-muted-foreground">@{user.username}</div>
        </div>
        {!isSelf && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setResetting((v) => !v)}>
              <Trans>Reset</Trans>
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={toggleDisabled}>
              {user.disabled ? <Trans>Enable</Trans> : <Trans>Disable</Trans>}
            </Button>
          </div>
        )}
      </div>
      {resetting && (
        <div className="mt-2 flex gap-2">
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
    </div>
  );
}

// ManageUsersDialog is the admin-only member management surface: add members with
// a temp password, reset passwords, and enable/disable accounts.
export function ManageUsersDialog() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setUsers(await api.listUsers());
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ username: username.trim(), name: name.trim(), password, role: "member" });
      setUsername("");
      setName("");
      setPassword("");
      await load();
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
        if (o) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Users className="h-4 w-4" />
          <Trans>Manage users</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Trans>Manage users</Trans>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={addMember} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <UserPlus className="h-4 w-4" />
            <Trans>Add member</Trans>
          </div>
          <Input
            placeholder={t`Username`}
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input placeholder={t`Display name`} value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder={t`Temp password`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !username.trim() || password.length < 6}
          >
            <Trans>Add member</Trans>
          </Button>
        </form>

        <div className="space-y-2">
          {users.map((u) => (
            <UserRow key={u.id} user={u} onChanged={load} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
