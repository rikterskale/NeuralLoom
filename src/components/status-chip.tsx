import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/lib/harness/labels";
import type { DataLane, RunStatus } from "@/lib/harness/types";

export function RunStatusChip({ status }: { status: RunStatus }) {
  const variant =
    status === "accepted" || status === "running"
      ? "ok"
      : status === "blocked" || status === "failed" || status === "rejected"
        ? "deny"
        : status === "pending_approval" ||
            status === "pending_authorization" ||
            status === "needs_acceptance"
          ? "warn"
          : "muted";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

export function LaneChip({ lane }: { lane: DataLane }) {
  const variant =
    lane === "cloud_permitted"
      ? "ok"
      : lane === "local_only" || lane === "unknown"
        ? "deny"
        : "warn";
  const label =
    lane === "cloud_permitted"
      ? "Cloud permitted"
      : lane === "explicit_authorization"
        ? "Authorization required"
        : lane === "local_only"
          ? "Local only"
          : "Unknown";
  return <Badge variant={variant}>{label}</Badge>;
}
