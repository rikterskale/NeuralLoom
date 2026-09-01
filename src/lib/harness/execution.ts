import { HARNESS_SPEC } from "./spec.ts";
import type {
  Classification,
  DispatchInput,
  ExecutionDecision,
  HumanApprovalAction,
} from "./types.ts";

const OFFENSIVE: HumanApprovalAction[] = [
  "exploit_execution",
  "credential_operations",
  "authentication_testing",
  "persistence_testing",
  "lateral_movement_testing",
];

export function evaluateExecution(
  input: DispatchInput,
  _classification: Classification,
): ExecutionDecision {
  const pendingApprovals = input.requestedActions.filter(
    (action) => !input.approvedActions.includes(action),
  );

  const targetControlFailures: string[] = [];
  const needsTarget =
    input.requestedActions.some((a) => OFFENSIVE.includes(a)) ||
    input.requestedActions.includes("outbound_network_access") ||
    input.requestedActions.includes("deployment_to_live_environment");

  if (needsTarget) {
    const controls = HARNESS_SPEC.execution_policy.target_controls;
    if (controls.authorization_record_required && !input.authorizationRecord) {
      targetControlFailures.push("authorization_record_required");
    }
    if (controls.allowlist_required && !input.targetAllowlisted) {
      targetControlFailures.push("allowlist_required");
    }
    if (
      controls.private_and_reserved_ranges_denied_unless_allowlisted &&
      !input.targetAllowlisted
    ) {
      targetControlFailures.push("private_and_reserved_ranges_denied_unless_allowlisted");
    }
  }

  const allowed = pendingApprovals.length === 0 && targetControlFailures.length === 0;

  return {
    allowed,
    sandboxRequired: HARNESS_SPEC.execution_policy.command_execution.sandbox_required,
    networkAccess:
      input.requestedActions.includes("outbound_network_access") &&
      input.approvedActions.includes("outbound_network_access") &&
      input.targetAllowlisted
        ? "allowlisted"
        : "deny",
    filesystemAccess: "workspace_only",
    secretsAccess: "deny",
    privilegedExecution: "deny",
    pendingApprovals,
    targetControlFailures,
  };
}

export function authorizationSatisfied(classification: Classification, granted: boolean): boolean {
  if (classification.lane === "explicit_authorization") return granted;
  return true;
}

export function redactionSatisfied(classification: Classification, verified: boolean): boolean {
  if (classification.redactionRequired) return verified;
  return true;
}
