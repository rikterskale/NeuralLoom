import { spawn } from "node:child_process";
import { DETERMINISTIC_CHECKS, type CheckResult } from "./types";
import { runDeterministicChecks } from "./verify";
import { loadSandboxConfig, runSandboxChecks, type SandboxCheck } from "./sandbox.server";

const CHECK_TIMEOUT_MS = 10_000;

const CONTENT_CHECKS = new Set<CheckResult["id"]>([
  "secret_scan",
  "static_security_analysis",
  "license_check",
]);

export async function verifyArtifact(opts: {
  output: string;
  patch: string | null;
  plan: string | null;
  workspace?: string;
}): Promise<CheckResult[]> {
  const contentChecks = runDeterministicChecks(opts);
  const byId = new Map(contentChecks.map((check) => [check.id, check]));

  const config = loadSandboxConfig(process.env, opts.workspace);
  const sandbox = await runSandboxChecks({ patch: opts.patch }, config);

  const results: CheckResult[] = [];
  for (const id of DETERMINISTIC_CHECKS) {
    if (CONTENT_CHECKS.has(id)) {
      results.push(byId.get(id) as CheckResult);
      continue;
    }
    const fromSandbox = sandbox?.get(id as SandboxCheck);
    if (fromSandbox) {
      results.push(fromSandbox);
      continue;
    }
    // Sandbox disabled: keep the lightweight, working-tree-safe patch check for
    // integration_tests and leave every other workspace check honestly skipped.
    if (id === "integration_tests") {
      results.push(await patchApplies(opts.patch));
      continue;
    }
    results.push({
      id,
      status: "skip",
      detail:
        config.disabledReason ??
        "No isolated workspace runner is connected. This check is required before acceptance.",
    });
  }
  return results;
}

async function patchApplies(patch: string | null): Promise<CheckResult> {
  if (!patch) {
    return {
      id: "integration_tests",
      status: "pass",
      detail: "No patch was proposed; patch applicability is not required.",
    };
  }
  const result = await run("git", ["apply", "--check", "--recount", "-"], patch);
  return result.code === 0
    ? {
        id: "integration_tests",
        status: "pass",
        detail: "git apply --check accepted the patch without modifying the workspace.",
      }
    : {
        id: "integration_tests",
        status: "fail",
        detail: `Patch applicability failed: ${result.stderr.slice(0, 240) || "git apply rejected it"}`,
      };
}

function run(
  command: string,
  args: string[],
  stdin: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), CHECK_TIMEOUT_MS);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 2_000) stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr: stderr.trim() });
    });
    child.stdin.end(stdin);
  });
}
