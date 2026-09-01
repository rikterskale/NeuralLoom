# NeuralLoom

NeuralLoom is a safety layer for AI-assisted software work. Describe a task, choose the kind of information involved, and NeuralLoom handles permissions, approved-model selection, independent review, and a privacy-aware audit trail.

No AI routing knowledge, account, or external database is required for local use.

## Quick start

You need [Node.js 22+](https://nodejs.org/) and [Ollama](https://ollama.com/).

```powershell
npm run setup
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) and select **New task**.

`npm run setup` installs exact locked dependencies and checks Node, Ollama, and approved model availability. If setup reports that a model is missing, follow its suggested `ollama pull` command and rerun `npm run doctor`.

### Everyday commands

| Command          | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `npm run dev`    | Start NeuralLoom locally                       |
| `npm run doctor` | Diagnose setup and model problems              |
| `npm run check`  | Run type, lint, and test quality gates         |
| `npm run build`  | Create a production build and apply migrations |

Local use is sign-in free. Audit data uses embedded PGLite and resets when the server process restarts. Configuration defaults are documented in [.env.example](.env.example); copy it to `.env` only when you need to override them.

## How a task is handled

1. The server independently validates the task, information class, permissions, and requested actions.
2. It selects an approved model and verifies that exact model is available in Ollama.
3. A separate critic reviews the response.
4. Deterministic checks run where safely supported. Missing checks remain visible and prevent automatic acceptance.
5. The decision is recorded before any model call. Restricted content is withheld and recognizable secrets are redacted.

Generated commands are never executed by this web application.

## Troubleshooting

- **“Ollama is not reachable”** — open the Ollama app/service, then select **Check again** or run `npm run doctor`.
- **“No approved model is available”** — run the `ollama pull ...` command shown by the doctor, then refresh the **Models** page.
- **Port 8080 is busy** — stop the other process using it; the fixed port is part of the local preview contract.
- **A task is safely stopped** — open **Audit** for the exact policy reason. Private credentials and unredacted evidence are intentionally local-only.

## Shared deployment

A shared deployment must set:

- `VITE_AUTH_ENABLED=true`
- `DATABASE_URL` to PostgreSQL
- the Better Auth/Grok identity variables required by the hosting environment
- `OLLAMA_BASE_URL` to the Ollama endpoint
- `OLLAMA_ALLOW_REMOTE=true` when that endpoint is not loopback

With a real database and authentication disabled, user-scoped server functions fail closed rather than sharing a development identity. Use HTTPS and manage secrets in the deployment platform; never commit `.env`.

## Security boundaries

NeuralLoom does not prove generated code is correct, provide a host execution sandbox, or authorize work against third-party systems. It reports the controls it actually completed. Formatting, type checking, tests, coverage, and dependency auditing require an isolated workspace runner that is not included yet; those checks stay pending rather than being treated as passes.

To report a vulnerability, use a private security channel for the repository owner rather than a public issue, and include reproduction steps without live credentials or customer data.
