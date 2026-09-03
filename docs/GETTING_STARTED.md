# Getting started with NeuralLoom

This guide takes you from a new checkout to your first reviewed AI task. It assumes you are comfortable opening a terminal, but it does not assume you know Node.js, Ollama, AI model routing, or software security terminology.

## Contents

1. [What NeuralLoom is](#what-neuralloom-is)
2. [What you can do with NeuralLoom](#what-you-can-do-with-neuralloom)
3. [What NeuralLoom does not do yet](#what-neuralloom-does-not-do-yet)
4. [How NeuralLoom protects your work](#how-neuralloom-protects-your-work)
5. [Before you install](#before-you-install)
6. [Install and set up NeuralLoom](#install-and-set-up-neuralloom)
7. [Complete your first task](#complete-your-first-task)
8. [Choose the correct information type](#choose-the-correct-information-type)
9. [Use advanced options](#use-advanced-options)
10. [Understand the result](#understand-the-result)
11. [Navigate the application](#navigate-the-application)
12. [Suggested tasks to try](#suggested-tasks-to-try)
13. [A safe everyday workflow](#a-safe-everyday-workflow)
14. [Configuration](#configuration)
15. [Troubleshooting](#troubleshooting)
16. [Frequently asked questions](#frequently-asked-questions)
17. [Glossary](#glossary)

## What NeuralLoom is

NeuralLoom is a local web application that adds safety checks around AI-assisted software work. You describe what you want help with and identify the kind of information involved. NeuralLoom then:

1. checks whether the information is allowed to reach an AI model;
2. checks whether any requested action needs human approval;
3. chooses an approved AI model for the task;
4. verifies that the exact model is available through Ollama;
5. asks the model for a structured response;
6. sends the response to a separate critic model for review;
7. runs the safety checks that are available; and
8. records the decision in a privacy-aware audit log.

You use NeuralLoom in a browser, but the application server and Ollama connection run from your computer by default. The approved models in the current configuration are Ollama Cloud models. Completing an AI task therefore requires an Ollama account and an internet connection.

NeuralLoom is designed to fail closed. If it cannot confidently classify the information, verify an approved model, or satisfy a required permission, it stops the task instead of quietly bypassing the control.

## What you can do with NeuralLoom

### Plan software changes

Ask for an implementation plan before changing code. NeuralLoom can help break a feature or bug fix into steps, identify likely components, consider dependencies, and call out security or testing concerns.

Example:

> Plan how to add rate limiting to a public example API. Include configuration, tests, error responses, and rollout risks.

### Draft code changes and tests

Ask for a proposed patch, refactoring approach, test cases, CLI behavior, API design, infrastructure code, or security tooling. The coding role is instructed to return patch-oriented work rather than silently replacing entire files.

Example:

> Propose a unified diff that extracts duplicated retry logic into a helper and adds unit tests. The example is from a public repository.

NeuralLoom displays proposed code and commands. You remain responsible for reviewing and applying them.

### Triage sanitized failures

Use the fast-triage role to summarize sanitized CI errors, classify a problem, suggest which files to inspect first, or decide whether a deeper repository review is appropriate.

Example:

> Triage this sanitized CI message: type checking failed in packages/core/src/queue.ts on line 88. Explain the likely causes and the first three checks to make.

Sanitize logs before submitting them. Remove tokens, session identifiers, customer details, internal hostnames, and other sensitive values.

### Review architecture and requirements

Use the planner role for requirements analysis, system architecture, threat modeling, cross-component debugging, and implementation sequencing.

Example:

> Review this public design summary for a webhook service. Identify trust boundaries, failure modes, and decisions that should be recorded before implementation.

### Map the likely impact of repository changes

Use the repository role for symbol and dependency reasoning, cross-file impact analysis, documentation traceability, and large-refactor planning.

Example:

> Based on this public package description and dependency summary, identify the modules likely affected by replacing the caching interface. Produce a migration checklist.

The current application does not automatically read your repository. Include only the safe, relevant context in the task description, and do not assume NeuralLoom has seen files you did not provide.

### Perform defensive security review

Use the security-specialist role to reason about vulnerability reports, secure code patterns, exploitability prerequisites, mitigations, detection ideas, or synthetic laboratory proofs of concept.

Example:

> Review this made-up authentication flow for session-fixation risks. Explain prerequisites, mitigations, and regression tests. Use only the synthetic details in this prompt.

Only test systems you own or are explicitly authorized to test. Some security-related actions require approval, an allowlisted target, and an authorization record.

### Explore NeuralLoom's safety decisions

Use the **Safety**, **Checks**, **Models**, and **Audit** pages to understand:

- which information may use a cloud model;
- which information requires explicit authorization;
- which information is always local-only;
- why a task was blocked or paused;
- which model NeuralLoom intended to use;
- whether a fallback model was selected;
- what the critic concluded; and
- which checks passed, failed, or could not run.

### Record a safe refusal

If you identify credentials or live evidence, NeuralLoom can record that the task was refused before any cloud model call. This gives you an auditable safety decision without sending the restricted content onward.

## What NeuralLoom does not do yet

Understanding these boundaries prevents unsafe assumptions.

NeuralLoom currently does **not**:

- automatically open, index, or modify the repository on your computer;
- automatically fetch a repository from a URL mentioned in a task;
- apply a generated patch to your working tree (a patch is applied only inside a disposable sandbox snapshot when the optional workspace runner is enabled — see below — never to the repository you work in);
- run generated shell commands (the sandbox runs only the check commands _you_ configure, never commands produced by a model);
- deploy software, merge pull requests, or publish releases;
- provide an operating-system or network jail (the optional runner isolates by disposable file copy, a secret-scrubbed environment, and time limits, not by kernel-level confinement);
- run workspace-dependent formatting, linting, type checking, tests, coverage, or dependency auditing unless you enable and configure the optional workspace runner below;
- guarantee that AI-generated code is correct or secure;
- replace code review, testing, change management, or professional security judgment;
- make restricted information safe merely because you selected a less-sensitive label; or
- authorize work against a third-party system.

Checks that require an isolated workspace runner remain visibly incomplete. NeuralLoom does not count a missing check as a pass.

### Optional: the isolated workspace runner

By default the workspace-dependent checks (formatter, linter, type checker, unit and integration tests, coverage, dependency audit) report as **skip** — never as a pass — because no runner is attached. You can attach one deliberately. When enabled, NeuralLoom:

1. copies a workspace you designate into a fresh temporary directory, so your real working tree is never opened or modified;
2. applies the model's proposed patch **inside that copy only**;
3. runs the exact check commands you configured, each with a timeout and captured output; and
4. builds the child environment from a short allowlist, withholding API keys, tokens, `DATABASE_URL`, the Ollama endpoint, and anything whose value looks like a secret — so a generated patch cannot read or send your credentials.

A check with no configured command stays `skip`. A patch that fails to apply, a command that exits non-zero, or a command that times out is a `fail`. Acceptance still requires every required check to pass, so an unattached or partly-configured runner can never turn a run green on its own.

Enable it with environment variables (see [.env.example](../.env.example)):

```text
NEURALLOOM_SANDBOX_ENABLED=true
NEURALLOOM_SANDBOX_WORKSPACE=/absolute/path/to/a/prepared/workspace
NEURALLOOM_SANDBOX_CMD_LINTER=npm run lint
NEURALLOOM_SANDBOX_CMD_TYPE_CHECKER=npm run typecheck
NEURALLOOM_SANDBOX_CMD_UNIT_TESTS=npm test
```

Because the snapshot excludes `node_modules` and `.git` by default, point `NEURALLOOM_SANDBOX_WORKSPACE` at a workspace whose dependencies are already installed, or make a command install them (for example `npm ci && npm test`). Adjust the copy exclusions with `NEURALLOOM_SANDBOX_COPY_IGNORE`.

## How NeuralLoom protects your work

### Information is classified before a model call

The server validates the information type instead of trusting the browser alone. Recognizable secrets can override a less-sensitive selection and stop the task.

### Unknown information is blocked

If NeuralLoom cannot classify the material, its default action is to deny the model call.

### Local-only information cannot fall back to cloud

Credentials, raw authentication artifacts, unredacted logs, target lists, packet captures, and live engagement evidence cannot be sent to an approved cloud fallback.

### Model substitution is controlled

NeuralLoom maintains an approved model list. It checks the model reported by the runtime and rejects an unexpected substitution.

### A separate critic reviews the response

The critic checks correctness, security, architecture, documentation, hallucination risk, and test gaps. A response is not accepted merely because the first model produced an answer.

### Commands are display-only

Models may propose code, patches, or commands. The web application does not execute them.

### Audit records minimize restricted content

The audit record stores decisions and verification details. Restricted task content is withheld, and recognizable secret patterns are masked. For local development, audit data resets when the server process stops.

## Before you install

You need:

- a computer running Windows, macOS, or Linux;
- permission to install software on that computer;
- [Node.js 22 or newer](https://nodejs.org/);
- [Ollama](https://ollama.com/download);
- an Ollama account for the configured cloud models;
- an internet connection for Ollama Cloud; and
- a local copy of this repository.

You do not need a NeuralLoom account or an external database for normal local use.

### What is a terminal?

A terminal is a text-based application used to run commands.

- On Windows, open **PowerShell** or **Windows Terminal**.
- On macOS, open **Terminal** from Applications > Utilities.
- On Linux, open your distribution's terminal application.

Run commands one line at a time and press Enter after each line. Do not include the surrounding code-block marks from this guide.

### Open the repository folder

Your terminal must be in the folder containing `package.json`. If you downloaded or cloned NeuralLoom somewhere else, change to that folder first:

```text
cd path/to/NeuralLoom
```

To confirm that you are in the correct folder:

- PowerShell: run `Get-ChildItem package.json`
- macOS or Linux: run `ls package.json`

If the command shows `package.json`, continue.

## Install and set up NeuralLoom

### Step 1: Verify Node.js

Run:

```text
node --version
npm --version
```

The Node.js result must begin with `v22` or a larger number. For example, `v24.1.0` is supported. If `node` or `npm` is not recognized, install the current Node.js LTS release, close the terminal, and open a new terminal.

### Step 2: Install and open Ollama

Download Ollama from [ollama.com/download](https://ollama.com/download).

- On Windows or macOS, install and open the Ollama application. It normally runs in the background.
- On Linux, follow Ollama's installation instructions and start its service. You can also run `ollama serve` in a dedicated terminal.

Open a new terminal and run:

```text
ollama --version
```

If the command is not recognized, restart your terminal after installation. If it is still unavailable, reinstall Ollama and ensure its command-line tool is on your system path.

### Step 3: Install NeuralLoom's dependencies

From the NeuralLoom repository folder, run:

```text
npm run setup
```

This installs the exact dependency versions recorded in `package-lock.json` and runs NeuralLoom's setup doctor.

It is normal for the first setup check to say that no approved model is available. Continue with the instructions it prints.

### Step 4: Sign in to Ollama

Run:

```text
ollama signin
```

Follow the prompts to sign in or create an Ollama account. NeuralLoom itself does not receive your Ollama password.

### Step 5: Add the recommended starter models

Run:

```text
ollama pull kimi-k2.7-code:cloud
ollama pull gemma4:31b-cloud
```

The first model handles the coding task in this walkthrough. The second is the independent critic required to review its response. A task is ready only when both its role's primary model and the critic primary are available. The **Models** page shows which complete review paths are ready.

### Step 6: Verify the complete setup

Run:

```text
npm run doctor
```

A ready system ends with:

```text
Ready. Run: npm run dev
```

Do not ignore a failed doctor check. Read the suggested action, complete it, and run the doctor again.

### Step 7: Start NeuralLoom

Run:

```text
npm run dev
```

Wait for the terminal to show a local address, normally:

```text
http://localhost:8080/
```

Open [http://localhost:8080](http://localhost:8080) in your browser. Keep the terminal open while using the application.

### Step 8: Stop NeuralLoom

Return to the terminal running NeuralLoom and press `Ctrl+C`. Closing this server ends the local session and clears the in-memory local audit history.

## Complete your first task

Use public or invented information for the first walkthrough.

### 1. Open the task form

On the home page, select **Start a new task**. The **New task** page opens.

If you see **A complete AI review path is not ready yet**, open the **Models** page and follow its three setup steps. Do not continue until it reports at least one task role ready.

### 2. Describe the task

In **What should the AI do?**, enter:

```text
Review this made-up JavaScript helper and suggest a safe refactoring plan. Explain which unit tests should be added. Do not execute commands or assume access to other files.

function fullName(user) {
  return user.first + " " + user.last;
}
```

This example is deliberately small, public-style, and free of secrets.

Good task descriptions usually include:

- the desired outcome;
- the relevant language or framework;
- important constraints;
- the output you want, such as a plan, review, or unified diff;
- the tests you expect; and
- anything the model must not do.

Do not claim that a file or repository is available unless you included the necessary safe context in the task.

### 3. Add a short name

Enter `First refactoring review` in **Short name**. This field is optional, but a useful name makes the audit log easier to scan.

### 4. Select the information type

Choose **Public or example material** because the code is invented for this walkthrough.

Do not choose a less-sensitive type merely to make the submit button available. The server performs its own checks and may block the task.

### 5. Leave advanced options closed

NeuralLoom can choose the role automatically. Advanced options are explained later in this guide.

### 6. Submit the task

Select **Review this task**. While NeuralLoom is working, leave the page open.

NeuralLoom checks the information, chooses an approved role and model, requests the response, runs critic review, and displays the result.

### 7. Review the result

Read the status and explanation before using any output. Treat generated code as a proposal, not as an approved change.

Check for:

- a clear plan;
- assumptions that match your task;
- a patch rather than an unexplained full-file replacement;
- test coverage suggestions;
- critic or verification warnings; and
- incomplete workspace checks.

### 8. Inspect the audit record

Open **Audit**, select `First refactoring review`, and inspect the event list. You can see the classification, route, model identity, critic activity, and final decision.

## Choose the correct information type

The information choice controls whether a cloud model call is allowed. When uncertain, stop and ask your organization or data owner. Do not guess.

| Choice in the task form          | Use it for                                                                                                                      | Do not use it for                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Public or example material**   | Open-source code, public documentation, published vulnerability information, invented examples, and synthetic test data         | Private repositories, internal design documents, customer details, credentials, or unredacted logs |
| **My own private project**       | A private project you own that contains no employer, client, customer, or restricted information                                | Company-owned work, client code, third-party confidential material, or secrets                     |
| **Company or client material**   | Private source, architecture, findings, or assessments that you are explicitly authorized to send to the configured AI provider | Anything you are not authorized to disclose, or any local-only credential/evidence category        |
| **Credentials or live evidence** | Passwords, tokens, private keys, session data, raw evidence, or unredacted logs that must be stopped locally                    | Any task you expect NeuralLoom to send to a cloud model                                            |

### Public or example material

This is the simplest lane. NeuralLoom may send the task to an approved cloud model after server-side validation.

Still remove accidental secrets. Public source code can contain a committed token, personal email address, or private endpoint.

### Your own private project

Use this only when you own the material and it contains no client or employer information. An unpublished personal application can fit this category; a side project containing copied company code cannot.

### Company or client material

This selection displays an authorization confirmation. Check it only if you are permitted to send the material to the configured AI provider.

Authorization should come from the appropriate contract, engagement scope, employer policy, client approval, or data owner. Being able to access information does not necessarily mean you may disclose it to an AI service.

### Credentials or live evidence

This lane includes:

- usernames and passwords;
- password hashes;
- Kerberos tickets;
- access tokens;
- session cookies;
- private keys;
- certificates and PFX files;
- API keys and other secrets;
- BloodHound collections;
- raw Active Directory exports;
- raw packet captures;
- unredacted logs or screenshots;
- client target lists; and
- live engagement evidence.

NeuralLoom refuses these tasks before a cloud call. Do not paste a real secret merely to test the refusal. Use invented data for demonstrations and tests.

## Use advanced options

Most first-time users should leave advanced options at their defaults. Open them when you understand the task's required role, actions, and context.

### Specialist role

**Automatic** lets NeuralLoom choose a role. This is the recommended default.

| Role                    | Best for                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Planner**             | Requirements, architecture, threat models, implementation plans, and cross-component debugging                           |
| **Coder**               | Proposed patches, refactors, tests, CLIs, APIs, infrastructure code, and security tooling                                |
| **Repo agent**          | Repository mapping, dependency impact, large refactors, issue resolution, and documentation traceability                 |
| **Security specialist** | Defensive review, vulnerability reasoning, exploitability prerequisites, synthetic lab proofs, detection, and mitigation |
| **Fast triage**         | Classifying failures, summarizing sanitized logs, selecting likely files, and answering simple code questions            |

The **Critic** is used independently by the review pipeline and is not offered as the primary task role.

Choosing a role does not bypass information or approval policies.

### Actions the answer may discuss

Some actions carry additional risk and require human approval. Examples include:

- outbound network access;
- exploit execution;
- credential operations;
- authentication testing;
- persistence or lateral-movement testing;
- destructive actions;
- changes outside the workspace;
- deployment to a live environment;
- merging a pull request; and
- publishing a release.

Mark an action as requested only when it is genuinely part of the task. Mark it approved only when the appropriate person has authorized it. NeuralLoom can still refuse an unsafe or out-of-scope request.

For network, exploitation, credential, authentication, persistence, lateral-movement, or live-deployment work, NeuralLoom also expects target controls such as an allowlist and an authorization record.

The application does not execute these actions. The controls govern what the generated response may discuss and how the decision is recorded.

### Context to use

Context choices describe the types of material relevant to the task:

- repository manifest;
- symbol index;
- dependency graph;
- relevant source files;
- relevant tests;
- configuration files;
- recent diffs; and
- applicable documentation.

These selections do not automatically grant NeuralLoom access to files. In the current build, NeuralLoom does not crawl your repository. They communicate the intended scope to the routing and policy layer.

Build artifacts, vendor dependency directories, binary files, secrets, and unrelated large files are excluded by default.

## Understand the result

### Status meanings

| Status                  | Meaning                                                                                | What you should do                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Accepted**            | The response and all required available checks passed                                  | Review the content yourself before using it                                            |
| **Needs acceptance**    | The response was reviewed, but required workspace checks are unavailable or incomplete | Run the missing checks in a suitable isolated workspace and review the result          |
| **Needs authorization** | Company or client material lacks the required authorization confirmation               | Confirm authorization only if you truly have it; otherwise remove the material         |
| **Needs approval**      | A requested high-risk action has not been approved                                     | Obtain appropriate approval or remove the action                                       |
| **Blocked**             | Policy stopped the task before a permitted model call                                  | Read the latest event and correct the information or scope; do not bypass the block    |
| **Rejected**            | Review or verification found the response unacceptable                                 | Read critic and check details, then revise the task                                    |
| **Failed**              | A model, network, validation, or application operation failed safely                   | Check model readiness, retry once, and use the troubleshooting section if it continues |

### Plan

The plan explains the proposed approach. Confirm that it matches your objective and does not invent unavailable files, requirements, or permissions.

### Patch or output

Treat all generated content as untrusted input. Read every line before copying it into a repository. Never run a generated command merely because it appears in an accepted response.

### Critic

The critic is an independent model review, not a guarantee. Pay attention to correctness, security, architecture, hallucination, documentation, and test-gap findings.

### Checks

A check can pass, fail, or remain incomplete. In the current build, checks that require an isolated repository workspace cannot run automatically. Perform those checks through your normal development workflow before accepting a change.

## Navigate the application

### Home

Shows model readiness, core safety posture, review roles, recent tasks, and a shortcut to start a task.

### New task

Contains the numbered task form, information classification, authorization confirmation, advanced routing options, and the current result.

### AI roles

Lists each specialist, its responsibilities, approved primary model, fallback chain, reasoning level, and response randomness limit.

### Safety

Shows the cloud-permitted, authorization-required, and local-only information lanes. It also displays routing, execution, approval, and target controls.

### Checks

Explains the plan, patch, critic, deterministic-check, and authorized-lab stages. Use it to understand why some tasks remain incomplete.

### Models

Shows live Ollama availability, approved models, model identity information, and the roles that use each model. When setup is incomplete, this page provides a three-step recovery guide.

### Audit

Lists task records and their statuses. Select a record to view routing, model, token, event, plan, patch, and critic details that are safe to retain.

**Clear log** removes every record in the current session after confirmation. This cannot be undone.

## Suggested tasks to try

Use only invented, public, sanitized, or properly authorized information.

### Implementation planning

```text
Create an implementation plan for adding cursor-based pagination to a public example REST API. Include compatibility concerns, validation, tests, documentation, and rollout steps.
```

Select **Public or example material** and use **Automatic** or **Planner**.

### Refactoring proposal

```text
Propose a unified diff for this invented TypeScript helper that removes duplicated validation. Add unit-test cases for empty, malformed, and valid input. Do not use external packages.
```

Select **Public or example material** and use **Coder**.

### Sanitized CI triage

```text
Triage this sanitized CI failure: TypeScript reports that string | undefined cannot be assigned to string in src/queue.ts line 88. List likely causes and the first files or tests to inspect. No repository files are attached.
```

Select **Public or example material** and use **Fast triage**.

### Architecture review

```text
Review this invented architecture: a public webhook receiver writes events to a queue, a worker retries delivery, and an admin API exposes delivery history. Identify trust boundaries, failure modes, and observability requirements.
```

Select **Public or example material** and use **Planner**.

### Defensive security review

```text
Review this synthetic password-reset flow for account-takeover risks. Explain prerequisites, mitigations, logging, and regression tests. Do not produce instructions for targeting a real service.
```

Select **Public or example material** and use **Security specialist**.

### Safe-refusal demonstration

Describe an invented task that explicitly says it contains a fake API key, then choose **Credentials or live evidence**. NeuralLoom should record a refusal without calling a cloud model. Never use a real key for this demonstration.

## A safe everyday workflow

1. Start Ollama.
2. Open a terminal in the NeuralLoom folder.
3. Run `npm run doctor` if the environment has changed or a previous model check failed.
4. Run `npm run dev`.
5. Open [http://localhost:8080](http://localhost:8080).
6. Minimize the context you plan to provide.
7. Remove credentials, customer data, and unrelated material.
8. Describe one concrete task.
9. Choose the truthful information type.
10. Leave role selection automatic unless you have a reason to override it.
11. Declare high-risk actions and approvals accurately.
12. Read the status, critic feedback, and check results.
13. Review proposed code manually.
14. Apply changes through your normal development tools.
15. Run your repository's formatter, linter, type checker, tests, security scan, and dependency audit in an appropriate environment.
16. Commit only changes you understand.
17. Stop NeuralLoom with `Ctrl+C` when finished.

## Configuration

Normal local use requires no `.env` file. Defaults are documented in [.env.example](../.env.example).

### Change a local default

Copy `.env.example` to `.env`, then edit only the setting you need. The `.env` file is excluded from Git.

Available settings include:

- `OLLAMA_BASE_URL`: the Ollama API endpoint; defaults to `http://127.0.0.1:11434`.
- `OLLAMA_ALLOW_REMOTE`: must be `true` only when you intentionally use a non-loopback Ollama endpoint.
- `VITE_AUTH_ENABLED`: remains `false` for normal single-user local use; shared deployments must enable authentication.
- `DATABASE_URL`: optional for local use; required for the supported PostgreSQL shared-deployment path.
- `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET`: deployment authentication settings, not normal local setup values.

Do not place a credential in `.env.example`, source code, documentation, screenshots, or bug reports.

### Shared deployments

Shared deployments require authentication, PostgreSQL, HTTPS, managed secrets, and a deliberately configured Ollama endpoint. The local development identity and in-memory database are not a production multi-user configuration. See the [README](../README.md#shared-deployment) for the required environment variables.

## Troubleshooting

Start with:

```text
npm run doctor
```

The doctor is the authoritative first check for Node.js, dependencies, the Ollama endpoint, and approved model availability.

### `node` or `npm` is not recognized

Install Node.js 22 or newer. Close every terminal window, open a new terminal, return to the NeuralLoom folder, and run `node --version` again.

### `npm run setup` fails while installing dependencies

1. Confirm you are in the folder containing `package.json`.
2. Confirm that your internet connection can reach the npm registry.
3. Read the first error in the terminal, not only the final summary.
4. Run `npm run setup` again after correcting the reported problem.

Avoid deleting lockfiles or changing dependency versions as a first troubleshooting step.

### `ollama` is not recognized

Install Ollama, open a new terminal, and run `ollama --version`. On Windows and macOS, ensure the Ollama application has been opened at least once.

### Ollama is not reachable

- Windows or macOS: open the Ollama application and wait a few seconds.
- Linux: start the Ollama service or run `ollama serve` in another terminal.
- Custom endpoint: verify `OLLAMA_BASE_URL`, network access, and the service on the remote host.

Then run:

```text
npm run doctor
```

### No complete task-and-critic review path is available

Run:

```text
ollama signin
ollama pull kimi-k2.7-code:cloud
ollama pull gemma4:31b-cloud
npm run doctor
```

If sign-in succeeds but pulling fails, read the Ollama error and verify your account and internet connection.

### The Models page still shows old information

Select **Check again**. If it still fails, run `npm run doctor` in the terminal and address the reported problem. Restart `npm run dev` after changing `.env`.

### Port 8080 is already in use

Another application is listening on NeuralLoom's fixed development port. Stop the other application or an older NeuralLoom process, then run `npm run dev` again.

### The submit button is disabled

Read the message directly below the button. Common causes are:

- the task description is shorter than eight characters;
- no information type is selected;
- company or client authorization is not confirmed;
- Ollama is unavailable; or
- the selected task role's primary model or the critic primary model is not installed.

A credentials or live-evidence task can still record a safe refusal without a model.

### A task is blocked

Open **Audit**, select the task, and read the most recent event. Correct the information type, remove restricted material, obtain genuine authorization, or reduce the requested scope. Do not try to disguise restricted information to bypass classification.

### A task needs acceptance

This commonly means repository-dependent checks could not run because no isolated workspace runner is connected. Review the listed checks and run them in your normal trusted development environment.

### A task fails after model selection

1. Open **Models** and select **Check again**.
2. Run `npm run doctor`.
3. Confirm Ollama remains signed in and online.
4. Retry the task once.
5. If it continues, open **Audit** and collect the non-sensitive event details for a bug report.

### The page says something went wrong

Select **Try again**. During local development, expand **Technical details** if available. Run `npm run doctor`, then restart the development server.

### The browser cannot open localhost

Confirm the terminal running `npm run dev` is still open and shows `http://localhost:8080`. If the process stopped, read its final error and restart it after correcting the problem.

### I need to report a bug

Include:

- your operating system;
- `node --version`;
- the output of `npm run doctor`;
- the page and action involved;
- the expected and actual behavior; and
- minimal reproduction steps using non-sensitive test data.

Remove credentials, private source, customer information, internal URLs, and live evidence. Report suspected security vulnerabilities privately according to [SECURITY.md](../SECURITY.md).

## Frequently asked questions

### Does NeuralLoom run entirely offline?

No. The application server and Ollama transport run locally by default, but the currently approved models are Ollama Cloud models. AI tasks require an Ollama account and internet access.

### Does NeuralLoom upload my whole repository?

No. The current build does not automatically read or upload your repository. It sends the permitted task content used by the harness. You should still minimize and sanitize everything you enter.

### Can NeuralLoom edit my files?

No. It can propose code or a patch, but it does not apply changes to your workspace.

### Can NeuralLoom run commands?

No. Generated commands are display-only.

### Can I paste a token if I choose the credentials option?

Do not paste a real token. The credentials option exists to record a safe refusal, not to process the credential with a cloud model.

### Why does NeuralLoom need a separate critic model?

The critic gives the first response an independent review for correctness, security, architecture, hallucination risk, documentation, and missing tests. It reduces risk but does not replace human review.

### Why is an apparently good response marked Needs acceptance?

Some required checks need an isolated repository workspace, which the current application does not provide. NeuralLoom reports those checks as incomplete rather than pretending they passed.

### Can I use private personal code?

Yes, when you own it and it contains no employer, client, customer, credential, or other restricted information. Select **My own private project** and provide only the minimum relevant context.

### Can I use company or client code?

Only when you have explicit authorization to send it to the configured AI provider. Select **Company or client material** and confirm authorization truthfully. Credentials and live evidence remain local-only even when other project material is authorized.

### Where is local audit data stored?

Local development uses embedded in-memory PGLite. Audit history resets when the server process stops. Shared deployments use the configured PostgreSQL database.

### Do I need to create a `.env` file?

No, not for normal local use. Create one only to override a documented default.

### Which models should I install first?

Install `kimi-k2.7-code:cloud` and `gemma4:31b-cloud`. Together they provide the coding role and its required independent critic for the first walkthrough. The **Models** page shows the complete approved inventory and which task roles are ready.

### How do I update NeuralLoom?

After obtaining the latest repository changes through your normal Git workflow, run `npm run setup` again. Review release or repository notes before updating a production deployment.

### How do I verify a code change to NeuralLoom itself?

Run:

```text
npm run check
npm run build
```

The first command runs type checking, linting, and automated tests. The second creates a production build and applies configured database migrations.

## Glossary

**AI model:** Software that generates or reviews text and code based on your task.

**Allowlist:** An explicit list of approved systems or targets. Anything absent is not approved.

**Audit log:** A record of task classifications, routing, model identity, checks, and decisions.

**Cloud model:** An AI model that runs on a provider's remote infrastructure. Data sent to it leaves your computer.

**Critic:** A separate model that reviews the first model's response.

**Fail closed:** Stop when safety information or required infrastructure is missing, instead of continuing with weaker protection.

**Fallback model:** Another specifically approved model that may be used when the preferred model is unavailable. NeuralLoom does not permit arbitrary substitution.

**Information class:** The sensitivity category assigned to task content, such as public material or credentials.

**Local-only:** Information that must not be sent to the configured cloud models.

**Ollama:** The model service NeuralLoom connects to. The local Ollama application exposes an API on your computer and can route approved cloud-model requests.

**Patch:** A proposed set of code changes, often shown as a unified diff. A patch must still be reviewed and applied through your development workflow.

**PGLite:** The embedded PostgreSQL-compatible database used for temporary local audit data.

**Redaction:** Removing or masking sensitive values while preserving only the context needed for a task.

**Role:** A task specialization, such as planner, coder, repository analyst, security specialist, or fast triage.

**Sanitized data:** Content from which credentials, personal information, customer information, live evidence, and other restricted details have been removed.

**Workspace runner:** An isolated environment capable of opening a repository and running formatters, tests, security checks, and other commands. NeuralLoom does not currently include one.

## Next steps

After completing the first walkthrough:

1. Try one of the suggested tasks using invented or public material.
2. Explore **Safety** to understand the information lanes.
3. Explore **Checks** to understand acceptance decisions.
4. Open **Models** and review which roles your installed model supports.
5. Establish an organizational policy for authorized company or client data before using it.
6. Continue to treat every generated response as a proposal requiring human review.
