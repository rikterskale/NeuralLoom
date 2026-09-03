import {
  claimRemoteAction,
  getAutomationArtifact,
  requireApproved,
} from "./automation.server.ts";
import type { HumanApprovalAction } from "./types.ts";

type RemoteAction = Extract<
  HumanApprovalAction,
  "deployment_to_live_environment" | "pull_request_merge" | "release_publication"
>;

export type RemoteActionInput = {
  runId: string;
  action: RemoteAction;
  target: string;
  expectedRevision: string;
  releaseTag: string;
  releaseName: string;
  confirmation: string;
};

const REMOTE_ACTIONS = new Set<RemoteAction>([
  "deployment_to_live_environment",
  "pull_request_merge",
  "release_publication",
]);

export function validateRemoteActionInput(value: unknown): RemoteActionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid remote action request.");
  const raw = value as Record<string, unknown>;
  const field = (name: keyof RemoteActionInput, max: number) => {
    const value = raw[name];
    if (typeof value !== "string" || value.length > max) throw new Error(`${name} must be text.`);
    return value.trim();
  };
  const action = field("action", 80) as RemoteAction;
  if (!REMOTE_ACTIONS.has(action)) throw new Error("Unsupported remote action.");
  return {
    runId: field("runId", 100),
    action,
    target: field("target", 2_048),
    expectedRevision: field("expectedRevision", 120),
    releaseTag: field("releaseTag", 120),
    releaseName: field("releaseName", 120),
    confirmation: field("confirmation", 80),
  };
}

type RemoteConfig = {
  githubToken: string | null;
  githubRepositories: string[];
  deployWebhookUrl: string | null;
  deployWebhookToken: string | null;
  deployTargets: string[];
};

export function loadRemoteConfig(env: NodeJS.ProcessEnv = process.env): RemoteConfig {
  return {
    githubToken: env.NEURALLOOM_GITHUB_TOKEN?.trim() || null,
    githubRepositories: (env.NEURALLOOM_GITHUB_REPOSITORIES || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
    deployWebhookUrl: env.NEURALLOOM_DEPLOY_WEBHOOK_URL?.trim() || null,
    deployWebhookToken: env.NEURALLOOM_DEPLOY_WEBHOOK_TOKEN?.trim() || null,
    deployTargets: (env.NEURALLOOM_DEPLOY_TARGETS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}

export async function executeRemoteAction(
  input: RemoteActionInput,
  userId: string,
  config: RemoteConfig = loadRemoteConfig(),
): Promise<string> {
  if (input.confirmation !== "EXECUTE APPROVED REMOTE ACTION") {
    throw new Error("Exact remote-action confirmation is required.");
  }
  const artifact = getAutomationArtifact(input.runId, userId);
  requireApproved(artifact, input.action);
  requireApproved(artifact, "outbound_network_access");
  if (!input.expectedRevision || input.expectedRevision !== artifact.revision) {
    throw new Error("The expected repository revision does not match the reviewed revision.");
  }
  claimRemoteAction(artifact, input.action);

  const reviewedRepository =
    artifact.source.kind === "url" ? githubRepositoryFromUrl(artifact.source.location) : null;

  switch (input.action) {
    case "pull_request_merge":
      return mergePullRequest(input.target, input.expectedRevision, reviewedRepository, config);
    case "release_publication":
      return publishRelease(input.target, input.releaseTag, input.releaseName, input.expectedRevision, reviewedRepository, config);
    case "deployment_to_live_environment":
      return requestDeployment(
        input,
        artifact.source.kind === "url" ? artifact.source.location : "local-workspace",
        config,
      );
  }
}

async function mergePullRequest(target: string, expectedRevision: string, reviewedRepository: string | null, config: RemoteConfig): Promise<string> {
  const parsed = parseGitHubTarget(target, true, config);
  assertReviewedRepository(reviewedRepository, parsed.repository);
  const response = await githubRequest(
    `/repos/${parsed.repository}/pulls/${parsed.number}/merge`,
    "PUT",
    { sha: expectedRevision, merge_method: "squash" },
    config,
  );
  if (response.merged !== true) throw new Error("GitHub did not confirm that the pull request merged.");
  return `GitHub confirmed pull request #${parsed.number} merged in ${parsed.repository}.`;
}

async function publishRelease(
  target: string,
  tag: string,
  name: string,
  expectedRevision: string,
  reviewedRepository: string | null,
  config: RemoteConfig,
): Promise<string> {
  const parsed = parseGitHubTarget(target, false, config);
  assertReviewedRepository(reviewedRepository, parsed.repository);
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(tag)) throw new Error("Release tag is missing or invalid.");
  const response = await githubRequest(
    `/repos/${parsed.repository}/releases`,
    "POST",
    {
      tag_name: tag,
      target_commitish: expectedRevision,
      name: name.trim().slice(0, 120) || tag,
      draft: false,
      prerelease: false,
      generate_release_notes: true,
    },
    config,
  );
  if (typeof response.id !== "number" || response.draft === true) {
    throw new Error("GitHub did not confirm release publication.");
  }
  return `GitHub confirmed release ${tag} was published in ${parsed.repository}.`;
}

function githubRepositoryFromUrl(location: string): string | null {
  const url = new URL(location);
  if (url.hostname.toLowerCase() !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`.toLowerCase() : null;
}

function assertReviewedRepository(reviewed: string | null, target: string): void {
  if (!reviewed || reviewed !== target) {
    throw new Error("GitHub action target must be the same public repository that was reviewed.");
  }
}

async function requestDeployment(
  input: RemoteActionInput,
  repository: string,
  config: RemoteConfig,
): Promise<string> {
  if (!config.deployWebhookUrl || !config.deployWebhookToken) {
    throw new Error("Deployment webhook URL and token are not configured.");
  }
  if (!config.deployTargets.includes(input.target)) {
    throw new Error("Deployment target is not in NEURALLOOM_DEPLOY_TARGETS.");
  }
  const url = new URL(config.deployWebhookUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Deployment webhook must be an HTTPS URL without embedded credentials or a custom port.");
  }
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${config.deployWebhookToken}`,
      "content-type": "application/json",
      "idempotency-key": `${input.runId}:${input.action}`,
    },
    body: JSON.stringify({
      runId: input.runId,
      repository,
      revision: input.expectedRevision,
      target: input.target,
    }),
  });
  if (!response.ok) throw new Error(`Deployment endpoint rejected the request with status ${response.status}.`);
  return "The allowlisted deployment endpoint accepted the request; final deployment health remains externally verified.";
}

function parseGitHubTarget(target: string, requirePull: boolean, config: RemoteConfig) {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error("Remote target must be a complete GitHub HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password) {
    throw new Error("Remote target must be an HTTPS github.com URL without credentials.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("GitHub target must identify an owner and repository.");
  const repository = `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`.toLowerCase();
  if (!config.githubRepositories.includes(repository)) {
    throw new Error("GitHub repository is not in NEURALLOOM_GITHUB_REPOSITORIES.");
  }
  let number: number | null = null;
  if (requirePull) {
    if (parts[2] !== "pull" || !/^\d+$/.test(parts[3] || "")) {
      throw new Error("Merge target must be a GitHub pull request URL.");
    }
    number = Number(parts[3]);
  }
  return { repository, number };
}

async function githubRequest(
  path: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
  config: RemoteConfig,
): Promise<Record<string, unknown>> {
  if (!config.githubToken) throw new Error("NEURALLOOM_GITHUB_TOKEN is not configured.");
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${config.githubToken}`,
      "content-type": "application/json",
      "user-agent": "NeuralLoom",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub rejected the action with status ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}
