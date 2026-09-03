import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSandboxConfig,
  runSandboxChecks,
  scrubbedEnv,
  type SandboxConfig,
} from "./sandbox.server.ts";

test("sandbox is disabled by default with an honest reason", () => {
  const config = loadSandboxConfig({});
  assert.equal(config.enabled, false);
  assert.match(config.disabledReason ?? "", /required before acceptance/);
});

test("enabling without a workspace stays disabled", () => {
  const config = loadSandboxConfig({ NEURALLOOM_SANDBOX_ENABLED: "true" });
  assert.equal(config.enabled, false);
  assert.match(config.disabledReason ?? "", /NEURALLOOM_SANDBOX_WORKSPACE/);
});

test("enabling without any command stays disabled", () => {
  const config = loadSandboxConfig({
    NEURALLOOM_SANDBOX_ENABLED: "true",
    NEURALLOOM_SANDBOX_WORKSPACE: "/tmp/ws",
  });
  assert.equal(config.enabled, false);
  assert.match(config.disabledReason ?? "", /no checks are configured/i);
});

test("a workspace plus one command activates the sandbox", () => {
  const config = loadSandboxConfig({
    NEURALLOOM_SANDBOX_ENABLED: "true",
    NEURALLOOM_SANDBOX_WORKSPACE: "/tmp/ws",
    NEURALLOOM_SANDBOX_CMD_LINTER: "npm run lint",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.disabledReason, null);
  assert.equal(config.commands.linter, "npm run lint");
});

test("scrubbedEnv withholds secrets and non-allowlisted vars", () => {
  const config: Pick<SandboxConfig, "passEnv"> = { passEnv: ["MY_FLAG"] };
  const env = scrubbedEnv(config, {
    PATH: "/usr/bin",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    DATABASE_URL: "postgres://secret",
    GITHUB_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz012345",
    MY_FLAG: "on",
    MY_SECRET: "sk-abcdefghijklmnopqrstuvwxyz",
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.MY_FLAG, "on");
  assert.equal(env.CI, "1");
  assert.equal(env.OLLAMA_BASE_URL, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.MY_SECRET, undefined);
});

test("an allowlisted var holding a secret value is still dropped", () => {
  const env = scrubbedEnv(
    { passEnv: ["TOKENISH"] },
    { TOKENISH: "ghp_abcdefghijklmnopqrstuvwxyz012345" },
  );
  assert.equal(env.TOKENISH, undefined);
});

test("runSandboxChecks returns null when the sandbox is disabled", async () => {
  const result = await runSandboxChecks({ patch: null }, loadSandboxConfig({}));
  assert.equal(result, null);
});

test("configured commands run in an isolated snapshot and report real results", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "neuralloom-ws-"));
  await writeFile(join(workspace, "marker.txt"), "hello", "utf8");
  try {
    const config = loadSandboxConfig({
      NEURALLOOM_SANDBOX_ENABLED: "true",
      NEURALLOOM_SANDBOX_WORKSPACE: workspace,
      NEURALLOOM_SANDBOX_CMD_LINTER: "test -f marker.txt",
      NEURALLOOM_SANDBOX_CMD_UNIT_TESTS: "exit 3",
    });
    const results = await runSandboxChecks({ patch: null }, config);
    assert.ok(results);
    assert.equal(results.get("linter")?.status, "pass");
    assert.equal(results.get("unit_tests")?.status, "fail");
    // No command configured for these -> honestly skipped, not silently passed.
    assert.equal(results.get("type_checker")?.status, "skip");
    // No patch -> integration is a pass with the "no patch" rationale.
    assert.equal(results.get("integration_tests")?.status, "pass");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the snapshot is a copy; commands cannot mutate the real workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "neuralloom-ws-"));
  await writeFile(join(workspace, "keep.txt"), "original", "utf8");
  try {
    const config = loadSandboxConfig({
      NEURALLOOM_SANDBOX_ENABLED: "true",
      NEURALLOOM_SANDBOX_WORKSPACE: workspace,
      NEURALLOOM_SANDBOX_CMD_LINTER: "rm -f keep.txt && test ! -f keep.txt",
    });
    const results = await runSandboxChecks({ patch: null }, config);
    assert.equal(results?.get("linter")?.status, "pass");
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(join(workspace, "keep.txt"), "utf8"), "original");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
