import { useEffect, useState } from "react";
import { KeyRound, Pencil, ShieldCheck, UserPlus } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, ApiError, type Capability, type Role, type User } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { UserAvatar } from "@/components/UserAvatar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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

// Fallback for a payload that predates per-user capabilities (#17) — treat every
// capability as off rather than crashing on a missing field.
const NO_CAPS = { manageProjects: false, viewReporting: false, viewHistory: false };

// CapToggle is a labelled on/off switch for one capability — the whole control
// (track + label) is the clickable target, so the text reads as interactive.
function CapToggle({
  label,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className="flex items-center gap-2 text-sm disabled:opacity-50"
    >
      <span
        className={
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
          (on ? "bg-primary" : "bg-muted-foreground/30")
        }
      >
        <span
          className={
            "inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform " +
            (on ? "translate-x-4" : "translate-x-0.5")
          }
        />
      </span>
      <span className={on ? "" : "text-muted-foreground"}>{label}</span>
    </button>
  );
}

// UserRow renders one user as a table row: identity, role, a stacked set of
// capability switches, and an Edit button that opens the per-user modal.
function UserRow({ user, onChanged }: { user: User; onChanged: () => void }) {
  const { t } = useLingui();
  const { user: me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const isSelf = me?.id === user.id;

  // Tolerate a payload without capabilities (e.g. an older API response) by
  // treating every capability as off.
  const userCaps = user.capabilities ?? NO_CAPS;

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
  const capLabels: { key: Capability; label: string }[] = [
    { key: "manageProjects", label: t`Manage projects` },
    { key: "viewReporting", label: t`View reporting` },
    { key: "viewHistory", label: t`View history` },
  ];

  return (
    <tr className="border-t">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-3">
          <UserAvatar
            name={user.name}
            firstName={user.firstName}
            surname={user.surname}
            avatarPath={user.avatarPath}
            className="h-9 w-9 shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{user.name}</span>
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
      </td>
      <td className="px-3 py-2.5">
        {user.role === "admin" ? (
          <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">
            <Trans>admin</Trans>
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">
            <Trans>member</Trans>
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {showCaps ? (
          <div className="flex flex-col gap-1.5">
            {capLabels.map(({ key, label }) => (
              <CapToggle
                key={key}
                label={label}
                on={userCaps[key]}
                disabled={busy}
                onToggle={() => toggleCapability(key)}
              />
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {!isSelf && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
            <Trans>Edit</Trans>
          </Button>
        )}
        {editing && <EditUserDialog user={user} onClose={() => setEditing(false)} onChanged={onChanged} />}
      </td>
    </tr>
  );
}

// EditUserDialog consolidates per-user editing — rename, reset password, admin
// role, enable/disable — into one modal opened from the row's Edit button. It is
// mounted only while open so it always starts from the current user values.
function EditUserDialog({
  user,
  onClose,
  onChanged,
}: {
  user: User;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  // Fall back to "" — a pre-#19 account may have no structured name, and a bare
  // undefined would crash the controlled inputs and the trim() guards below.
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [surname, setSurname] = useState(user.surname ?? "");
  const [pw, setPw] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user.role === "admin";

  async function saveName() {
    setBusy(true);
    setError(null);
    try {
      await api.updateUser(user.id, { firstName: firstName.trim(), surname: surname.trim() });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t`Could not save`);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setBusy(true);
    setError(null);
    try {
      await api.updateUser(user.id, { password: pw });
      setPw("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t`Could not save`);
    } finally {
      setBusy(false);
    }
  }

  // Promote/demote (#21). The server blocks demoting the last admin and surfaces
  // the reason, which we show inline.
  async function setRole(role: Role) {
    setBusy(true);
    setError(null);
    try {
      await api.updateUser(user.id, { role });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t`Could not change role`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled() {
    setBusy(true);
    setError(null);
    try {
      await api.updateUser(user.id, { disabled: !user.disabled });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t`Could not save`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            <Trans>Edit user</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              <Trans>Name</Trans>
            </Label>
            <div className="flex gap-2">
              <Input placeholder={t`First name`} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <Input placeholder={t`Surname`} value={surname} onChange={(e) => setSurname(e.target.value)} />
            </div>
            <Button
              size="sm"
              className="self-start"
              disabled={busy || (!firstName.trim() && !surname.trim())}
              onClick={saveName}
            >
              <Trans>Save name</Trans>
            </Button>
          </div>

          <div className="space-y-1.5 border-t pt-4">
            <Label>
              <Trans>Reset password</Trans>
            </Label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder={t`New temp password`}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
              <Button size="sm" disabled={busy || pw.length < 6} onClick={resetPassword}>
                <KeyRound className="h-4 w-4" />
                <Trans>Reset</Trans>
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => (isAdmin ? setRole("member") : setPromoting(true))}
            >
              <ShieldCheck className="h-4 w-4" />
              {isAdmin ? <Trans>Revoke admin</Trans> : <Trans>Make admin</Trans>}
            </Button>
            <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={toggleDisabled}>
              {user.disabled ? <Trans>Enable</Trans> : <Trans>Disable</Trans>}
            </Button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </DialogContent>

      <ConfirmDialog
        open={promoting}
        onOpenChange={setPromoting}
        title={<Trans>Make this user an admin?</Trans>}
        description={
          <Trans>Admins can manage all users, projects, and files, and bypass every permission. This is a powerful grant.</Trans>
        }
        confirmLabel={<Trans>Make admin</Trans>}
        onConfirm={() => setRole("admin")}
      />
    </Dialog>
  );
}

// AddMemberDialog is the modal create form: a new member with a temp password.
function AddMemberDialog({ onAdded }: { onAdded: () => void }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setUsername("");
    setFirstName("");
    setSurname("");
    setPassword("");
    setError(null);
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser({
        username: username.trim(),
        firstName: firstName.trim(),
        surname: surname.trim(),
        password,
        role: "member",
      });
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
              <Trans>Login</Trans>
            </Label>
            <Input
              autoFocus
              placeholder={t`Login`}
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              <Trans>Temp password</Trans>
            </Label>
            <Input placeholder={t`Temp password`} value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              <Trans>The member signs in with this password and can change it later in their account settings.</Trans>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>
                <Trans>First name</Trans>
              </Label>
              <Input placeholder={t`First name`} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>
                <Trans>Surname</Trans>
              </Label>
              <Input placeholder={t`Surname`} value={surname} onChange={(e) => setSurname(e.target.value)} />
            </div>
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
// add members (via a modal), toggle per-user capabilities inline, and edit a user
// (rename, reset password, role, enable/disable) via a modal. Users are laid out
// as a table; the capability checkboxes line up into scannable columns.
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

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">
                <Trans>User</Trans>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <Trans>Role</Trans>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <Trans>Permissions</Trans>
              </th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} onChanged={load} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
