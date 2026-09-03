import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckResult, DeterministicCheck } from "./types";

/**
 * Checks that can only be answered by executing tooling against a real working
 * tree. Everything else in DETERMINISTIC_CHECKS is a content check that runs
 * in-process (see verify.ts) and never touches a sandbox.
 */
export const SANDBOX_CHECKS = [
  "formatter",
  "linter",
  "type_checker",
  "unit_tests",
  "integration_tests",
  "coverage_gate",
  "dependency_audit",
] as const;

export type SandboxCheck = (typeof SANDBOX_CHECKS)[number];

const ENV_CMD: Record<SandboxCheck, string> = {
  formatter: "NEURALLOOM_SANDBOX_CMD_FORMATTER",
  linter: "NEURALLOOM_SANDBOX_CMD_LINTER",
  type_checker: "NEURALLOOM_SANDBOX_CMD_TYPE_CHECKER",
  unit_tests: "NEURALLOOM_SANDBOX_CMD_UNIT_TESTS",
  integration_tests: "NEURALLOOM_SANDBOX_CMD_INTEGRATION_TESTS",
  coverage_gate: "NEURALLOOM_SANDBOX_CMD_COVERAGE_GATE",
  dependency_audit: "NEURALLOOM_SANDBOX_CMD_DEPENDENCY_AUDIT",
};

/**
 * Environment variables the sandboxed child is allowed to inherit. Everything
 * else — API keys, tokens, DATABASE_URL, the OLLAMA_* endpoint, and all
 * NEURALLOOM_SANDBOX_* config — is withheld so a generated command run against
 * a generated patch can never read or exfiltrate a local secret. Operators can
 * widen this with NEURALLOOM_SANDBOX_PASS_ENV, but only deliberately.
 */
const BASE_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TZ",
];

export type SandboxConfig = {
  enabled: boolean;
  workspace: string | null;
  root: string;
  commands: Partial<Record<SandboxCheck, string>>;
  passEnv: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  copyIgnore: string[];
  /** Why the sandbox is not active, when it is not. */
  disabledReason: string | null;
};

function num(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim();
  if (raw === undefined) return fallback;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadSandboxConfig(env: NodeJS.ProcessEnv = process.env): SandboxConfig {
  const enabled = env.NEURALLOOM_SANDBOX_ENABLED === "true";
  const workspace = env.NEURALLOOM_SANDBOX_WORKSPACE?.trim() || null;
  const commands: Partial<Record<SandboxCheck, string>> = {};
  for (const check of SANDBOX_CHECKS) {
    const value = env[ENV_CMD[check]]?.trim();
    if (value) commands[check] = value;
  }

  let disabledReason: string | null = null;
  if (!enabled) {
    disabledReason = "No isolated workspace runner is connected. This check is required before acceptance.";
  } else if (!workspace) {
    disabledReason =
      "Sandbox enabled without NEURALLOOM_SANDBOX_WORKSPACE; refusing to run checks against no workspace.";
  } else if (Object.keys(commands).length === 0) {
    disabledReason =
      "Sandbox enabled without any NEURALLOOM_SANDBOX_CMD_* commands; no checks are configured to run.";
  }

  return {
    enabled: enabled && disabledReason === null,
    workspace,
    root: env.NEURALLOOM_SANDBOX_ROOT?.trim() || tmpdir(),
    commands,
    passEnv: list("NEURALLOOM_SANDBOX_PASS_ENV", []),
    timeoutMs: num("NEURALLOOM_SANDBOX_TIMEOUT_MS", 120_000, 1_000, 900_000),
    maxOutputBytes: num("NEURALLOOM_SANDBOX_MAX_BYTES", 16_000, 1_000, 1_000_000),
    copyIgnore: list("NEURALLOOM_SANDBOX_COPY_IGNORE", ["node_modules", ".git"]),
    disabledReason,
  };
}

/**
 * Build the child environment from an allowlist. A value is dropped even when
 * its name is allowlisted if the value itself looks like a secret, so an
 * operator who widens PASS_ENV cannot accidentally leak a token.
 */
export function scrubbedEnv(
  config: Pick<SandboxConfig, "passEnv">,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allow = new Set([...BASE_ENV_ALLOWLIST, ...config.passEnv]);
  const out: NodeJS.ProcessEnv = { CI: "1", NODE_ENV: "test" };
  for (const name of allow) {
    const value = env[name];
    if (value === undefined) continue;
    if (looksSecret(value)) continue;
    out[name] = value;
  }
  return out;
}

const SECRET_VALUE_RE =
  /\b(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)\b/;

function looksSecret(value: string): boolean {
  return SECRET_VALUE_RE.test(value);
}

type Exec = { code: number; timedOut: boolean; output: string };

/**
 * Run every configured sandbox check against a fresh, disposable snapshot of
 * the operator's workspace. Returns null when the sandbox is not active, in
 * which case callers keep their existing skip behavior. The user's real working
 * tree is never opened or modified: work happens only inside a temp directory
 * that is removed before returning.
 */
export async function runSandboxChecks(
  opts: { patch: string | null },
  config: SandboxConfig = loadSandboxConfig(),
): Promise<Map<SandboxCheck, CheckResult> | null> {
  if (!config.enabled || !config.workspace) return null;

  const results = new Map<SandboxCheck, CheckResult>();
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(config.root, "neuralloom-sbx-"));
    await cp(config.workspace, dir, {
      recursive: true,
      filter: (source) => !isIgnored(source, config.workspace as string, config.copyIgnore),
    });

    const applied = await applyPatch(dir, opts.patch, config);
    if (applied && applied.status === "fail") {
      // A patch that will not apply is a hard failure for the run: none of the
      // downstream checks would be measuring the proposed artifact.
      for (const check of SANDBOX_CHECKS) {
        results.set(check, config.commands[check] ? applied : skip(check, config));
      }
      results.set("integration_tests", applied);
      return results;
    }

    const env = scrubbedEnv(config);
    for (const check of SANDBOX_CHECKS) {
      const command = config.commands[check];
      if (!command) {
        results.set(check, skip(check, config));
        continue;
      }
      const run = await execIn(dir, command, config, env);
      results.set(check, toResult(check, command, run, config));
    }

    // With no explicit integration command, a clean patch application is the
    // integration signal — the artifact merges into the workspace.
    if (!config.commands.integration_tests && applied) {
      results.set("integration_tests", applied);
    }
    return results;
  } catch (cause) {
    const detail = `Sandbox runner error: ${message(cause)}`;
    for (const check of SANDBOX_CHECKS) {
      results.set(check, { id: check, status: "skip", detail });
    }
    return results;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function isIgnored(source: string, workspace: string, ignore: string[]): boolean {
  const rel = source.slice(workspace.length).replace(/^[/\\]/, "");
  if (!rel) return false;
  const segments = rel.split(/[/\\]/);
  return ignore.some((entry) => segments.includes(entry));
}

async function applyPatch(
  dir: string,
  patch: string | null,
  config: SandboxConfig,
): Promise<CheckResult | null> {
  if (!patch) {
    return {
      id: "integration_tests",
      status: "pass",
      detail: "No patch was proposed; patch applicability is not required.",
    };
  }
  const patchFile = join(dir, ".neuralloom-artifact.patch");
  await writeFile(patchFile, patch.endsWith("\n") ? patch : `${patch}\n`, "utf8");
  const env = scrubbedEnv(config);
  const run = await execIn(dir, `git init -q && git apply --recount "${patchFile}"`, config, env);
  if (run.code === 0) {
    return {
      id: "integration_tests",
      status: "pass",
      detail: "Patch applied cleanly inside the isolated sandbox snapshot.",
    };
  }
  return {
    id: "integration_tests",
    status: "fail",
    detail: `Patch did not apply in the sandbox: ${run.output.slice(0, 240) || "git apply rejected it"}`,
  };
}

function toResult(
  check: SandboxCheck,
  command: string,
  run: Exec,
  config: SandboxConfig,
): CheckResult {
  if (run.timedOut) {
    return {
      id: check,
      status: "fail",
      detail: `\`${command}\` exceeded ${config.timeoutMs}ms in the sandbox and was terminated.`,
    };
  }
  if (run.code === 0) {
    return { id: check, status: "pass", detail: `\`${command}\` passed in the isolated sandbox.` };
  }
  return {
    id: check,
    status: "fail",
    detail: `\`${command}\` exited ${run.code}: ${run.output.slice(0, 240) || "no output"}`,
  };
}

function skip(check: SandboxCheck, config: SandboxConfig): CheckResult {
  return {
    id: check,
    status: "skip",
    detail:
      config.disabledReason ??
      "No command is configured for this check. It is required before acceptance.",
  };
}

function execIn(
  dir: string,
  command: string,
  config: SandboxConfig,
  env: NodeJS.ProcessEnv,
): Promise<Exec> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: dir,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, config.timeoutMs);
    const capture = (chunk: Buffer) => {
      if (output.length < config.maxOutputBytes) output += chunk.toString("utf8");
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, timedOut, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, timedOut, output: output.trim() });
    });
  });
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : "unknown error";
}

// Re-exported so callers can keep the check universe in one place.
export type { DeterministicCheck };
