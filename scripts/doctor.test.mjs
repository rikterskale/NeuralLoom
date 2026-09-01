import assert from "node:assert/strict";
import test from "node:test";
import { modelNamesFromSpec, parseEnv } from "./doctor.mjs";

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
