import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { FolderKanban, LogOut, MessageCircle, Upload } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/context/auth";
import { api } from "@/lib/api";
import { activateLocale, LOCALES, type Locale } from "@/i18n";
import { getStoredTheme, setTheme, type Theme } from "@/lib/theme";
import { UserAvatar } from "@/components/UserAvatar";
import { ChangePasswordDialog, ManageUsersDialog } from "@/components/UserManagement";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const { i18n } = useLingui();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
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
          <UserAvatar name={user.name} avatarPath={user.avatarPath} className="h-20 w-20 text-xl" />
          <div className="text-center">
            <div className="font-medium">{user.name}</div>
            <div className="text-sm text-muted-foreground">@{user.username}</div>
          </div>
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
        {user.role === "admin" && <ManageUsersDialog />}
        <Button variant="ghost" className="text-red-600 hover:text-red-600" onClick={() => logout()}>
          <LogOut className="h-4 w-4" />
          <Trans>Log out</Trans>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// NavLink is a nav link that adapts to the layout: on the desktop rail it's an
// icon-only square with a hover tooltip; on the mobile top bar it shows the label
// as inline text (tooltips don't work on touch) with no tooltip.
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={to}
          aria-label={label}
          className={cn(
            "flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:w-9 sm:justify-center sm:px-0",
            active && "bg-muted text-foreground"
          )}
        >
          {children}
          <span className="sm:hidden">{label}</span>
        </Link>
      </TooltipTrigger>
      {/* Tooltip only on the desktop rail; the mobile bar shows the label inline. */}
      <TooltipContent side="right" className="hidden sm:block">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const chatActive = pathname.startsWith("/chat");
  return (
    <div className="flex h-full flex-col sm:flex-row">
      {/* Mobile: top bar. Desktop (sm+): left rail. */}
      <nav className="z-30 flex h-14 w-full shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:h-full sm:w-16 sm:flex-col sm:border-b-0 sm:border-r sm:px-0 sm:py-4">
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-1 sm:flex-col sm:gap-2">
            <NavLink to="/" label={t`Projects`} active={!chatActive}>
              <FolderKanban className="h-5 w-5" />
            </NavLink>
            <NavLink to="/chat" label={t`Chat`} active={chatActive}>
              <MessageCircle className="h-5 w-5" />
            </NavLink>
          </div>
        </TooltipProvider>
        <AccountDialog />
      </nav>

      <main className="mx-auto h-full w-full max-w-[96rem] flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}
