# Scaffold verification — 26 October 2026

Historical checkpoint: these results apply to scaffold `ef40e0f`, not current dependencies or service behaviour. See [M1-01 qualification](planning/m1-01-qualification.md) for subsequent implementation and known advisories.

Owner: this repository scaffolding task, branch `jwill9999/project-setup`.
Purpose: verify the development foundation before selecting product features.
Environment: macOS, Node.js 24.14.0, npm 11.9.0.

- Clean lockfile installation (`npm ci`): passed; npm reported zero vulnerabilities.
- `npm run check`: passed (strict TypeScript, workspace builds, formatting).
- Service bootstrap: passed; exits without starting a server or agent.
- Built `@harness/agent` import: passed; `createDeepAgent` is available without invoking a model.
- Native Electron smoke: passed; document title and heading loaded, renderer Node globals unavailable, application exited.
- Initial desktop attempts timed out. The first included runtime download. Startup was changed from top-level readiness await to a readiness callback before the final passing run. Timed-out task processes were stopped.
- CI configuration added; hosted CI has not run.
- No product journey, provider integration, agent command sandbox, packaging or installer has been tested.

Retention: retain this compact result with the scaffold for review. No VM, screenshots, traces or generated report collection was created. Review or replace this note when the first feature introduces its acceptance checks.
