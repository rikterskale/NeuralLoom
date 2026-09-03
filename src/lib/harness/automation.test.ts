import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyReviewedPatch, registerAutomationArtifact } from "./automation.server.ts";

function patch(from: string, to: string) {
  return `--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-${from}\n+${to}\n`;
}

test("reviewed patches require authorization and apply once to the recorded local tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "neuralloom-apply-"));
  const runId = crypto.randomUUID();
  await writeFile(join(root, "value.txt"), "before\n", "utf8");
  try {
    await registerAutomationArtifact({
      runId,
      userId: "user-a",
      source: { kind: "local", location: root },
      root,
      revision: null,
      patch: patch("before", "after"),
      commands: [],
      approvedActions: ["working_tree_patch"],
      targetAllowlisted: true,
      authorizationRecord: true,
    });
    await assert.rejects(
      () => applyReviewedPatch({ runId, userId: "user-a", confirmation: "yes" }),
      /Exact patch confirmation/,
    );
    await applyReviewedPatch({
      runId,
      userId: "user-a",
      confirmation: "APPLY REVIEWED PATCH",
    });
    assert.equal(await readFile(join(root, "value.txt"), "utf8"), "after\n");
    await assert.rejects(
      () => applyReviewedPatch({ runId, userId: "user-a", confirmation: "APPLY REVIEWED PATCH" }),
      /already applied/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reviewed patches fail closed when a target changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "neuralloom-stale-"));
  const runId = crypto.randomUUID();
  await writeFile(join(root, "value.txt"), "before\n", "utf8");
  try {
    await registerAutomationArtifact({
      runId,
      userId: "user-a",
      source: { kind: "local", location: root },
      root,
      revision: null,
      patch: patch("before", "after"),
      commands: [],
      approvedActions: ["working_tree_patch"],
      targetAllowlisted: true,
      authorizationRecord: true,
    });
    await writeFile(join(root, "value.txt"), "changed\n", "utf8");
    await assert.rejects(
      () => applyReviewedPatch({ runId, userId: "user-a", confirmation: "APPLY REVIEWED PATCH" }),
      /changed after review/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
