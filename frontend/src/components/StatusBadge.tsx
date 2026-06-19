import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/api";

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return <Badge className={cn(STATUS_STYLE[status], className)}>{STATUS_LABEL[status]}</Badge>;
}
