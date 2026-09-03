import { classifyPayload } from "./classify.ts";
import { authorizationSatisfied, evaluateExecution, redactionSatisfied } from "./execution.ts";
import { digestFor, HARNESS_SPEC, PROMPT_TEMPLATE_VERSION, ROLE_CATALOG } from "./spec.ts";
import { routeRole } from "./route.ts";
import type {
  AuditEvent,
  Classification,
  DispatchInput,
  ExecutionDecision,
  HarnessRun,
  ModelRecord,
  RoleConfig,
  RoleId,
  RouteDecision,
  RunStatus,
} from "./types.ts";

export type PolicySnapshot = {
  title: string;
  objective: string;
  classification: Classification;
  route: RouteDecision;
  execution: ExecutionDecision;
  status: RunStatus;
  canCallModel: boolean;
  blockReason: string | null;
  authorizationGranted: boolean;
  redactionVerified: boolean;
};

function event(
  kind: AuditEvent["kind"],
  summary: string,
  fields?: AuditEvent["fields"],
): AuditEvent {
  return { at: new Date().toISOString(), kind, summary, fields };
}

export function evaluateDispatch(
  input: DispatchInput,
  inventory: ModelRecord[],
  catalog: Record<RoleId, RoleConfig> = ROLE_CATALOG,
  classificationText: string = input.objective,
): PolicySnapshot {
  const classification = classifyPayload(classificationText, input.taggedClasses);
  const routed = routeRole({
    requested: input.role,
    objective: input.objective,
    classification,
    inventory,
    simulatePrimaryFailure: input.simulatePrimaryFailure,
    failClosedWhenPrimaryMissing:
      HARNESS_SPEC.cloud_primary.model_discovery.fail_closed_when_primary_missing,
    preventUnapprovedSubstitution:
      HARNESS_SPEC.cloud_primary.model_discovery.prevent_unapproved_model_substitution,
    catalog,
  });
  const execution = evaluateExecution(input, classification);
  const authOk = authorizationSatisfied(classification, input.authorizationGranted);
  const redactOk = redactionSatisfied(classification, input.redactionVerified);
  const critic = inventory.find((model) => model.name === catalog.critic.primary);
  const localOnlyCriticReady =
    classification.lane !== "local_only" ||
    (critic?.available === true && critic.locality === "local");

  let status: RunStatus = "running";
  let blockReason: string | null = null;

  if (classification.lane === "unknown") {
    status = "blocked";
    blockReason = "Unknown data class blocked (deny by default).";
  } else if (classification.lane === "local_only" && !localOnlyCriticReady) {
    status = "blocked";
    blockReason = "Local-only data requires a local Ollama task model and local critic.";
  } else if (!redactOk) {
    status = "blocked";
    blockReason = "require_redaction_verification — confirm redaction before the call.";
  } else if (!authOk) {
    status = "pending_authorization";
    blockReason = "Explicit authorization is required for this data class.";
  } else if (routed.denied) {
    status = "blocked";
    blockReason = routed.denyReason;
  } else if (execution.pendingApprovals.length > 0) {
    status = "pending_approval";
    blockReason = `Human approval required: ${execution.pendingApprovals.join(", ")}`;
  } else if (execution.targetControlFailures.length > 0) {
    status = "blocked";
    blockReason = `Target controls failed: ${execution.targetControlFailures.join(", ")}`;
  }

  const title =
    input.title.trim() ||
    input.objective.trim().slice(0, 72) ||
    `${catalog[routed.role].label} run`;

  return {
    title,
    objective: input.objective,
    classification,
    route: routed,
    execution,
    status,
    canCallModel: status === "running",
    blockReason,
    authorizationGranted: input.authorizationGranted,
    redactionVerified: input.redactionVerified,
  };
}

export function materializeRun(snapshot: PolicySnapshot): HarnessRun {
  const events: AuditEvent[] = [
    event("classify", `Lane ${snapshot.classification.lane}`, {
      classes: snapshot.classification.classes.join(", "),
      redactionRequired: snapshot.classification.redactionRequired,
    }),
    event(
      "route",
      snapshot.route.denied ? "Routing denied" : `Selected ${snapshot.route.selectedModel}`,
      {
        role: snapshot.route.role,
        candidate: snapshot.route.candidate,
        provider: snapshot.route.selectedProvider,
        usedFallback: snapshot.route.usedFallback,
      },
    ),
  ];
  if (snapshot.route.fallbackReason) {
    events.push(
      event("fallback", snapshot.route.fallbackReason, {
        model: snapshot.route.selectedModel,
      }),
    );
  }
  events.push(
    event("execution", snapshot.execution.allowed ? "Execution gates clear" : "Execution gated", {
      sandbox: snapshot.execution.sandboxRequired,
      network: snapshot.execution.networkAccess,
    }),
  );
  events.push(
    event("decision", snapshot.status === "running" ? "Clear to call model" : snapshot.status, {
      promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    }),
  );

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title: snapshot.title,
    objective: snapshot.objective,
    role: snapshot.route.role,
    status: snapshot.status,
    classification: snapshot.classification,
    route: snapshot.route,
    execution: snapshot.execution,
    verification: null,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    intendedModel: snapshot.route.selectedModel,
    runtimeModel: null,
    modelTag: snapshot.route.selectedModel,
    modelDigest: snapshot.route.selectedModel ? digestFor(snapshot.route.selectedModel) : null,
    fallbackReason: snapshot.route.fallbackReason,
    tokenUsage: null,
    plan: null,
    patch: null,
    output: null,
    critic: null,
    commands: [],
    repository: null,
    approvedActions: [],
    events,
    authorizationGranted: snapshot.authorizationGranted,
    redactionVerified: snapshot.redactionVerified,
    operatorAccepted: false,
  };
}
