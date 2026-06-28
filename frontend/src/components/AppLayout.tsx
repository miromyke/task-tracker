import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CalendarDays, FolderKanban, Images, ListTodo, LogOut, MessageCircle, Pencil, Upload, Users } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/context/auth";
import { api, can } from "@/lib/api";
import { activateLocale, LOCALES, type Locale } from "@/i18n";
import { getStoredTheme, setTheme, type Theme } from "@/lib/theme";
import { UserAvatar } from "@/components/UserAvatar";
import { ChangePasswordDialog } from "@/components/UserManagement";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function AccountDialog() {
  const { user, setUser, logout } = useAuth();
  const { i18n, t } = useLingui();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [editingName, setEditingName] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [surname, setSurname] = useState(user?.surname ?? "");
  if (!user) return null;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const updated = await api.uploadAvatar(file);
      setUser(updated);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveName() {
    setBusy(true);
    try {
      const updated = await api.updateProfile({ firstName: firstName.trim(), surname: surname.trim() });
      setUser(updated);
      setEditingName(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="rounded-full ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <UserAvatar name={user.name} avatarPath={user.avatarPath} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>
            <Trans>Account</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          <UserAvatar
            name={user.name}
            firstName={user.firstName}
            surname={user.surname}
            avatarPath={user.avatarPath}
            className="h-20 w-20 text-xl"
          />
          {editingName ? (
            <div className="flex w-full flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder={t`First name`}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <Input placeholder={t`Surname`} value={surname} onChange={(e) => setSurname(e.target.value)} />
              </div>
              <div className="flex justify-center gap-2">
                <Button size="sm" disabled={busy || (!firstName.trim() && !surname.trim())} onClick={saveName}>
                  <Trans>Save</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setFirstName(user.firstName);
                    setSurname(user.surname);
                    setEditingName(false);
                  }}
                >
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="inline-flex items-center gap-1 font-medium hover:text-primary"
              >
                {user.name}
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <div className="text-sm text-muted-foreground">@{user.username}</div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>
            <Trans>Language</Trans>
          </Label>
          <Select value={i18n.locale} onValueChange={(v) => activateLocale(v as Locale)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LOCALES) as Locale[]).map((l) => (
                <SelectItem key={l} value={l}>
                  {LOCALES[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>
            <Trans>Theme</Trans>
          </Label>
          <Select
            value={theme}
            onValueChange={(v) => {
              setTheme(v as Theme);
              setThemeState(v as Theme);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">
                <Trans>System</Trans>
              </SelectItem>
              <SelectItem value="light">
                <Trans>Light</Trans>
              </SelectItem>
              <SelectItem value="dark">
                <Trans>Dark</Trans>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" />
          {busy ? <Trans>Uploading…</Trans> : <Trans>Change avatar</Trans>}
        </Button>
        <ChangePasswordDialog />
        <Button variant="ghost" className="text-red-600 hover:text-red-600" onClick={() => logout()}>
          <LogOut className="h-4 w-4" />
          <Trans>Log out</Trans>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// NavLink shows an icon + text label inline, both on the mobile top bar and on
// the wide desktop rail (the rail stretches each link full-width).
function NavLink({
  to,
  label,
  active,
  children,
}: {
  to: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:w-full",
        active && "bg-muted text-foreground"
      )}
    >
      {children}
      <span>{label}</span>
    </Link>
  );
}

// SubNavLink is an indented child of a NavLink — used for the Projects views
// (Tasks / Calendar / Files) submenu on the desktop rail.
function SubNavLink({
  to,
  label,
  active,
  children,
}: {
  to: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground"
      )}
    >
      {children}
      <span>{label}</span>
    </Link>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const chatActive = pathname.startsWith("/chat");
  const usersActive = pathname.startsWith("/users");
  const projectsActive = !chatActive && !usersActive;

  // The Projects views (Tasks / Calendar / Files) are driven by `?view=` so the
  // rail submenu can switch them; each link preserves the selected project.
  const currentView = searchParams.get("view") ?? "board";
  const projectParam = searchParams.get("project");
  const canViewReporting = can(user, "viewReporting");
  function viewHref(view: "board" | "calendar" | "files") {
    const params = new URLSearchParams();
    if (projectParam) params.set("project", projectParam);
    if (view !== "board") params.set("view", view);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }
  return (
    <div className="flex h-full flex-col sm:flex-row">
      {/* Mobile: top bar. Desktop (sm+): wide left rail with labelled links. */}
      <nav className="z-30 flex h-14 w-full shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:h-full sm:w-52 sm:flex-col sm:items-stretch sm:border-b-0 sm:border-r sm:px-3 sm:py-4">
        <div className="flex items-center gap-1 sm:flex-col sm:items-stretch sm:gap-1">
          <NavLink to="/" label={t`Projects`} active={projectsActive}>
            <FolderKanban className="h-5 w-5 shrink-0" />
          </NavLink>
          {/* Projects views submenu — always expanded on the desktop rail;
              mobile/tablet use the in-page tabs. An item is only "active" when
              you're actually on the Projects route. */}
          <div className="ml-4 hidden flex-col gap-0.5 border-l pl-2 lg:flex">
            <SubNavLink to={viewHref("board")} label={t`Tasks`} active={projectsActive && currentView === "board"}>
              <ListTodo className="h-4 w-4 shrink-0" />
            </SubNavLink>
            {canViewReporting && (
              <SubNavLink to={viewHref("calendar")} label={t`Calendar`} active={projectsActive && currentView === "calendar"}>
                <CalendarDays className="h-4 w-4 shrink-0" />
              </SubNavLink>
            )}
            <SubNavLink to={viewHref("files")} label={t`Files`} active={projectsActive && currentView === "files"}>
              <Images className="h-4 w-4 shrink-0" />
            </SubNavLink>
          </div>
          <NavLink to="/chat" label={t`Chat`} active={chatActive}>
            <MessageCircle className="h-5 w-5 shrink-0" />
          </NavLink>
          {user?.role === "admin" && (
            <NavLink to="/users" label={t`Users`} active={usersActive}>
              <Users className="h-5 w-5 shrink-0" />
            </NavLink>
          )}
        </div>
        <div className="flex items-center gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <NotificationBell />
          <AccountDialog />
        </div>
      </nav>

      <main className="mx-auto h-full w-full max-w-[120rem] flex-1 overflow-y-auto p-4 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}
