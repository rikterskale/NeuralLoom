import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createDisposableCopy, prepareRepository } from "./repository.server.ts";
import {
  getAutomationArtifact,
  markCommandsExecuted,
  requireApproved,
} from "./automation.server.ts";

export type ContainerConfig = {
  enabled: boolean;
  runtime: "docker" | "podman";
  image: string | null;
  timeoutMs: number;
  maxOutputBytes: number;
  memory: string;
  cpus: string;
  tempRoot: string | undefined;
  copyIgnore: string[];
};

export function loadContainerConfig(env: NodeJS.ProcessEnv = process.env): ContainerConfig {
  const runtime = env.NEURALLOOM_CONTAINER_RUNTIME === "podman" ? "podman" : "docker";
  return {
    enabled: env.NEURALLOOM_CONTAINER_ENABLED === "true",
    runtime,
    image: env.NEURALLOOM_CONTAINER_IMAGE?.trim() || null,
    timeoutMs: bounded(env.NEURALLOOM_CONTAINER_TIMEOUT_MS, 120_000, 1_000, 900_000),
    maxOutputBytes: bounded(env.NEURALLOOM_CONTAINER_MAX_BYTES, 32_000, 1_000, 1_000_000),
    memory: env.NEURALLOOM_CONTAINER_MEMORY?.trim() || "1g",
    cpus: env.NEURALLOOM_CONTAINER_CPUS?.trim() || "1",
    tempRoot: env.NEURALLOOM_REPOSITORY_TEMP_ROOT?.trim() || undefined,
    copyIgnore: (env.NEURALLOOM_CONTAINER_COPY_IGNORE || ".git,dist,build,.next,.tanstack,.vercel,coverage")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}

export async function executeReviewedCommands(opts: {
  runId: string;
  userId: string;
  confirmation: string;
  config?: ContainerConfig;
}): Promise<string> {
  if (opts.confirmation !== "RUN IN ISOLATED CONTAINER") {
    throw new Error("Exact container execution confirmation is required.");
  }
  const artifact = getAutomationArtifact(opts.runId, opts.userId);
  requireApproved(artifact, "generated_command_execution");
  if (artifact.source.kind === "url") requireApproved(artifact, "outbound_network_access");
  if (!artifact.commands.length) throw new Error("This run contains no generated commands.");
  const config = opts.config ?? loadContainerConfig();
  if (!config.enabled || !config.image) {
    throw new Error("Container execution is disabled or NEURALLOOM_CONTAINER_IMAGE is not configured.");
  }
  validateContainerImage(config.image);

  const prepared = await prepareRepository(
    artifact.source,
    "",
    [],
    artifact.source.kind === "url",
  );
  if (!prepared) throw new Error("Generated commands require a repository source.");
  try {
    if (artifact.revision && prepared.summary.revision !== artifact.revision) {
      throw new Error("Repository revision changed after review; refusing stale command execution.");
    }
    const snapshot = await createDisposableCopy(prepared.root, config.tempRoot, config.copyIgnore);
    try {
      markCommandsExecuted(artifact);
      const reports: string[] = [];
      for (const generated of artifact.commands) {
        const result = await runIsolatedContainerCommand(snapshot.root, generated.command, config);
        reports.push(
          `${generated.purpose || "Generated command"}: ${result.code === 0 ? "passed" : "failed"} (${generated.command})${result.output ? `\n${result.output}` : ""}`,
        );
        if (result.code !== 0) break;
      }
      return reports.join("\n\n");
    } finally {
      await snapshot.cleanup().catch(() => {});
    }
  } finally {
    await prepared.cleanup().catch(() => {});
  }
}

export async function runIsolatedContainerCommand(
  workspace: string,
  command: string,
  config: ContainerConfig,
): Promise<{ code: number; output: string }> {
  validateContainerImage(config.image);
  if (workspace.includes(",")) throw new Error("Workspace paths containing commas are not supported by the container mount boundary.");
  const name = `neuralloom-${randomUUID()}`;
  const args = [
    ...(config.runtime === "docker" ? ["--context", "default"] : []),
    "run",
    "--rm",
    "--name",
    name,
    "--pull",
    "never",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    config.memory,
    "--cpus",
    config.cpus,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--env",
    "HOME=/tmp",
    "--env",
    "CI=1",
    "--env",
    "NODE_ENV=test",
    "--mount",
    `type=bind,source=${workspace},target=/workspace`,
    "--workdir",
    "/workspace",
    "--entrypoint",
    "/bin/sh",
    config.image as string,
    "-lc",
    command,
  ];
  return new Promise((resolve) => {
    const child = spawn(config.runtime, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: runtimeEnvironment(),
    });
    let output = "";
    let settled = false;
    let timedOut = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output: output.trim() });
    };
    const capture = (chunk: Buffer) => {
      if (output.length < config.maxOutputBytes) output += chunk.toString("utf8");
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", (error) => {
      output += error.message;
      if (!timedOut) finish(1);
    });
    child.on("close", (code) => {
      if (!timedOut) finish(code ?? 1);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      output += `\nCommand exceeded ${config.timeoutMs}ms and the container was terminated.`;
      child.kill();
      void removeContainer(config.runtime, name).finally(() => finish(124));
    }, config.timeoutMs);
  });
}

export function validateContainerImage(image: string | null): asserts image is string {
  if (!image || image.startsWith("-") || !/^[A-Za-z0-9._/@:-]+$/.test(image)) {
    throw new Error("Configured container image is missing or invalid.");
  }
}

async function removeContainer(runtime: "docker" | "podman", name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const args = [...(runtime === "docker" ? ["--context", "default"] : []), "rm", "-f", name];
    const child = spawn(runtime, args, {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env: runtimeEnvironment(),
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    child.on("error", finish);
    child.on("close", finish);
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, 10_000);
  });
}

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function runtimeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}
