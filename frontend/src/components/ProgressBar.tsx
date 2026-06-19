import type { Status } from "@/lib/api";
import { STATUS_DOT, STATUS_ORDER } from "@/lib/constants";

export function ProgressBar({ counts, total }: { counts: Record<Status, number>; total: number }) {
  if (total === 0) return <div className="h-2 w-full rounded-full bg-muted" />;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {STATUS_ORDER.map((s) =>
        counts[s] > 0 ? (
          <div key={s} className={STATUS_DOT[s]} style={{ width: `${(counts[s] / total) * 100}%` }} />
        ) : null
      )}
    </div>
  );
}
