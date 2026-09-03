import { spawn } from "node:child_process";
import { devNull } from "node:os";
import type { GeneratedCommand, HumanApprovalAction, RepositorySource } from "./types.ts";
import { fileDigest, patchPaths, validatePatchTargets } from "./repository.server.ts";

const ARTIFACT_TTL_MS = 30 * 60 * 1_000;

type AutomationArtifact = {
  runId: string;
  userId: string;
  source: RepositorySource;
  root: string | null;
  revision: string | null;
  patch: string | null;
  paths: string[];
  initialDigest: string | null;
  commands: GeneratedCommand[];
  approvedActions: HumanApprovalAction[];
  targetAllowlisted: boolean;
  authorizationRecord: boolean;
  expiresAt: number;
  patchApplied: boolean;
  commandsExecuted: boolean;
  remoteActionsExecuted: Set<HumanApprovalAction>;
};

const artifacts = new Map<string, AutomationArtifact>();

export async function registerAutomationArtifact(opts: {
  runId: string;
  userId: string;
  source: RepositorySource;
  root: string | null;
  revision: string | null;
  patch: string | null;
  commands: GeneratedCommand[];
  approvedActions: HumanApprovalAction[];
  targetAllowlisted: boolean;
  authorizationRecord: boolean;
}): Promise<void> {
  const paths = opts.patch ? patchPaths(opts.patch) : [];
  if (opts.root && paths.length) await validatePatchTargets(opts.root, paths);
  const initialDigest = opts.root && paths.length ? await fileDigest(opts.root, paths) : null;
  sweepArtifacts();
  artifacts.set(opts.runId, {
    ...opts,
    paths,
    initialDigest,
    expiresAt: Date.now() + ARTIFACT_TTL_MS,
    patchApplied: false,
    commandsExecuted: false,
    remoteActionsExecuted: new Set(),
  });
}

export function clearAutomationArtifacts(userId: string): void {
  for (const [runId, artifact] of artifacts) {
    if (artifact.userId === userId) artifacts.delete(runId);
  }
}

export function getAutomationArtifact(runId: string, userId: string): AutomationArtifact {
  const artifact = artifacts.get(runId);
  if (!artifact || artifact.userId !== userId) throw new Error("Automation artifact is unavailable or belongs to another user.");
  if (Date.now() > artifact.expiresAt) {
    artifacts.delete(runId);
    throw new Error("Automation approval expired. Run the reviewed task again.");
  }
  return artifact;
}

export async function applyReviewedPatch(opts: {
  runId: string;
  userId: string;
  confirmation: string;
}): Promise<string> {
  if (opts.confirmation !== "APPLY REVIEWED PATCH") {
    throw new Error("Exact patch confirmation is required.");
  }
  const artifact = getAutomationArtifact(opts.runId, opts.userId);
  requireApproved(artifact, "working_tree_patch");
  if (!artifact.root || artifact.source.kind !== "local") {
    throw new Error("A reviewed patch can only be applied to its authorized local repository.");
  }
  if (!artifact.patch || !artifact.paths.length || !artifact.initialDigest) {
    throw new Error("This run has no applicable patch.");
  }
  if (artifact.patchApplied) throw new Error("This patch was already applied.");
  await validatePatchTargets(artifact.root, artifact.paths);
  const currentDigest = await fileDigest(artifact.root, artifact.paths);
  if (currentDigest !== artifact.initialDigest) {
    throw new Error("A target file changed after review; refusing to apply a stale patch.");
  }

  const checked = await gitApply(artifact.root, artifact.patch, true);
  if (checked.code !== 0) throw new Error(`Patch preflight failed: ${checked.stderr || "git apply rejected it"}`);
  const applied = await gitApply(artifact.root, artifact.patch, false);
  if (applied.code !== 0) throw new Error(`Patch application failed: ${applied.stderr || "git apply rejected it"}`);
  artifact.patchApplied = true;
  return `Applied the reviewed patch to ${artifact.source.location}. Recovery: review the diff, then use git apply -R with the original patch if it must be reversed.`;
}

export function markCommandsExecuted(artifact: AutomationArtifact): void {
  if (artifact.commandsExecuted) throw new Error("Generated commands were already executed for this run.");
  artifact.commandsExecuted = true;
}

export function claimRemoteAction(
  artifact: AutomationArtifact,
  action: HumanApprovalAction,
): void {
  if (artifact.remoteActionsExecuted.has(action)) {
    throw new Error("This remote action was already attempted for the run.");
  }
  artifact.remoteActionsExecuted.add(action);
}

export function requireApproved(
  artifact: AutomationArtifact,
  action: HumanApprovalAction,
): void {
  if (!artifact.approvedActions.includes(action)) {
    throw new Error(`The ${action} action was not approved before model execution.`);
  }
  if (!artifact.targetAllowlisted || !artifact.authorizationRecord) {
    throw new Error("Automation requires an allowlisted target and an authorization record.");
  }
}

function gitApply(root: string, patch: string, check: boolean): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const args = ["apply", "--recount", ...(check ? ["--check"] : []), "-"];
    const child = spawn("git", args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
      env: minimalEnvironment(),
    });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 15_000);
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr: stderr.trim() });
    });
    child.stdin.end(patch);
  });
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : devNull,
  };
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

function sweepArtifacts(): void {
  const now = Date.now();
  for (const [runId, artifact] of artifacts) {
    if (artifact.expiresAt < now) artifacts.delete(runId);
  }
  while (artifacts.size >= 256) {
    const oldest = artifacts.keys().next().value as string | undefined;
    if (!oldest) break;
    artifacts.delete(oldest);
  }
}
