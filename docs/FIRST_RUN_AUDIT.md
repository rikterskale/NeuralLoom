# First-run experience audit

This audit maps the repository from the perspective of a new local user and records the highest-friction paths found on 2026-09-01.

## Project map

- Setup and operation: `package.json`, `.nvmrc`, `.env.example`, `scripts/doctor.mjs`, and `scripts/with-app-env.mjs`.
- User documentation: `README.md`, this directory's `GETTING_STARTED.md`, and `SECURITY.md`.
- Web entry point: TanStack Start and Vite, with routes in `src/routes/` and navigation in `src/components/app-shell.tsx`.
- Primary workflow: Home -> New task -> server-side classification and routing -> Ollama task model -> independent critic -> deterministic checks -> Audit.
- Persistence: in-memory PGLite locally and PostgreSQL when `DATABASE_URL` is configured.
- Verification: TypeScript, ESLint, Node test suites, build verification, migration tests, and repository browser-smoke scripts.

## Highest-friction paths

| Priority | Path                     | Finding                                                                                                                                                                                                                                                        | Resolution                                                                                                                                  |
| -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Setup -> first task      | The doctor treated any one approved model as ready, although a successful task requires both the selected role primary and the critic primary. The documented starter model could therefore produce a green doctor followed by a blocked or failed first task. | Readiness now requires a complete task-and-critic path. Setup instructions install the coding and critic primaries used by the walkthrough. |
| P0       | Automatic role selection | Common wording such as "Review this" selected the critic as the task author, then used the critic again as reviewer. That contradicted the independent-review promise.                                                                                         | The critic is no longer an automatic task role. It remains dedicated to second-pass review.                                                 |
| P1       | Task form                | The submit button became available when any approved model existed, even if the selected role or critic could not run.                                                                                                                                         | The form now checks the exact resolved task role and critic before enabling submission and names the missing model responsibility.          |
| P1       | Models page              | Individual model availability looked like overall readiness.                                                                                                                                                                                                   | The page now reports complete ready task roles and keeps setup guidance visible until one full path exists.                                 |
| P1       | Home dashboard           | The model-status card could say "Ready" when discovery had failed or no complete task-and-critic path existed, contradicting the adjacent setup alert.                                                                                                         | The dashboard now derives status from the same complete-path readiness rule and distinguishes checking, unavailable, and setup-needed states. |
| P1       | Offline/restricted launch | Every page requested fonts from Google, producing browser errors without public-network access and adding an undeclared third-party request to a privacy-oriented local app.                                                                                    | The application now uses native system font stacks and makes no external font request during startup.                                      |
| P1       | Ollama with zero models  | A reachable Ollama instance with an empty inventory skipped the doctor's model check and could be reported ready.                                                                                                                                              | Reachability and inventory readiness are tracked separately; an empty inventory now fails with actionable setup commands.                   |
| P2       | Contributor confidence   | Unit, routing, security-boundary, preview, migration, and type/lint coverage were strong, but no tracked release-facing CI workflow exercised complete first-user journeys.                                                                                    | A deterministic user-readiness suite now covers desktop/mobile setup, configuration, task, safety, and audit flows in tracked CI with reviewable artifacts. |

## Verification standard

Run `npm run check` and `npm run build`. For a release candidate, also run the browser smoke workflow in an environment with a connected browser and run `npm audit` where registry access is available.
