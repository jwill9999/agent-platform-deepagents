# M1-02 connection qualification

Owner: Codex in the current repository chat. Branch: `jwill9999/m1-02-openrouter`, based on staging `28a1f61`. [Issue #2](https://github.com/jwill9999/agent-platform-deepagents/issues/2) owns live status and acceptance. Started 26 October 2026. The owner approved the reported testing-confidence and publication checkpoint after the live and regression outcomes below; see closeout for delivery state.

## Starting state

PR #10 merged into staging with its individual commits preserved. PR checks passed at `5c5623a`: Sonar coverage 99.7%, line coverage 100%, branch coverage 99.0%. The post-merge [staging workflow](https://github.com/jwill9999/agent-platform-deepagents/actions/runs/40378149459) passed its build/regression job but Sonar could not retrieve the branch gate: the organisation's plan forbids non-main-branch data access. Sonar still identifies `main` as primary. This is a branch-plan restriction, not a new coverage failure; baseline configuration requires resolution separately.

The existing factory uses maintained `ChatOpenRouter` and Deep Agents. Credential reads use environment or the maintained native Keychain binding. HTTP execution stays disabled until effective policy and admission are qualified. M1-01 practical infrastructure evidence remains valid within its recorded scope.

## Framework-first decision

Consulted ecosystem-primer, deep-agents-core, deep-agents-memory, installed source and the live Deep Agents docs MCP. Published versions on 26 October match the installed Deep Agents 1.15.1 and LangChain 1.5.19; no released upgrade resolving this gap was identified.

The documented [harness profiles](https://docs.langchain.com/oss/javascript/deepagents/profiles) support tool exclusions and disabling the general-purpose subagent. In the installed combination, native ChatOpenRouter does not supply the metadata recognised by profile resolution, and `CreateDeepAgentParams` has no explicit profile option. An empty `subagents` array does not disable the automatic general-purpose agent. Do not register an ineffective profile or spoof provider/private fields.

Read-only critique confirmed that replacing middleware with a maintained empty subagent instance still exposes `task`, while the filesystem allowlist requires `read_file`. Configuration alone therefore does not establish zero-tool chat for this pinned combination.

Owner-approved bounded addition, now implemented: use public LangChain `createMiddleware` hooks to remove tools from model requests and reject any attempted tool dispatch, including delegation. Retain Deep Agents' loop, default state backend, deny filesystem permissions and maintained OpenRouter integration. No provider adapter, agent loop, host filesystem backend or sandbox is added. This is application policy through a supported extension point, but still bespoke policy code and the owner explicitly approved this boundary before implementation.

Before provider access, inspect the effective model-facing tools and exercise prohibited dispatch with controlled fault injection. Qualify our policy outcome, not upstream internals. Only then admit bounded real model execution through authenticated service routes; do not simply expose every embedded run endpoint. Streaming, saved defaults and client integration remain the rest of M1-02, with DT-02 design review before UI changes.

## Credential and live-test prerequisites

Historical investigation, superseded by the masked-dialog setup below: the owner initially asked to reuse the existing Agent Platform OpenRouter key. Both supported OpenRouter variable names are absent/empty in that project's root `.env`; no secret value was printed, copied or changed. Its desktop supports encrypted credential storage, but the location of this particular saved key is not yet established. No credential was extracted; the old profile and configuration were preserved. Reuse would share the existing key's provider spending limit.

The owner supplied the key through a masked macOS dialog. The maintained keyring binding saved and read-back verified it under service `agent-platform-deepagents`, account `openrouter`. No plaintext file, terminal output or chat contained the value. The owner selected `deepseek/deepseek-v4.1-flash-1017` and authorised up to US$3; a later statement about available account credits did not increase that test ceiling. Authentication and public model-catalogue checks passed. The old project profile was not changed.

## Live backend qualification — 26 October 2026

The production factory with the approved middleware passed a controlled, no-network probe: outbound tool schemas were empty and a synthetic `task` response caused the policy error before dispatch or another model request. Independent source review confirmed hook order and the public dispatch boundary. Internal subagent objects may still be constructed; this policy removes their effective authority rather than claiming they do not exist.

Two sequential fresh Node processes then exercised the production factory and maintained SQLite checkpointer, each resolving the saved Keychain credential anew. The first streamed a reply and saved two messages. The second reopened the same state, verified saved history, and correctly recalled the synthetic phrase, leaving four messages. Both responses reported the exact selected model. This is standalone backend qualification, not a connected HTTP execution route, Electron UI, Stop/Resume, installer or complete M1-02 acceptance.

Controls: five-request ceiling, fixed model, no model fallback list/plugins/tools, 32 KB maximum input-message JSON, 512 output tokens per request, 60-second run deadline, and OpenRouter provider price ceilings of US$1/M input and US$2/M output with no per-request fee. These are task-local qualification controls, not implementation of M1-03's product allowances. Any unexpected route/tool request, provider failure or exhausted limit stops the block. No tracing was enabled.

Observed generation costs from provider stream usage: US$0.0000036828 and US$0.0000080784; total **US$0.0000117612**, two model requests. Immediate key-usage snapshots had not yet changed, so they are not used as attributed spend evidence. Compact generation IDs/results are retained in the single external collection: `/Volumes/external/Agent Platform Development/Test evidence/agent-platform-deepagents/M1-02/live-results.json`.

C1: owner authorised the model, saved credential and US$3 ceiling; one sequential Node test environment, no VM/Electron/listener. C2: the practical factory/persistence checks preceded the added policy regression tests; frontend acceptance remains outstanding. C3: child PIDs 36536 and 36563 exited; synthetic SQLite directory was removed in guaranteed teardown. The saved credential is intended product configuration and is preserved. Only compact final evidence and coverage remain for review at M1-02 acceptance.

C4: M1-02 remains in progress. Streaming HTTP admission, DT-02 design completion, connected desktop setup/chat/defaults and their practical outcomes are still outstanding. Regression checks passed after the live block: 32 tests, 100% lines/statements/functions and 99.02% branches; type checks, builds and formatting also passed. Final read-only critique approved this bounded increment with no actionable code findings. Its documentation finding was resolved by marking the earlier key-location investigation as historical. No M1-02 commit or push has occurred; the owner's testing-confidence checkpoint still applies before publication.

## Connected desktop implementation and qualification

Implementation source: commit `f5037f4` on `jwill9999/m1-02-openrouter`, based on `28a1f61`. This section supersedes the backend-only section's outstanding implementation list. The owner approved publication after the confidence discussion; hosted verification and integration are tracked separately.

Reuse: Deep Agents 1.15.1, native ChatOpenRouter 0.4.19, the existing experimental embedded LangGraph server, SDK 1.12.7, maintained SQLite saver, Hono and native Keychain. The service uses the documented [model-selection middleware](https://docs.langchain.com/oss/javascript/langchain/models#dynamic-model-selection) with server-owned immutable per-chat context. The SDK consumes framework SSE; its maintained decoder observes error events for durable run classification. No new agent loop, provider adapter, checkpoint engine, general scheduler or wire protocol is implemented.

Product bindings: authenticated key validation/save, live text-model catalogue, General/Coding defaults, immutable per-chat selection, strict human-message admission and same-thread overlap rejection. The React/TypeScript/Vite shell uses the official shadcn Button, Geist and the Figma tokens. The sandbox preload exposes only the fixed local connection, never the provider key or arbitrary IPC. Read-only critique confirmed these remain within the agreed component boundaries.

DT-02: current Figma file `pCoB36sHdGlhLJoy0xD2SH`, added frames 25:357 (checking), 25:377 (Keychain unavailable), 25:396 (service unavailable), 25:415 (catalogue loading), 25:437 (catalogue unavailable), 25:459 (restored conversation), 25:504 (reply failed). The reviewer read fourteen relevant frames and inspected recovery/restored screenshots. DT02-01 corrected inherited authentication-only annotations on the two distinct local failure states; readback and independent recheck approved the gate before dependent UI implementation. DT-10 now records the requested-versus-returned model identity wording.

Live practical outcomes, using one Electron 45 instance and one independent Node service sequentially, with Playwright 1.59.1 operating the actual window:

- Saved Keychain authentication and live catalogue selection through Electron; same-model defaults saved. A later block also exercised the service-owned key-save path using the same existing credential without printing its value.
- Real streamed reply through Electron → authenticated Hono boundary → embedded LangGraph → Deep Agents → the approved OpenRouter model.
- Full owned desktop and service shutdown/relaunch, restored history, then a real follow-up recalling the synthetic phrase. New-chat separation passed. These narrow restart results do not establish later continuing-work/rejoin semantics.
- Renderer Node isolation, denial of alternative run routes and client model/context overrides.
- Recovery-only UI checks: injected `/setup` failure leaves a working Retry connection action; an invalid replacement is rejected and cleared; the original Keychain credential remains usable. No additional generation in those blocks.

Three desktop generation calls were made, in addition to the earlier two backend calls. Desktop stream usage reports US$0.0000052272, US$0.0000053064 and US$0.000002266704. Across all five calls, reported total is **US$0.000024561504**, below the authorised US$3 ceiling. Guarded requests used the exact approved model, no tools/fallbacks, 512 output tokens, bounded input/time and provider price ceilings. This is attributed stream-usage evidence, not a provider invoice or implementation of M1-03's product allowance.

A final assertion expecting provider-returned model identity failed despite a successful real reply. Source inspection found that the pinned native streaming converter omits that identity. The plan requires the effective selected model and provider identity where observable; critique confirmed no scope change or custom adapter is necessary. The UI labels the service-owned requested model explicitly, preserves returned metadata when available and otherwise states that the response model was not reported. No identity is fabricated. Prefer a qualified maintained upgrade for this limitation.

Controlled local fault scenarios, no network or model charges: framework checkpoint failure outside the model hook produces durable `error` before client EOF; an explicit later send is admitted; model errors are generic; changed defaults preserve old-chat selection; client overrides fail; same-thread duplicates remain blocked throughout streaming. These fault outcomes precede the corresponding regression coverage. One duplicate-admission regression was drafted before its explicit local practical probe; the probe passed before the regression was executed. This sequencing deviation is recorded rather than claimed as perfect C2 compliance.

Critique findings and dispositions:

| ID      | Finding                                                      | Disposition                                                                         |
| ------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| DT02-01 | Recovery annotations contradicted new states                 | Corrected, read back, independently approved                                        |
| CHAT-01 | Normal SSE EOF could hide a framework error                  | Maintained decoder observes error events; practical checkpoint-failure check passed |
| UI-01   | Failed initial setup could leave disabled form without retry | Connection state reset on failure; actual Electron retry check passed               |
| CHAT-02 | Client EOF preceded durable admission finalisation           | Finalise before EOF; immediate follow-up local check passed                         |

C3: each practical block used guaranteed teardown, stopped its owned Electron/service processes and removed synthetic SQLite/profile directories from the single external collection. No VM was created. The intended saved credential is preserved. Compact results, usage ledger and selected screenshots are retained under `/Volumes/external/Agent Platform Development/Test evidence/agent-platform-deepagents/M1-02`; temporary scripts/diagnostics are reviewed at closeout.

Supporting regression evidence on the final formatted source: 49 tests passed; 98.4% lines, 98.11% statements, 99.1% functions and 96.11% branches. All application files meet the unchanged per-file thresholds. Coverage now explicitly includes renderer TSX and preload source; framework/dependency implementations are not measured. Tests follow the live/recovery scenarios and cover our state, security, failure and integration behaviour. Type checks passed; final formatting, clean-build and review results are recorded at closeout.

Remaining limits: manually started developer service; no installer, signed distribution, monetary allowance, queue, Stop/Resume or background continuation. Pilot configuration limits replies to 512 output tokens and streams to 90 seconds; neither guarantees an exact spending cap. The existing template CLI `extract-zip` advisories remain outside the runtime chat path. Sonar staging's plan/baseline restriction remains separate from local coverage. No commit/push or hosted success is claimed.

## Closeout checkpoint

Final independent critique: **approved**, no new actionable findings; DT02-01, CHAT-01, UI-01 and CHAT-02 resolved. Reviewed implementation/evidence preserves the agreed boundaries. The C2 drafting-order deviation above was explicitly disclosed before the owner approved publication; critique did not retroactively waive it.

`npm run check` passed. A fresh source copy on the external test volume passed lockfile installation with scripts disabled, explicit SQLite prebuilt installation, full type/build/format checks and all regression coverage thresholds, matching the CI installation approach. The entire temporary source/dependency copy was removed afterwards. Native Electron setup/recovery was rechecked after bundling the sandbox preload to CommonJS with Vite. The superseded static renderer was removed; the working renderer lives under `apps/desktop/src/renderer`.

Final source/test/config snapshot SHA-256: `f9a0d1cc8ecbd37ff449c2aba6d4cb3be029657fb5b815222f4d455f0a7fdef1` (sorted repository-relative paths plus file bytes for apps/packages/tests and root package/lock/Vitest/test-TypeScript configuration). Source scanning found no OpenRouter-key-shaped literals. No owned service/Electron/controller remains and port 2024 has no listener. Temporary controllers, diagnostics, resolved failure capture and redundant HTML coverage were retired after canonical LCOV/summary hash verification. The compact external collection is under 0.5 MB, with digests in `retention-index.json`; no disposable runtime, VM disk or recovery archive remains. The real Keychain credential is intentionally retained.

The owner subsequently approved the testing-confidence/publication checkpoint, including the disclosed drafting-order deviation and model-identity limitation. Code and regression tests are committed as `f5037f4`; this documentation records that approved result. Issue #2 remains open while publication/hosted verification and integration are reconciled. No PR, merge or release is claimed. The existing Sonar staging baseline/plan restriction remains separate; local coverage is passing and no gate was bypassed.
