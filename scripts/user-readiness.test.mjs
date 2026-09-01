import assert from "node:assert/strict";
import test from "node:test";
import { domAuditIssues, isIgnorableRequestFailure, readinessExitCode } from "./user-readiness.ts";

const healthyAudit = {
  title: "NeuralLoom",
  h1Count: 1,
  hasMain: true,
  duplicateIds: [],
  unnamedControls: [],
  imagesWithoutAlt: 0,
  horizontalOverflow: false,
};

test("DOM readiness reports every user-visible accessibility failure", () => {
  assert.deepEqual(domAuditIssues(healthyAudit), []);
  const issues = domAuditIssues({
    ...healthyAudit,
    title: "",
    h1Count: 2,
    hasMain: false,
    duplicateIds: ["objective"],
    unnamedControls: ["button"],
    imagesWithoutAlt: 1,
    horizontalOverflow: true,
  });
  assert.equal(issues.length, 7);
  assert.ok(issues.some((issue) => issue.includes("accessible names")));
  assert.ok(issues.some((issue) => issue.includes("horizontal overflow")));
});

test("request failure filtering ignores only expected browser cancellations", () => {
  assert.equal(isIgnorableRequestFailure("websocket", "socket closed"), true);
  assert.equal(isIgnorableRequestFailure("document", "net::ERR_ABORTED"), true);
  assert.equal(isIgnorableRequestFailure("fetch", "net::ERR_CONNECTION_REFUSED"), false);
});

test("readiness exits successfully only when every check passed", () => {
  assert.equal(readinessExitCode([]), 1);
  assert.equal(readinessExitCode([{ name: "routes", status: "passed", durationMs: 1 }]), 0);
  assert.equal(
    readinessExitCode([
      { name: "routes", status: "passed", durationMs: 1 },
      { name: "models", status: "failed", durationMs: 1, error: "not ready" },
    ]),
    1,
  );
});
