import assert from "node:assert/strict";
import test from "node:test";
import { redactRunForAudit } from "./audit-redaction.ts";
import { classifyPayload } from "./classify.ts";
import { parseCriticVerdict } from "./critic.ts";
import { evaluateDispatch, materializeRun } from "./engine.ts";
import { buildInventory } from "./spec.ts";
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
