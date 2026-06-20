import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LogOut, Upload } from "lucide-react";
import { Acorn } from "@phosphor-icons/react";
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
        <button className="rounded-full ring-offset-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400">
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
            <div className="text-sm text-zinc-500">@{user.username}</div>
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
        <Button variant="ghost" className="text-red-600 hover:text-red-600" onClick={() => logout()}>
          <LogOut className="h-4 w-4" />
          <Trans>Log out</Trans>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-white/95 px-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Acorn weight="fill" className="h-8 w-8 text-zinc-900" />
        </Link>
        <AccountDialog />
      </header>

      <main className="mx-auto w-full max-w-[96rem] flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}
