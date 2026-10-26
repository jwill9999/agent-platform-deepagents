# agent-platform-deepagents

Electron and Deep Agents TypeScript development foundation. Product features are not implemented.

## Product and delivery planning

- [Project instructions](AGENTS.md)
- [Repository documentation workflow](.agents/skills/repository-documentation/SKILL.md)
- [Practical-first testing and test-resource policy](docs/testing-strategy.md)
- [Agreed product specification](docs/product-specification.md)
- [Milestone one implementation plan](docs/planning/milestone-1.md)
- [Sources, skills and reuse boundaries](docs/planning/source-and-reuse-map.md)

These distinguish agreed requirements, planned work and the accepted M1-01 infrastructure qualification. Development tasks are tracked in [GitHub Issues](https://github.com/jwill9999/agent-platform-deepagents/issues) under [milestone one](https://github.com/jwill9999/agent-platform-deepagents/milestone/1), without a Project board. The agent selects unblocked tasks and follows their practical acceptance and C1–C4 checkpoints; repository documents are specifications, not a parallel status backlog.

## Requirements

Use Node.js 24 LTS and npm 11 (`nvm use` if you use nvm). Dependencies are recorded in `package-lock.json`.

```sh
npm ci
npm run check
npm run dev:desktop
```

The desktop command opens a minimal shell. The agreed UI direction is React with TypeScript, Vite and shadcn/ui; it is not implemented yet. There is no preload bridge until an agreed feature needs one; the renderer has no Node.js access. Navigation, new windows and permission requests are denied.

## Workspace

- `apps/desktop`: Electron lifecycle and a static renderer, using a restricted custom protocol.
- `apps/agent-service`: independent service using the experimental LangGraph embedded API, maintained SQLite checkpointing and application metadata storage; execution remains disabled.
- `packages/agent`: upstream `createDeepAgent` export and a minimal OpenRouter graph factory; no default model is chosen.
- `packages/contracts`: reserved shared contract boundary; no product API yet.

```sh
npm run dev:service  # start the configured development server (see below)
npm run smoke:desktop  # load the real Electron document, check Node globals, then quit
npm run typecheck
npm run build
npm run format:check
```

`dev:*` commands build once before launching. Installers, signing and distribution are not configured. Bounded service persistence/restart checks passed. Desktop/service connection, live chat, MCP connections, coding tools, a product sandbox and integrated background lifecycle remain unqualified. Electron renderer isolation does not provide a sandbox for future agent commands. No credentials are needed for builds/typechecks.

## Independent service qualification

`npm run dev:service` builds the workspaces and starts our loopback service at `127.0.0.1:2024`. It uses the maintained experimental LangGraph embedded routes and SQLite checkpointer. Application code supplies thread metadata and task-status recovery. Bounded synthetic service/storage/restart checks passed; this is not a packaged production runtime.

Before starting, provide:

- `HARNESS_DATA_DIR`: an existing absolute directory owned by the current user, with mode `0700`. No current-directory or home-directory fallback is used. Test storage must follow the project's external-storage policy.
- `HARNESS_SERVICE_TOKEN`: a private random bearer token of at least 32 URL-safe characters; send it in the `Authorization: Bearer …` header. Never commit or log it.
- `OPENROUTER_MODEL`: explicit model identifier; no model is chosen automatically.
- `HARNESS_KEYRING_SERVICE`: optional backend namespace override for isolated qualification; defaults to `agent-platform-deepagents`. This does not add a second user profile.
- `HARNESS_CREDENTIAL_SOURCE`: `environment` (development default) reads `OPENROUTER_API_KEY`; `keyring` reads maintained `@napi-rs/keyring` service `agent-platform-deepagents`, account `openrouter`, without environment fallback. No credential-writing UI exists yet.

Agent-operated practical checks require the owner's testing-mode decision. Nothing in this section authorises a test launch or credential access.

The service owns three SQLite files: `owner.sqlite` holds a native exclusive service-ownership lock; `metadata.sqlite` stores thread/run metadata; `checkpoints.sqlite` belongs to the framework saver. Failed startup closes opened connections. Normal shutdown closes the listener and databases. The implementation marks pending/running records as interrupted on startup; only an explicit resume request can return an interrupted record to pending. Completed and stopped records remain unchanged. **Run lifecycle methods are not yet wired to execution**, so integrated recovery is not established.

Authenticated health, thread creation/search and saved-state/history reads are available in source. Run creation/execution, protocol streaming, state mutation, thread deletion and browser-origin requests are disabled. The M1-02 provider/tool-policy gate remains open; no route can currently invoke the model. Credential access occurs during graph construction, not on import. Tracing is disabled. Actual service Keychain access across restart, SQLite persistence/restart and the admitted/denied routes passed bounded synthetic checks. Live provider use, locked-Keychain handling and packaged compatibility remain unverified.

The earlier framework development server remains available as `npm run start:framework-dev --workspace=@harness/agent-service` after a root build. It uses `langgraph.json`, has no product authentication, uses separate development storage and must remain local. Its earlier startup evidence does not validate the new embedded service. Do not use it as the product endpoint.

The CLI retains the previously recorded high-severity `extract-zip` advisories through template/archive tooling. Do not use its template/download commands on untrusted archives. New Hono dependencies use patched versions; distribution dependency qualification remains open. See the [qualification record](docs/planning/m1-01-qualification.md).

## Development

Use feature branches and Conventional Commits. The project currently uses npm workspaces and TypeScript checks; additional tooling should follow concrete requirements. Keep secrets in ignored environment files, never source files. Run `npm run check` before proposing changes.

Dependencies are pinned; compatible Deep Agents peer dependencies must be reviewed together when upgrading. LangSmith is installed as a dependency but tracing is not enabled by this scaffold.

## References

- [Deep Agents TypeScript quickstart](https://docs.langchain.com/oss/javascript/deepagents/quickstart)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)

## Continuous integration

[GitHub Actions](https://github.com/jwill9999/agent-platform-deepagents/actions) runs `npm ci` and `npm run check` (type checks, builds and formatting) on pushes and pull requests, including staging and main. The job is named `check`, uses a GitHub-hosted Ubuntu runner with Node 24 from `.nvmrc`, read-only repository permissions and pinned action revisions. Each job has a 15-minute timeout; a newer run cancels an older run for the same workflow/event/ref. Push and pull-request checks use separate groups so one cannot cancel the other.

CI requires no provider key and launches no application VM or Electron session. It is a supporting static/build gate, not live OpenRouter, desktop or installer acceptance. The last verified hosted pass before the action update was [commit b9c1fde](https://github.com/jwill9999/agent-platform-deepagents/actions/runs/40342253834). The updated action revisions require a fresh hosted run after publication.

Use task branches and pull requests into `staging` as the development integration baseline; `main` remains the release baseline. Require `check` before integration once branch protection is configured. The workflow file alone does not enable branch protection, change the default branch or merge existing work into staging.

### SonarQube Cloud

The `SonarQube` job analyses our `apps` and `packages` source after `check` succeeds, on staging/main pushes and same-repository pull requests. It uses the repository's `SONAR_TOKEN` secret and [project jwill9999_agent-platform-deepagents](https://sonarcloud.io/dashboard?id=jwill9999_agent-platform-deepagents) in organisation `jwill9999`. The pinned official scanner waits up to five minutes for the quality gate; analysis or gate failure fails the job. Generated output and dependencies are excluded. No fabricated coverage report or coverage exclusions are added to avoid a failing gate.

Fork and Dependabot PRs do not receive this secret-backed analysis; `check` still runs, and a skipped scan is not a Sonar pass. Scan approved contributions through a trusted branch before integration when required. Do not use `pull_request_target` to execute untrusted PR code with secrets. Feature-branch pushes alone do not run Sonar; open a same-repository PR for analysis.

Initial configuration was verified through the public Sonar API: the project exists, but its Sonar main branch is currently `main`, and no analysis pass has been established. Before treating staging as the Sonar baseline, align the project branch settings and ensure CI-based analysis is enabled (disable automatic analysis if enabled). Branch/PR analysis availability depends on the project's Sonar plan. These service settings and a successful hosted scan must be verified before calling the integration operational or requiring its check in branch protection. Static analysis supports, but never replaces, practical acceptance.
