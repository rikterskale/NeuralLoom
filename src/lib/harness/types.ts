export const ROLE_IDS = [
  "planner",
  "coder",
  "repo_agent",
  "security_specialist",
  "critic",
  "fast_triage",
] as const;

export type RoleId = (typeof ROLE_IDS)[number];
export const TASK_ROLE_IDS = [
  "planner",
  "coder",
  "repo_agent",
  "security_specialist",
  "fast_triage",
] as const;
export type TaskRoleId = (typeof TASK_ROLE_IDS)[number];

export type ThinkLevel = "low" | "high" | "max";

// Provider ids double as the prefix of a qualified model reference
// ("<provider>/<model>"). Adding a provider means adding an adapter under
// providers/ and registering its id here.
export const PROVIDER_IDS = ["ollama", "anthropic", "openai", "xai"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

// Locality, not provider identity, is what the data-lane guards key off:
// local_only material may never reach a model whose locality is "cloud".
export type ModelLocality = "local" | "cloud";

export const CLOUD_PERMITTED = [
  "public_repositories",
  "user_owned_nonclient_repositories",
  "synthetic_lab_data",
  "fully_redacted_engagement_context",
  "sanitized_tool_output",
  "public_vulnerability_information",
  "nonsecret_configuration",
  "generated_test_fixtures",
] as const;

export const EXPLICIT_AUTH_REQUIRED = [
  "client_private_source_code",
  "internal_company_source_code",
  "client_architecture_information",
  "client_vulnerability_details",
  "customer_identifiers",
  "nonpublic_assessment_reports",
] as const;

export const LOCAL_ONLY = [
  "usernames_and_passwords",
  "hashes",
  "kerberos_tickets",
  "access_tokens",
  "session_cookies",
  "private_keys",
  "certificates_and_pfx_files",
  "secrets_and_api_keys",
  "bloodhound_collections",
  "raw_active_directory_exports",
  "raw_packet_captures",
  "unredacted_logs",
  "unredacted_screenshots",
  "client_target_lists",
  "live_engagement_evidence",
] as const;

export type CloudPermittedClass = (typeof CLOUD_PERMITTED)[number];
export type ExplicitAuthClass = (typeof EXPLICIT_AUTH_REQUIRED)[number];
export type LocalOnlyClass = (typeof LOCAL_ONLY)[number];
export type KnownDataClass = CloudPermittedClass | ExplicitAuthClass | LocalOnlyClass;
export type DataClass = KnownDataClass | "unknown";

export type DataLane = "cloud_permitted" | "explicit_authorization" | "local_only" | "unknown";

export const HUMAN_APPROVAL_ACTIONS = [
  "generated_command_execution",
  "working_tree_patch",
  "outbound_network_access",
  "exploit_execution",
  "credential_operations",
  "authentication_testing",
  "persistence_testing",
  "lateral_movement_testing",
  "destructive_actions",
  "changes_outside_workspace",
  "deployment_to_live_environment",
  "pull_request_merge",
  "release_publication",
] as const;

export type HumanApprovalAction = (typeof HUMAN_APPROVAL_ACTIONS)[number];

export const DETERMINISTIC_CHECKS = [
  "formatter",
  "linter",
  "type_checker",
  "unit_tests",
  "integration_tests",
  "coverage_gate",
  "static_security_analysis",
  "dependency_audit",
  "secret_scan",
  "license_check",
] as const;

export type DeterministicCheck = (typeof DETERMINISTIC_CHECKS)[number];

export const CONTEXT_INCLUDE = [
  "repository_manifest",
  "symbol_index",
  "dependency_graph",
  "relevant_source_files",
  "relevant_tests",
  "configuration_files",
  "recent_diffs",
  "applicable_documentation",
] as const;

export const CONTEXT_EXCLUDE = [
  "build_artifacts",
  "dependency_vendor_directories",
  "binary_files",
  "secrets",
  "unrelated_large_files",
] as const;

export type ContextInclude = (typeof CONTEXT_INCLUDE)[number];

export type RepositorySource = {
  kind: "none" | "local" | "url";
  location: string;
};

export type RepositorySummary = {
  kind: "local" | "url";
  display: string;
  revision: string | null;
  indexedFiles: number;
  indexedBytes: number;
  truncated: boolean;
  mutable: boolean;
};

export type GeneratedCommand = {
  command: string;
  purpose: string;
};

export type RoleConfig = {
  id: RoleId;
  label: string;
  primary: string;
  fallbacks: string[];
  think: ThinkLevel;
  temperature: number;
  responsibilities: string[];
};

export type ModelSettings = Record<RoleId, string>;

export type ModelSettingsCheck = {
  role: RoleId;
  model: string;
  compatible: boolean;
  available: boolean;
  message: string;
};

export type ModelSettingsResult = {
  settings: ModelSettings;
  discovery: ModelDiscovery;
  checks: ModelSettingsCheck[];
  savedAt: string;
};

export type ModelRecord = {
  name: string;
  digest: string;
  available: boolean;
  provider: ProviderId;
  locality: ModelLocality;
  source: "configured" | "discovered";
  usedBy: RoleId[];
};

export type Classification = {
  classes: DataClass[];
  lane: DataLane;
  detected: KnownDataClass[];
  suggested: KnownDataClass[];
  reasons: string[];
  redactionRequired: boolean;
};

export type RouteDecision = {
  role: RoleId;
  selectedModel: string | null;
  selectedProvider: ProviderId | null;
  selectedLocality: ModelLocality | null;
  candidate: string;
  usedFallback: boolean;
  fallbackReason: string | null;
  denied: boolean;
  denyReason: string | null;
};

export type ExecutionDecision = {
  allowed: boolean;
  sandboxRequired: boolean;
  networkAccess: "deny" | "allowlisted";
  filesystemAccess: "workspace_only";
  secretsAccess: "deny_by_default";
  privilegedExecution: "deny_by_default";
  pendingApprovals: HumanApprovalAction[];
  targetControlFailures: string[];
};

export type CheckResult = {
  id: DeterministicCheck;
  status: "pass" | "fail" | "skip";
  detail: string;
};

export type VerificationResult = {
  structuredPlan: boolean;
  patchNotFullOverwrite: boolean;
  criticReview: boolean;
  criticAccepted: boolean;
  requiredChecksPassed: boolean;
  checks: CheckResult[];
  offensive: {
    environment: "isolated_authorized_lab";
    blockedExternalTarget: boolean;
  };
  accepted: boolean;
  notes: string[];
};

export type RunStatus =
  | "blocked"
  | "pending_authorization"
  | "pending_approval"
  | "running"
  | "needs_acceptance"
  | "accepted"
  | "rejected"
  | "failed";

export type AuditEvent = {
  at: string;
  kind:
    | "classify"
    | "route"
    | "execution"
    | "model_call"
    | "fallback"
    | "critic"
    | "verify"
    | "tool"
    | "decision";
  summary: string;
  fields?: Record<string, string | number | boolean | null>;
};

export type HarnessRun = {
  id: string;
  createdAt: string;
  title: string;
  objective: string;
  role: RoleId;
  status: RunStatus;
  classification: Classification;
  route: RouteDecision;
  execution: ExecutionDecision;
  verification: VerificationResult | null;
  promptTemplateVersion: string;
  intendedModel: string | null;
  runtimeModel: string | null;
  modelTag: string | null;
  modelDigest: string | null;
  fallbackReason: string | null;
  tokenUsage: { prompt: number; completion: number; total: number } | null;
  plan: string | null;
  patch: string | null;
  output: string | null;
  critic: string | null;
  commands: GeneratedCommand[];
  repository: RepositorySummary | null;
  approvedActions: HumanApprovalAction[];
  events: AuditEvent[];
  authorizationGranted: boolean;
  redactionVerified: boolean;
  operatorAccepted: boolean;
};

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  configured: boolean;
  endpoint: string | null;
  error: string | null;
};

export type ModelDiscovery = {
  inventory: ModelRecord[];
  roleModels: ModelSettings;
  discoveredAt: string;
  providers: ProviderStatus[];
  // Convenience mirrors of the Ollama provider status, which most of the UI
  // messaging is written around.
  endpoint: string;
  error: string | null;
};

export type DispatchResult = {
  run: HarnessRun;
};

export type DispatchInput = {
  title: string;
  objective: string;
  role: TaskRoleId | "auto";
  taggedClasses: KnownDataClass[];
  redactionVerified: boolean;
  authorizationGranted: boolean;
  requestedActions: HumanApprovalAction[];
  approvedActions: HumanApprovalAction[];
  contextIncludes: ContextInclude[];
  repository: RepositorySource;
  targetAllowlisted: boolean;
  authorizationRecord: boolean;
  simulatePrimaryFailure: boolean;
  operatorAcceptedLab: boolean;
};

export type AutomationResult = {
  run: HarnessRun;
  outcome: string;
};
