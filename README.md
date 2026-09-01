# NeuralLoom

NeuralLoom is a small safety layer in front of AI coding models. You describe a task, answer one plain-language question about the information involved, and NeuralLoom handles model selection, permission checks, review, and auditing.

You do not need to understand AI routing or “harnesses” to use it.

## Start locally

Requirements:

- Node.js 22 or newer
- [Ollama](https://ollama.com/) running on this computer
- At least the primary model for the role you want to use

```powershell
npm ci
npm run dev
```

Open `http://localhost:8080`, choose **New task**, describe the work, and select the kind of information involved. No sign-in or database setup is required for local use. Local audit data uses the embedded PGLite database and resets when the server process restarts.

The approved model names are listed in `src/lib/harness/spec.ts`. The **Models** page shows which of those models the local Ollama daemon actually discovered.

## What NeuralLoom enforces

- Every callable harness endpoint verifies the user and blocks scripted cross-site requests.
- Classification, authorization, model routing, and approvals are repeated on the server immediately before a model call.
- Credentials, tokens, private keys, and other local-only material stop the request even when the browser supplied a safer label.
- The selected Ollama model and its discovered digest are recorded. A different runtime model is rejected.
- Model fallbacks are limited to the role's configured allowlist.
- A separate critic must return valid JSON and explicitly accept the response. High-severity findings override an `accept: true` value.
- Skipped checks never count as passes. Generated commands are not executed by this web application.
- The audit record is written before a model call. Restricted task content is withheld; recognizable secret values are redacted.

## Verification status

NeuralLoom can safely run `git apply --check` without changing the workspace, plus content-based secret, security, and license checks. Formatting, type checking, tests, coverage, and dependency auditing require an isolated workspace runner that is not included yet. Those checks appear as **pending**, and the response receives `needs_acceptance` rather than `accepted`.

This is intentional: the application does not execute model-generated code or project configuration on the host while pretending it is sandboxed.

## Shared deployment

A shared deployment must set:

- `VITE_AUTH_ENABLED=true`
- `DATABASE_URL` to PostgreSQL
- the Better Auth/Grok identity variables required by the hosting environment
- `OLLAMA_BASE_URL` to the Ollama endpoint
- `OLLAMA_ALLOW_REMOTE=true` if that endpoint is not loopback

With a real database and authentication disabled, user-scoped server functions fail closed instead of sharing the local development identity.

## Quality checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` is cross-platform and includes policy, redaction, critic, authentication, environment, migration, and server-boundary regression tests. Platform-only branding fixtures from the original scaffold are not part of NeuralLoom's product test gate.

## Important boundaries

NeuralLoom does not prove that generated code is correct, provide a security sandbox, or authorize work against third-party systems. It records and enforces the controls it actually has. Any missing verification remains visible and blocks automatic acceptance.
