import { useLingui } from "@lingui/react/macro";
import { Badge } from "@/components/ui/badge";
import { STATUS_DOT, STATUS_LABEL, STATUS_STYLE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/api";

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const { i18n } = useLingui();
  return (
    <Badge className={cn("gap-1.5", STATUS_STYLE[status], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {i18n._(STATUS_LABEL[status])}
    </Badge>
  );
}
