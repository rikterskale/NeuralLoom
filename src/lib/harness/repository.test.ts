import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  fileDigest,
  loadRepositoryConfig,
  patchPaths,
  prepareRepository,
  repositoryClonePlan,
  resolveAllowedLocalRoot,
  validatePatchTargets,
  validateRepositoryUrl,
} from "./repository.server.ts";

const exec = promisify(execFile);

test("repository URLs require HTTPS, no credentials, and an allowlisted host", () => {
  assert.equal(
    validateRepositoryUrl("https://github.com/example/project", ["github.com"]),
    "https://github.com/example/project",
  );
  assert.throws(() => validateRepositoryUrl("http://github.com/example/project", ["github.com"]), /HTTPS/);
  assert.throws(() => validateRepositoryUrl("https://user:secret@github.com/example/project", ["github.com"]), /credentials/);
  assert.throws(() => validateRepositoryUrl("https://example.test/project", ["github.com"]), /not in/);
});

test("GitHub pull request URLs resolve to an exact pull head ref", () => {
  assert.deepEqual(repositoryClonePlan("https://github.com/example/project/pull/42/files"), {
    url: "https://github.com/example/project.git",
    ref: "refs/pull/42/head",
  });
  assert.deepEqual(repositoryClonePlan("https://github.com/example/project"), {
    url: "https://github.com/example/project",
    ref: null,
  });
});

test("local repository paths stay inside configured roots", async () => {
  const allowed = await mkdtemp(join(tmpdir(), "neuralloom-allowed-"));
  const outside = await mkdtemp(join(tmpdir(), "neuralloom-outside-"));
  const child = join(allowed, "project");
  await mkdir(child);
  const config = { ...loadRepositoryConfig({}), enabled: true, roots: [allowed] };
  try {
    assert.equal(await resolveAllowedLocalRoot(child, config), child);
    await assert.rejects(() => resolveAllowedLocalRoot(outside, config), /outside/);
    await assert.rejects(() => resolveAllowedLocalRoot("relative/path", config), /absolute/);
  } finally {
    await rm(allowed, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("repository indexing is bounded and excludes secret-like files", async () => {
  const root = await mkdtemp(join(tmpdir(), "neuralloom-index-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "queue.ts"), "export function queue() { return 1; }\n", "utf8");
  await writeFile(join(root, ".env"), "PASSWORD=do-not-index\n", "utf8");
  const config = {
    ...loadRepositoryConfig({}),
    enabled: true,
    roots: [root],
    maxFiles: 10,
    maxBytes: 10_000,
  };
  try {
    const prepared = await prepareRepository(
      { kind: "local", location: root },
      "Review queue implementation",
      ["relevant_source_files"],
      false,
      config,
    );
    assert.ok(prepared);
    assert.match(prepared.context, /queue\.ts/);
    assert.doesNotMatch(prepared.context, /do-not-index/);
    assert.equal(prepared.summary.mutable, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a broken Git repository fails closed instead of scanning ignored files", async () => {
  const root = await mkdtemp(join(tmpdir(), "neuralloom-broken-git-"));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "ignored-secret.txt"), "private", "utf8");
  const config = { ...loadRepositoryConfig({}), enabled: true, roots: [root] };
  try {
    await assert.rejects(
      () =>
        prepareRepository(
          { kind: "local", location: root },
          "Review this repository",
          ["relevant_source_files"],
          false,
          config,
        ),
      /refusing a filesystem fallback/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Git indexing respects ignored files and records the reviewed revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "neuralloom-git-index-"));
  await writeFile(join(root, ".gitignore"), "ignored-secret.txt\n", "utf8");
  await writeFile(join(root, "tracked.ts"), "export const tracked = true;\n", "utf8");
  await writeFile(join(root, "ignored-secret.txt"), "password=ignored-value\n", "utf8");
  const config = { ...loadRepositoryConfig({}), enabled: true, roots: [root] };
  try {
    await exec("git", ["init", "-q"], { cwd: root });
    await exec("git", ["add", ".gitignore", "tracked.ts"], { cwd: root });
    await exec(
      "git",
      ["-c", "user.name=NeuralLoom Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"],
      { cwd: root },
    );
    const prepared = await prepareRepository(
      { kind: "local", location: root },
      "Review tracked implementation",
      ["relevant_source_files"],
      false,
      config,
    );
    assert.ok(prepared);
    assert.match(prepared.context, /tracked\.ts/);
    assert.doesNotMatch(prepared.context, /ignored-value/);
    assert.match(prepared.summary.revision ?? "", /^[a-f0-9]{40,64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("patch paths reject traversal and protected files", () => {
  assert.deepEqual(patchPaths("--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b"), ["src/a.ts"]);
  assert.throws(() => patchPaths("--- /dev/null\n+++ b/../escape.ts\n@@ -0,0 +1 @@\n+x"), /unsafe/);
  assert.throws(() => patchPaths("--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-a\n+b"), /protected/);
  assert.throws(() => patchPaths('--- "a/file name"\n+++ "b/file name"\n@@ -1 +1 @@\n-a\n+b'), /Quoted/);
  assert.throws(() => patchPaths("GIT binary patch\nliteral 0"), /Binary/);
  assert.throws(
    () => patchPaths("diff --git a/src/a.ts b/.env\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b"),
    /protected/,
  );
  assert.throws(
    () => patchPaths("diff --git a/src/a.ts b/src/b.ts\nrename from src/a.ts\nrename to src/b.ts"),
    /Rename/,
  );
  assert.throws(
    () => patchPaths("diff --git a/link b/link\nnew file mode 120000\n--- /dev/null\n+++ b/link\n@@ -0,0 +1 @@\n+outside"),
    /Symlink/,
  );
});

test("patch targets cannot traverse a symlinked parent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "neuralloom-link-root-"));
  const outside = await mkdtemp(join(tmpdir(), "neuralloom-link-outside-"));
  try {
    await writeFile(join(outside, "value.txt"), "outside", "utf8");
    try {
      await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("creating symlinks requires Windows developer mode");
        return;
      }
      throw cause;
    }
    await assert.rejects(() => validatePatchTargets(root, ["linked/value.txt"]), /symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("file digests detect target changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "neuralloom-digest-"));
  const target = join(root, "a.txt");
  try {
    await writeFile(target, "before", "utf8");
    const before = await fileDigest(root, ["a.txt"]);
    await writeFile(target, "after", "utf8");
    assert.notEqual(await fileDigest(root, ["a.txt"]), before);
    assert.equal(await readFile(target, "utf8"), "after");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
