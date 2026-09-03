import type { HumanApprovalAction, RunStatus } from "./types";

export const ACTION_LABELS: Record<HumanApprovalAction, string> = {
  generated_command_execution: "Run generated commands in a container",
  working_tree_patch: "Apply reviewed patch to working tree",
  outbound_network_access: "Outbound network",
  exploit_execution: "Exploit execution",
  credential_operations: "Credential operations",
  authentication_testing: "Authentication testing",
  persistence_testing: "Persistence testing",
  lateral_movement_testing: "Lateral movement",
  destructive_actions: "Destructive actions",
  changes_outside_workspace: "Outside workspace",
  deployment_to_live_environment: "Live deployment",
  pull_request_merge: "Pull request merge",
  release_publication: "Release publication",
};

export const STATUS_LABELS: Record<RunStatus, string> = {
  blocked: "Blocked",
  pending_authorization: "Needs authorization",
  pending_approval: "Needs approval",
  running: "Running",
  needs_acceptance: "Needs acceptance",
  accepted: "Accepted",
  rejected: "Rejected",
  failed: "Failed",
};

export function formatClass(id: string) {
  return id.replaceAll("_", " ");
}

export function relativeTime(iso: string) {
  const delta = Date.now() - new Date(iso).getTime();
  const min = Math.round(delta / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
