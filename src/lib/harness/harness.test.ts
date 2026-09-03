import assert from "node:assert/strict";
import test from "node:test";
import { redactRunForAudit } from "./audit-redaction.ts";
import { classifyPayload } from "./classify.ts";
import { parseCriticVerdict } from "./critic.ts";
import { evaluateDispatch, materializeRun } from "./engine.ts";
import {
  buildInventory,
  catalogForModelSettings,
  defaultModelSettings,
  parseModelSettings,
  readyTaskRoles,
  ROLE_CATALOG,
} from "./spec.ts";
import { autoRole, routeRole } from "./route.ts";
import type { DispatchInput } from "./types.ts";
import { validateDispatchInput } from "./validation.ts";
import { assembleVerification } from "./verify.ts";

const baseInput: DispatchInput = {
  title: "Review",
  objective: "Review this public repository",
  role: "auto",
  taggedClasses: ["public_repositories"],
  redactionVerified: false,
  authorizationGranted: false,
  requestedActions: [],
  approvedActions: [],
  contextIncludes: ["relevant_source_files"],
  targetAllowlisted: false,
  authorizationRecord: false,
  simulatePrimaryFailure: false,
  operatorAcceptedLab: false,
};

test("server validation rejects client-invented roles and actions", () => {
  assert.throws(() => validateDispatchInput({ ...baseInput, role: "admin" }), /Unsupported role/);
  assert.throws(() => validateDispatchInput({ ...baseInput, role: "critic" }), /Unsupported role/);
  assert.throws(
    () => validateDispatchInput({ ...baseInput, requestedActions: ["run_anything"] }),
    /unsupported value/,
  );
});

test("detected secrets override a cloud tag and block dispatch", () => {
  const input = {
    ...baseInput,
    objective: "Review this repo; password=hunter2",
  };
  const classification = classifyPayload(input.objective, input.taggedClasses);
  assert.equal(classification.lane, "local_only");
  const snapshot = evaluateDispatch(input, buildInventory());
  assert.equal(snapshot.canCallModel, false);
  assert.equal(snapshot.status, "blocked");
});

test("explicit authorization cannot be omitted", () => {
  const snapshot = evaluateDispatch(
    { ...baseInput, taggedClasses: ["client_private_source_code"] },
    buildInventory(),
  );
  assert.equal(snapshot.canCallModel, false);
  assert.equal(snapshot.status, "pending_authorization");
});

test("critic JSON must explicitly accept and cannot hide high findings", () => {
  assert.equal(parseCriticVerdict('{"findings":[],"accept":true,"notes":"ok"}').accepted, true);
  assert.equal(
    parseCriticVerdict(
      '{"findings":[{"severity":"high","issue":"unsafe"}],"accept":true,"notes":""}',
    ).accepted,
    false,
  );
  assert.equal(parseCriticVerdict("looks good").accepted, false);
});

test("automatic routing never uses the independent critic as the task author", () => {
  assert.equal(autoRole("Review this example helper and suggest a refactor"), "coder");
});

test("readiness requires a task primary and the critic primary", () => {
  const inventory = buildInventory();
  const withoutCritic = inventory.map((model) => ({
    ...model,
    available: model.name !== ROLE_CATALOG.critic.primary,
  }));
  assert.deepEqual(readyTaskRoles(withoutCritic), []);

  const starterModels = new Set([ROLE_CATALOG.coder.primary, ROLE_CATALOG.critic.primary]);
  const starterInventory = inventory.map((model) => ({
    ...model,
    available: starterModels.has(model.name),
  }));
  assert.deepEqual(readyTaskRoles(starterInventory), ["coder"]);
});

test("model settings accept approved choices and drive runtime routing", () => {
  const settings = {
    ...defaultModelSettings(),
    coder: "glm-5.3:cloud",
    critic: "qwen3.5:397b-cloud",
  };
  assert.deepEqual(parseModelSettings(settings), settings);
  assert.throws(
    () => parseModelSettings({ ...settings, coder: "unapproved:latest" }),
    /does not work with Coder/,
  );

  const catalog = catalogForModelSettings(settings);
  const snapshot = evaluateDispatch(
    { ...baseInput, role: "coder" },
    buildInventory([], catalog),
    catalog,
  );
  assert.equal(snapshot.route.selectedModel, "glm-5.3:cloud");
  assert.equal(catalog.critic.primary, "qwen3.5:397b-cloud");
});

test("installed local models can be selected and route local-only work locally", () => {
  const localModel = "llama3.1:8b";
  const settings = parseModelSettings(
    Object.fromEntries(Object.keys(defaultModelSettings()).map((role) => [role, localModel])),
    [localModel],
  );
  const catalog = catalogForModelSettings(settings);
  const inventory = buildInventory([], catalog);
  const localOnly = classifyPayload("Review this repo; password=hunter2", []).lane;
  const route = routeRole({
    requested: "coder",
    objective: "Review this repo",
    classification: { ...classifyPayload("Review this repo; password=hunter2", []), lane: localOnly },
    inventory,
    simulatePrimaryFailure: false,
    failClosedWhenPrimaryMissing: true,
    preventUnapprovedSubstitution: true,
    catalog,
  });
  assert.equal(route.selectedModel, localModel);
  assert.equal(route.selectedProvider, "ollama_local");
});

test("local-only work is blocked when the critic is Cloud", () => {
  const settings = { ...defaultModelSettings(), coder: "llama3.1:8b" };
  const catalog = catalogForModelSettings(settings);
  const snapshot = evaluateDispatch(
    { ...baseInput, role: "coder", objective: "Review this repo; password=hunter2" },
    buildInventory([], catalog),
    catalog,
  );
  assert.equal(snapshot.canCallModel, false);
  assert.match(snapshot.blockReason ?? "", /local Ollama task model and local critic/);
});

test("skipped checks and critic rejection both prevent acceptance", () => {
  const result = assembleVerification({
    plan: "1. Inspect\n2. Change safely",
    patch: null,
    output: '{"plan":["Inspect","Change safely"],"patch":null}',
    critic: '{"findings":[],"accept":true,"notes":"ok"}',
    criticAccepted: false,
    checks: [
      { id: "unit_tests", status: "skip", detail: "runner absent" },
      { id: "secret_scan", status: "pass", detail: "clean" },
    ],
    offensiveRequested: false,
    targetAllowlisted: false,
    operatorAcceptedLab: false,
  });
  assert.equal(result.criticAccepted, false);
  assert.equal(result.requiredChecksPassed, false);
  assert.equal(result.accepted, false);
});

test("audit redaction withholds restricted content and masks public secrets", () => {
  const publicRun = materializeRun(evaluateDispatch(baseInput, buildInventory()));
  publicRun.output = "token ghp_abcdefghijklmnopqrstuvwxyz";
  assert.doesNotMatch(redactRunForAudit(publicRun).output ?? "", /ghp_/);

  const restricted = materializeRun(
    evaluateDispatch(
      { ...baseInput, taggedClasses: ["client_private_source_code"], authorizationGranted: true },
      buildInventory(),
    ),
  );
  restricted.output = "private source";
  const safe = redactRunForAudit(restricted);
  assert.match(safe.objective, /withheld/);
  assert.equal(safe.output, null);
});
