# NeuralLoom

NeuralLoom is a safety layer for AI-assisted software work. You describe a task and identify the information involved; NeuralLoom chooses an approved model, checks permissions, reviews the response, and keeps a privacy-aware audit record.

The web app runs locally without a NeuralLoom account or external database. Models run through **Ollama** by default — installed local models, or the recommended Ollama Cloud models with an Ollama account and an internet connection. You can also connect Claude (Anthropic), ChatGPT (OpenAI), or Grok (xAI) by adding an API key. Credentials and other local-only material are refused before any cloud model call.

Completely new to terminals and AI tools? Follow the beginner-friendly [Start Here guide](docs/START_HERE.md) — it assumes nothing and takes about 30 minutes. For the full picture, the comprehensive [Getting Started Guide](docs/GETTING_STARTED.md) covers supported use cases, a first-task walkthrough, safety guidance, and troubleshooting.

## Quick start (about 5 minutes)

### 1. Install the prerequisites

- [Node.js 22 or newer](https://nodejs.org/)
- [Ollama](https://ollama.com/download)
- An [Ollama account](https://ollama.com/) for the approved cloud models

After installing Ollama, open the app. On Linux, start the Ollama service instead.

### 2. Set up NeuralLoom

From this repository folder, run:

```text
npm run setup
```

The setup check tells you exactly what is missing. You can use an already-installed local Ollama model, or sign in for the recommended Cloud setup:

```text
ollama signin
ollama pull kimi-k2.7-code:cloud
ollama pull gemma4:31b-cloud
npm run doctor
```

Do not continue until the doctor ends with `Ready. Run: npm run dev`. Open **Models** after startup to choose a model for each role: any installed local model or any Ollama Cloud model you have pulled, alongside the recommended defaults. Local-only data is sent only to local models, including the independent critic.

### 3. Start the app

```text
npm run dev
```

Open [http://localhost:8080](http://localhost:8080), choose **Start a new task**, and follow the numbered form. Press `Ctrl+C` in the terminal to stop the app.

> First safe test: ask “Review this example code and suggest a refactoring plan,” then choose **Public or example material**. Do not paste secrets, credentials, or customer data.

## Everyday commands

| Command          | What it does                                   | When to use it               |
| ---------------- | ---------------------------------------------- | ---------------------------- |
| `npm run dev`    | Starts NeuralLoom at port 8080                 | Normal local use             |
| `npm run doctor` | Checks Node, Ollama, and approved models       | Setup or connection problems |
| `npm run check`  | Runs types, lint, and automated tests          | Before submitting a change   |
| `npm run build`  | Builds the app and applies database migrations | Production deployment        |

You do not need a `.env` file for normal local use. Copy [.env.example](.env.example) to `.env` only when you need to change a documented default.

Optional: add an `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `XAI_API_KEY` to `.env` to make Claude, ChatGPT (OpenAI), or Grok (xAI) models selectable in **Models**. These are cloud services; local-only data is still sent only to local models.

## What happens to a task

1. The server checks the information type, requested actions, and permissions.
2. It selects an approved model and verifies that exact model is available.
3. A separate AI critic reviews the response.
4. Built-in safety checks run. Checks that need an isolated workspace remain clearly marked as incomplete.
5. NeuralLoom records the decision while withholding restricted content and masking recognizable secrets.

NeuralLoom displays generated commands but never runs them.

## Troubleshooting

### “Ollama is not reachable”

Open the Ollama app, or run `ollama serve` on Linux. Then run `npm run doctor`. If the `ollama` command is unknown, install Ollama and open a new terminal.

### “No complete task-and-critic review path is available”

Run:

```text
ollama signin
ollama pull kimi-k2.7-code:cloud
ollama pull gemma4:31b-cloud
npm run doctor
```

### Port 8080 is already in use

Stop the other program using port 8080, then run `npm run dev` again. NeuralLoom intentionally uses a fixed local port.

### A task was stopped or needs approval

Open **Audit** in the app and select the task. The event list explains the policy decision. Credentials and unredacted evidence are intentionally local-only and cannot be sent to a cloud model.

If these steps do not help, include your operating system, Node version (`node --version`), and the output of `npm run doctor` in a bug report. Remove tokens, credentials, and private data first.

## Data storage and limitations

Local audit data uses an embedded in-memory PGLite database and resets when the server process restarts. NeuralLoom does not prove generated code is correct. Formatting, type checking, tests, coverage, and dependency auditing that require an isolated workspace stay incomplete rather than being reported as passed, unless you enable the optional workspace runner. That runner snapshots a workspace you designate into a disposable copy, applies the model's patch there only (never to your working tree), and runs the check commands you configure with a secret-scrubbed environment; it isolates by file copy, environment scrubbing, and timeouts, not by kernel-level confinement. See the [Getting Started Guide](docs/GETTING_STARTED.md) and [.env.example](.env.example) for setup.

## Shared deployment

A shared deployment must set:

- `VITE_AUTH_ENABLED=true`
- `DATABASE_URL` to PostgreSQL
- the Better Auth/Grok identity variables required by the hosting environment
- `OLLAMA_BASE_URL` to the Ollama endpoint
- `OLLAMA_ALLOW_REMOTE=true` when that endpoint is not loopback

With a real database and authentication disabled, user-scoped server functions fail closed rather than sharing a development identity. Use HTTPS and the deployment platform’s secret manager; never commit `.env`.

## Security reports

See [SECURITY.md](SECURITY.md) for the private reporting process. Do not open a public issue for a suspected vulnerability.
