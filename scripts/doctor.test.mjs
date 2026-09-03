import assert from "node:assert/strict";
import test from "node:test";
import {
  isLoopbackEndpoint,
  hasLocalReviewPath,
  modelNamesFromSpec,
  parseEnv,
  recommendedModel,
  rolePrimaryModelsFromSpec,
  usableTaskRoles,
} from "./doctor.mjs";

test("doctor parses local environment overrides without treating comments as values", () => {
  assert.deepEqual(parseEnv("# ignored\nOLLAMA_BASE_URL=http://localhost:11434\nEMPTY=\n"), {
    OLLAMA_BASE_URL: "http://localhost:11434",
    EMPTY: "",
  });
});

test("doctor extracts and deduplicates approved cloud model names", () => {
  assert.deepEqual(
    modelNamesFromSpec(
      'primary: "model-a:cloud", fallbacks: ["model-b:7b-cloud", "model-a:cloud"]',
    ),
    ["model-a:cloud", "model-b:7b-cloud"],
  );
});

test("doctor distinguishes local Ollama from a remote deployment", () => {
  assert.equal(isLoopbackEndpoint("http://127.0.0.1:11434"), true);
  assert.equal(isLoopbackEndpoint("http://localhost:11434"), true);
  assert.equal(isLoopbackEndpoint("https://ollama.example.com"), false);
  assert.equal(isLoopbackEndpoint("not a url"), false);
});

test("doctor recommends a faster starter model when one is approved", () => {
  assert.equal(recommendedModel(["large:cloud", "quick-flash:cloud"]), "quick-flash:cloud");
  assert.equal(recommendedModel(["large:cloud"]), "large:cloud");
});

test("doctor extracts primary models by role", () => {
  const source = `coder: { primary: "ollama/code:cloud", fallbacks: [] },
    critic: { primary: "review:cloud", fallbacks: [] },
    fast_triage: { primary: "ollama/fast:cloud", fallbacks: [] }`;
  assert.deepEqual(rolePrimaryModelsFromSpec(source), {
    coder: "code:cloud",
    critic: "review:cloud",
    fast_triage: "fast:cloud",
  });
});

test("doctor requires both a task primary and the critic primary", () => {
  const primaries = { coder: "code:cloud", critic: "review:cloud", fast_triage: "fast:cloud" };
  assert.deepEqual(usableTaskRoles(primaries, ["code:cloud"]), []);
  assert.deepEqual(usableTaskRoles(primaries, ["review:cloud"]), []);
  assert.deepEqual(usableTaskRoles(primaries, ["code:cloud", "review:cloud"]), ["coder"]);
});

test("doctor recognizes an installed local review path", () => {
  assert.equal(hasLocalReviewPath(["llama3.1:8b"]), true);
  assert.equal(hasLocalReviewPath(["gemma4:31b-cloud"]), false);
});
