import assert from "node:assert/strict";
import test from "node:test";
import {
  isLoopbackEndpoint,
  modelNamesFromSpec,
  parseEnv,
  recommendedModel,
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
