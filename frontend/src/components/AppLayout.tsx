import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarDays, FolderKanban, LogOut, Upload } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/context/auth";
import { api } from "@/lib/api";
import { activateLocale, LOCALES, type Locale } from "@/i18n";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function AccountDialog() {
  const { user, setUser, logout } = useAuth();
  const { i18n } = useLingui();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
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

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" />
          {busy ? <Trans>Uploading…</Trans> : <Trans>Change avatar</Trans>}
        </Button>
        <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => logout()}>
          <LogOut className="h-4 w-4" />
          <Trans>Log out</Trans>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const onProjects = pathname === "/" || pathname.startsWith("/projects") || pathname.startsWith("/tasks");
  const onCalendar = pathname.startsWith("/calendar");

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <img src="/logo.png" alt="" className="h-16 w-16 object-contain" />
          <span>Mirodom</span>
        </Link>
        <AccountDialog />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto p-4 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t bg-background/95 backdrop-blur">
        <Link
          to="/"
          className={cn(
            "flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
            onProjects ? "text-primary" : "text-muted-foreground"
          )}
        >
          <FolderKanban className="h-5 w-5" />
          <Trans>Projects</Trans>
        </Link>
        <Link
          to="/calendar"
          className={cn(
            "flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
            onCalendar ? "text-primary" : "text-muted-foreground"
          )}
        >
          <CalendarDays className="h-5 w-5" />
          <Trans>Calendar</Trans>
        </Link>
      </nav>
    </div>
  );
}
