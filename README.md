# agent-platform-deepagents

Electron and Deep Agents TypeScript development pilot. M1-02 OpenRouter setup and durable General Chat are accepted. The current M1-03 working candidate adds task allowances, approval and two-task queueing; practical checks and regression coverage pass, with publication and hosted PR checks still outstanding. See the milestone plan and issue #3 for evidence and live delivery status.

## Product and delivery planning

- [Project instructions](AGENTS.md)
- [Repository documentation workflow](.agents/skills/repository-documentation/SKILL.md)
- [Practical-first testing and test-resource policy](docs/testing-strategy.md)
- [Agreed product specification](docs/product-specification.md)
- [Milestone one implementation plan](docs/planning/milestone-1.md)
- [Sources, skills and reuse boundaries](docs/planning/source-and-reuse-map.md)
- [M1-02 connection qualification and limits](docs/planning/m1-02-qualification.md)

These distinguish agreed requirements, planned work and the accepted M1-01 infrastructure qualification. Development tasks are tracked in [GitHub Issues](https://github.com/jwill9999/agent-platform-deepagents/issues) under [milestone one](https://github.com/jwill9999/agent-platform-deepagents/milestone/1), without a Project board. The agent selects unblocked tasks and follows their practical acceptance and C1–C4 checkpoints; repository documents are specifications, not a parallel status backlog.

## Requirements

Use Node.js 24 LTS and npm 11 (`nvm use` if you use nvm). Dependencies are recorded in `package-lock.json`.

```sh
npm ci
npm run check
npm run dev:desktop
```

The desktop uses React, TypeScript, Vite and shadcn/ui, following the current Figma file. It connects to an independently started local service. A narrow sandbox preload supplies only the authenticated loopback connection; it never exposes provider credentials or Node.js. Navigation, new windows and permission requests are denied.

## Workspace

- `apps/desktop`: Electron lifecycle and the React setup/chat renderer, using a restricted custom protocol.
- `apps/agent-service`: independent service using the experimental LangGraph embedded API, maintained SQLite checkpointing and application metadata storage and narrow authenticated chat admission.
- `packages/agent`: Deep Agents/OpenRouter factories, native credential binding and approved chat-only middleware; the user chooses model defaults.
- `packages/contracts`: reserved shared contract boundary; no product API yet.

```sh
npm run dev:service  # start the configured development server (see below)
npm run smoke:desktop  # load the real Electron document, check Node globals, then quit
npm run typecheck
npm run build
npm run format:check
```

`dev:*` commands build once before launching. Start the service first, then launch the desktop with the **same** `HARNESS_SERVICE_TOKEN`. The desktop presents setup if no key/defaults are saved. Installers, signing and automatic service supervision are later slices. Current chat has no shell/search/document tools or Stop/Resume. Each instruction requires an allowance; an insufficient allowance prompts for approval before dispatch. Closing the desktop is not yet a supported background-run workflow. No credentials are needed for builds/typechecks.

## Independent service qualification

`npm run dev:service` builds the workspaces and starts our loopback service at `127.0.0.1:2024`. It uses the maintained experimental LangGraph embedded routes and SQLite checkpointer. Application code supplies thread metadata and task-status recovery. Bounded synthetic service/storage/restart checks passed; this is not a packaged production runtime.

Before starting, provide:

- `HARNESS_DATA_DIR`: an existing absolute directory owned by the current user, with mode `0700`. No current-directory or home-directory fallback is used. Test storage must follow the project's external-storage policy.
- `HARNESS_SERVICE_TOKEN`: a private random bearer token of at least 32 URL-safe characters; send it in the `Authorization: Bearer …` header. Never commit or log it.
- Model defaults are selected from the live OpenRouter catalogue in the UI and saved by the service. `OPENROUTER_MODEL` remains only for the standalone framework-development factory.
- `HARNESS_KEYRING_SERVICE`: optional backend namespace override for isolated qualification; defaults to `agent-platform-deepagents`. This does not add a second user profile.
- `HARNESS_CREDENTIAL_SOURCE`: `environment` (development default) reads `OPENROUTER_API_KEY`; `keyring` reads maintained `@napi-rs/keyring` service `agent-platform-deepagents`, account `openrouter`, without environment fallback. Use `keyring` for first-run UI saving. Authentication is checked before a replacement is saved; rejected keys are not retained in the form. The saved key is never returned by the service.

Agent-operated practical checks require the owner's testing-mode decision. Nothing in this section authorises a test launch or credential access.

The service owns three SQLite files: `owner.sqlite` holds an exclusive service-ownership lock; `metadata.sqlite` stores settings, thread/run metadata and task/allowance/decision records; `checkpoints.sqlite` belongs to the maintained framework saver. Existing chats retain their selected model when defaults change. Startup marks unfinished runs interrupted without dispatching them. Full interruption recovery and Resume remain later work.

Authenticated setup, catalogue/defaults, new-chat/search/history, task submission/increase decisions/accounting refresh and one thread-stream route are available. Clients cannot override model, context, system input, graph configuration, checkpoints or tools. Other execution/protocol/state-write/delete routes are denied. Only the packaged `harness://app` origin is trusted, and it still requires the bearer token. Tasks reserve allowance before dispatch; at most two run concurrently and additional tasks queue FIFO. A chat with unresolved work cannot admit another task. Waiting approvals release capacity; approval rejoins the queue. Unattached queued submissions expire to interrupted after 30 seconds when subsequent request/queue activity checks them. Attached waiting streams are excluded.

Provider credential access belongs to the service for setup, model dispatch and explicit charge reconciliation. Tracing and automatic model retries are disabled. Pilot calls have 512 output tokens and a 90-second stream deadline; these are not a monetary spending guarantee. The UI displays the immutable requested model and returned model identity when available. The pinned provider integration omits response model identity on its current streaming path, which the UI discloses explicitly.

M1-03 adds verified live allowance approval, delayed confirmed accounting, remembered follow-up and two-active/third-queued admission. Missing charges remain uncertain with reservations held; accounting refresh never generates a reply. Reservations use conservative prices and context limits, not a guaranteed provider billing cap. Full background/rejoin/Resume is deferred. See the [M1-03 evidence](docs/planning/milestone-1.md#m1-03-practical-qualification--27-october-2026).

Live Electron setup, streamed reply, full owned desktop/service restart and remembered follow-up passed with the approved DeepSeek model. Failure scenarios and subsequent regressions are recorded separately in the [M1-02 evidence](docs/planning/m1-02-qualification.md). This is developer execution, not installer or full background-lifecycle acceptance.

The earlier framework development server remains available as `npm run start:framework-dev --workspace=@harness/agent-service` after a root build. It uses `langgraph.json`, has no product authentication, uses separate development storage and must remain local. Its earlier startup evidence does not validate the new embedded service. Do not use it as the product endpoint.

The CLI retains the previously recorded high-severity `extract-zip` advisories through template/archive tooling. Do not use its template/download commands on untrusted archives. New Hono dependencies use patched versions; distribution dependency qualification remains open. See the [qualification record](docs/planning/m1-01-qualification.md).

## Development

Use feature branches and Conventional Commits. The project currently uses npm workspaces and TypeScript checks; additional tooling should follow concrete requirements. Keep secrets in ignored environment files, never source files. Run `npm run check` before proposing changes.

Dependencies are pinned; compatible Deep Agents peer dependencies must be reviewed together when upgrading. LangSmith is installed as a dependency but tracing is not enabled by this scaffold.

## References

- [Deep Agents TypeScript quickstart](https://docs.langchain.com/oss/javascript/deepagents/quickstart)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)

## Continuous integration

[GitHub Actions](https://github.com/jwill9999/agent-platform-deepagents/actions) runs `npm ci --ignore-scripts`, installs the locked SQLite prebuilt binding explicitly, then runs `npm run check` (source/test type checks, builds and formatting) and `npm run test:coverage`. General dependency installation hooks remain disabled. The `check` job uses a GitHub-hosted Ubuntu runner, Node 24 from `.nvmrc`, read-only repository permissions and pinned action revisions. Jobs have a 15-minute timeout; newer runs cancel older runs for the same workflow/event/ref. Push and PR runs have separate concurrency groups.

Regression checks exercise our real SQLite persistence and HTTP integration with synthetic data, plus mocked Electron, service-startup and credential failure paths. They require no provider key and launch no application VM or Electron session. They supplement the recorded M1-01/M1-02 practical checks; they do not independently establish live OpenRouter, native Keychain, desktop or installer acceptance.

Local tests require `HARNESS_TEST_ROOT` pointing to an existing task-owned collection on the agreed external volume. Set `HARNESS_COVERAGE_DIR` within that collection for generated reports. Run `npm run check` before `npm run test:coverage` because startup checks load the built agent package. CI uses its disposable runner. Vitest enforces per-file minimums of 85% lines, statements and functions, and 80% branches for application source; dependencies and generated builds are outside that coverage scope.

Use task branches and pull requests into `staging`; `main` remains the release baseline. The workflow alone does not enable branch protection or merge work. Green CI does not replace practical acceptance.

### SonarQube Cloud

The `SonarQube` job runs after `check`, on staging/main pushes and same-repository PRs. It uses the repository's `SONAR_TOKEN` secret and [project jwill9999_agent-platform-deepagents](https://sonarcloud.io/dashboard?id=jwill9999_agent-platform-deepagents). `sonar-project.properties` disables scanner automatic scope so explicit `apps`, `packages` and `.github` source paths and the separate `tests` path are respected. Dependencies and generated files are excluded; application source has no coverage exclusions.

Vitest generates real LCOV evidence. The check job uploads `coverage/lcov.info` with one-day retention; the scanner downloads it from that same workflow run and imports it. The unchanged Sonar way gate still requires at least 80% coverage and all its other conditions. The scanner waits up to five minutes for the gate and fails the job if it fails. See [coverage policy and evidence](docs/testing-strategy.md#early-phase-sonar-coverage-decision).

Fork and Dependabot PRs do not receive secret-backed analysis; `check` still runs. Feature-branch pushes alone skip Sonar. A skipped scan is not a pass: verify the actual PR analysis before integration. Never use `pull_request_target` to execute untrusted code with secrets. Sonar's primary analysis branch is `staging`, matching the integration baseline under the current single-branch plan. This is a Sonar project setting, not a Git branch rename or a scanner override. New code remains based on Previous version. Before the first release promotion to Git `main`, qualify a plan supporting both branches or an explicitly reviewed primary-baseline switch, then verify analysis of the exact release revision. The workflow retains the `main` check: do not silently skip it or treat an earlier staging scan as release verification.
