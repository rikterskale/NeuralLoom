import assert from "node:assert/strict";
import test from "node:test";
import { registerAutomationArtifact } from "./automation.server.ts";
import { executeRemoteAction, validateRemoteActionInput } from "./remote-actions.server.ts";

test("remote action validation rejects invented operations", () => {
  assert.throws(
    () =>
      validateRemoteActionInput({
        runId: "run",
        action: "delete_repository",
        target: "https://github.com/example/project",
        expectedRevision: "abc",
        releaseTag: "",
        releaseName: "",
        confirmation: "EXECUTE APPROVED REMOTE ACTION",
      }),
    /Unsupported remote action/,
  );
});

test("pull request merge is bound to the reviewed repository and exact revision", async () => {
  const runId = crypto.randomUUID();
  await registerAutomationArtifact({
    runId,
    userId: "user-a",
    source: { kind: "url", location: "https://github.com/example/project" },
    root: null,
    revision: "abc123",
    patch: null,
    commands: [],
    approvedActions: ["pull_request_merge", "outbound_network_access"],
    targetAllowlisted: true,
    authorizationRecord: true,
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ merged: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const outcome = await executeRemoteAction(
      {
        runId,
        action: "pull_request_merge",
        target: "https://github.com/example/project/pull/7",
        expectedRevision: "abc123",
        releaseTag: "",
        releaseName: "",
        confirmation: "EXECUTE APPROVED REMOTE ACTION",
      },
      "user-a",
      {
        githubToken: "test-token",
        githubRepositories: ["example/project"],
        deployWebhookUrl: null,
        deployWebhookToken: null,
        deployTargets: [],
      },
    );
    assert.match(outcome, /confirmed pull request #7 merged/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote actions cannot target a different allowlisted repository", async () => {
  const runId = crypto.randomUUID();
  await registerAutomationArtifact({
    runId,
    userId: "user-a",
    source: { kind: "url", location: "https://github.com/example/project" },
    root: null,
    revision: "abc123",
    patch: null,
    commands: [],
    approvedActions: ["pull_request_merge", "outbound_network_access"],
    targetAllowlisted: true,
    authorizationRecord: true,
  });
  await assert.rejects(
    () =>
      executeRemoteAction(
        {
          runId,
          action: "pull_request_merge",
          target: "https://github.com/example/other/pull/7",
          expectedRevision: "abc123",
          releaseTag: "",
          releaseName: "",
          confirmation: "EXECUTE APPROVED REMOTE ACTION",
        },
        "user-a",
        {
          githubToken: "test-token",
          githubRepositories: ["example/project", "example/other"],
          deployWebhookUrl: null,
          deployWebhookToken: null,
          deployTargets: [],
        },
      ),
    /same public repository/,
  );
});

test("deployment requests require outbound approval and a configured target allowlist", async () => {
  const runId = crypto.randomUUID();
  await registerAutomationArtifact({
    runId,
    userId: "user-a",
    source: { kind: "local", location: "C:\\reviewed" },
    root: null,
    revision: "abc123",
    patch: null,
    commands: [],
    approvedActions: ["deployment_to_live_environment", "outbound_network_access"],
    targetAllowlisted: true,
    authorizationRecord: true,
  });
  const originalFetch = globalThis.fetch;
  let body = "";
  globalThis.fetch = async (_input, init) => {
    body = String(init?.body ?? "");
    return new Response("accepted", { status: 202 });
  };
  try {
    const outcome = await executeRemoteAction(
      {
        runId,
        action: "deployment_to_live_environment",
        target: "production",
        expectedRevision: "abc123",
        releaseTag: "",
        releaseName: "",
        confirmation: "EXECUTE APPROVED REMOTE ACTION",
      },
      "user-a",
      {
        githubToken: null,
        githubRepositories: [],
        deployWebhookUrl: "https://deploy.example.test/hooks/neuralloom",
        deployWebhookToken: "test-token",
        deployTargets: ["production"],
      },
    );
    assert.match(outcome, /accepted the request/);
    assert.match(body, /"target":"production"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("release publication is bound to the reviewed repository and commit", async () => {
  const runId = crypto.randomUUID();
  await registerAutomationArtifact({
    runId,
    userId: "user-a",
    source: { kind: "url", location: "https://github.com/example/project" },
    root: null,
    revision: "abc123",
    patch: null,
    commands: [],
    approvedActions: ["release_publication", "outbound_network_access"],
    targetAllowlisted: true,
    authorizationRecord: true,
  });
  const originalFetch = globalThis.fetch;
  let body = "";
  globalThis.fetch = async (_input, init) => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({ id: 17, draft: false }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const outcome = await executeRemoteAction(
      {
        runId,
        action: "release_publication",
        target: "https://github.com/example/project",
        expectedRevision: "abc123",
        releaseTag: "v1.2.3",
        releaseName: "Version 1.2.3",
        confirmation: "EXECUTE APPROVED REMOTE ACTION",
      },
      "user-a",
      {
        githubToken: "test-token",
        githubRepositories: ["example/project"],
        deployWebhookUrl: null,
        deployWebhookToken: null,
        deployTargets: [],
      },
    );
    assert.match(outcome, /confirmed release v1\.2\.3/);
    assert.match(body, /"target_commitish":"abc123"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
