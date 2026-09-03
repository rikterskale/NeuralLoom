import {
  CONTEXT_INCLUDE,
  HUMAN_APPROVAL_ACTIONS,
  TASK_ROLE_IDS,
  type ContextInclude,
  type DispatchInput,
  type HumanApprovalAction,
  type KnownDataClass,
  type RepositorySource,
} from "./types.ts";
import { CLOUD_PERMITTED, EXPLICIT_AUTH_REQUIRED, LOCAL_ONLY } from "./types.ts";

const DATA_CLASSES = new Set<string>([
  ...CLOUD_PERMITTED,
  ...EXPLICIT_AUTH_REQUIRED,
  ...LOCAL_ONLY,
]);
const ROLES = new Set<string>(["auto", ...TASK_ROLE_IDS]);
const ACTIONS = new Set<string>(HUMAN_APPROVAL_ACTIONS);
const CONTEXTS = new Set<string>(CONTEXT_INCLUDE);

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  const clean = value.trim();
  if (clean.length > max) throw new Error(`${name} is too long`);
  return clean;
}

function bool(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown, name: string, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be a list`);
  const items = [...new Set(value)];
  if (items.length > 32 || items.some((item) => typeof item !== "string" || !allowed.has(item))) {
    throw new Error(`${name} contains an unsupported value`);
  }
  return items as string[];
}

function repositorySource(value: unknown): RepositorySource {
  if (value === undefined || value === null) return { kind: "none", location: "" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Repository source must be an object");
  }
  const raw = value as Record<string, unknown>;
  const kind = text(raw.kind ?? "none", "Repository kind", 16);
  if (!(["none", "local", "url"] as const).includes(kind as RepositorySource["kind"])) {
    throw new Error("Unsupported repository source");
  }
  const location = text(raw.location ?? "", "Repository location", 2_048);
  if (kind !== "none" && !location) throw new Error("Repository location is required");
  return { kind: kind as RepositorySource["kind"], location };
}

export function validateDispatchInput(value: unknown): DispatchInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid dispatch request");
  }
  const raw = value as Record<string, unknown>;
  const objective = text(raw.objective, "Objective", 20_000);
  if (objective.length < 8) throw new Error("Describe the task in at least 8 characters");
  const role = text(raw.role ?? "auto", "Role", 40);
  if (!ROLES.has(role)) throw new Error("Unsupported role");
  const requestedActions = stringArray(raw.requestedActions ?? [], "Requested actions", ACTIONS);
  const approvedActions = stringArray(
    raw.approvedActions ?? [],
    "Approved actions",
    ACTIONS,
  ).filter((action) => requestedActions.includes(action));
  const repository = repositorySource(raw.repository);
  const repositoryActions = new Set([
    "generated_command_execution",
    "working_tree_patch",
    "deployment_to_live_environment",
    "pull_request_merge",
    "release_publication",
  ]);
  if (requestedActions.some((action) => repositoryActions.has(action)) && repository.kind === "none") {
    throw new Error("Repository automation actions require a repository source");
  }
  if (requestedActions.includes("working_tree_patch") && repository.kind !== "local") {
    throw new Error("Working-tree patch application requires a local repository source");
  }
  if (
    requestedActions.some((action) => ["pull_request_merge", "release_publication"].includes(action)) &&
    repository.kind !== "url"
  ) {
    throw new Error("GitHub merge and release actions require a public repository URL source");
  }

  return {
    title: text(raw.title ?? "", "Title", 160),
    objective,
    role: role as DispatchInput["role"],
    taggedClasses: stringArray(
      raw.taggedClasses ?? [],
      "Data classes",
      DATA_CLASSES,
    ) as KnownDataClass[],
    redactionVerified: bool(raw.redactionVerified),
    authorizationGranted: bool(raw.authorizationGranted),
    requestedActions: requestedActions as HumanApprovalAction[],
    approvedActions: approvedActions as HumanApprovalAction[],
    contextIncludes: stringArray(
      raw.contextIncludes ?? [],
      "Context",
      CONTEXTS,
    ) as ContextInclude[],
    repository,
    targetAllowlisted: bool(raw.targetAllowlisted),
    authorizationRecord: bool(raw.authorizationRecord),
    simulatePrimaryFailure:
      process.env.NODE_ENV !== "production" && bool(raw.simulatePrimaryFailure),
    operatorAcceptedLab: bool(raw.operatorAcceptedLab),
  };
}
