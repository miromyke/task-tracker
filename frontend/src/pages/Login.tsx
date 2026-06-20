import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/context/auth";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const { t } = useLingui();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t`Could not log in`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="text-4xl">🛠️</div>
          <CardTitle className="text-xl">Reno Planner</CardTitle>
          <p className="text-sm text-muted-foreground">
            <Trans>Sign in with your username</Trans>
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">
                <Trans>Username</Trans>
              </Label>
              <Input
                id="username"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                placeholder={t`e.g. mykhailo`}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !username.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <Trans>Continue</Trans>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
