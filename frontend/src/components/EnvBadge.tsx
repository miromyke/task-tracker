import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// EnvBadge shows a small fixed corner label when the backend reports a non-empty
// APP_ENV (e.g. the production sandbox instance). It is self-contained: it fetches
// /api/config once and renders nothing for the unlabelled production deployment.
export function EnvBadge() {
  const [env, setEnv] = useState("");

  useEffect(() => {
    api
      .config()
      .then((c) => setEnv(c.env))
      .catch(() => {
        /* badge is best-effort; ignore failures */
      });
  }, []);

  if (!env) return null;

  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-50 rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-black shadow">
      {env}
    </div>
  );
}
