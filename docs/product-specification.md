# Agent Platform Deep Agents product specification

Status: agreed product direction, recorded for review; not an implementation or release claim.
Last updated: 26 October 2026 (Europe/London).
Owner authority: decisions explicitly agreed in the repository scaffolding conversation.

This application gives general users two distinct agents in an Electron desktop application. Users select General Chat or Coding explicitly. Both use Deep Agents as the execution harness, with different instructions and tools. Neither is implicitly a subagent of the other.

The first delivery target is Apple Silicon macOS; Windows is next. Local execution is the initial default. The application manages setup through an installer and a guided first-run runtime download. Self-hosted service connections remain part of the product direction. A hosted service operated by us is not a launch requirement.

Implementation sequencing is defined in [milestone one](planning/milestone-1.md). Documentation and skill evidence is indexed in the [source and reuse map](planning/source-and-reuse-map.md). Future product requirements below are not all milestone-one scope.

## Current delivery state

The checkout is `/Users/letuscode/projects/agent-platform-deepagents`. M1-01 is accepted; its code/documentation and PR #10 coverage work are merged into staging (`28a1f61`). GitHub Issues owns live status. The original scaffold verification remains historical evidence.

M1-02 now implements the React/Vite/shadcn Electron client, authenticated independent service, service-owned Keychain setup/defaults, narrow streamed General Chat and durable history. Real OpenRouter reply and fresh-process follow-up passed; supporting recovery/regression evidence and limits are in [M1-02 qualification](planning/m1-02-qualification.md). Implementation and regression tests are committed as `f5037f4` after critique approval and the owner's testing-confidence/publication go-ahead; hosted verification and integration remain separate.

Not delivered by this slice: task allowances/queue, Stop/Resume, background continuation/rejoin, notifications, product sandbox, document/coding workflows or installer. The temporary M1-01 VM was removed. Framework feasibility and CI alone do not establish these later outcomes.

## Agreed requirements

| ID  | Requirement                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P01 | Explicit General Chat and Coding entry points in the desktop, following Figma.                                                                                                                                                                                                                                                                   |
| P02 | General Chat answers questions, researches the web and works with uploaded and generated files.                                                                                                                                                                                                                                                  |
| P03 | Read, summarise, create and edit documents, spreadsheets and presentations; offer previews and downloadable files. Spreadsheet changes initially happen through chat, not direct cell editing.                                                                                                                                                   |
| P04 | Spreadsheets support editable charts and working formulas from the start of spreadsheet delivery. Recalculate before delivery, verify results and input changes, and retain formulas and chart objects rather than substituting static values/images. This is a later feature milestone, not text-chat M1.                                       |
| P05 | Coding supports existing repositories and new projects, with inspection, edits, builds/tests, reviewable diffs and running previews for supported web applications.                                                                                                                                                                              |
| P06 | Initial web-project scope: plain HTML/CSS/JavaScript, React with Vite, Angular and Next.js. React with Vite is the configurable new-project default. Preserve existing repository conventions and explicitly requested stacks.                                                                                                                   |
| P07 | Isolated working copies by default. Apply changes is an explicit user action. Detect divergence from the source checkout before applying; preserve unresolved changes. New projects are prepared in a managed workspace before saving to a chosen destination.                                                                                   |
| P08 | Electron desktop UI uses React, TypeScript, Vite and shadcn/ui, following the inspected Figma designs. This choice is independent of supported generated-project frameworks.                                                                                                                                                                     |
| P09 | Bring-your-own model credentials, starting with OpenRouter. Keep provider integrations replaceable; additional providers require qualification.                                                                                                                                                                                                  |
| P10 | Separate configurable default models for General Chat and Coding, with the option to use one model for both. New chats inherit defaults; existing chats retain their selection. Manual switching between runs is limited to qualified combinations. No switching during active runs or pending approval; no automatic model switching initially. |
| P11 | Agents act autonomously within the authorised task; ask before external or destructive actions. See permission boundaries below.                                                                                                                                                                                                                 |
| P12 | Save conversations and pending approvals. Automatically identify useful preferences/facts, with controls to review, correct, delete and disable learning. Share personal preferences between the agents; scope project memories separately.                                                                                                      |
| P13 | Tasks continue after the desktop closes while the local service and machine remain available. Show that API credits may still be consumed. Stop is distinct from disconnect.                                                                                                                                                                     |
| P14 | Two independent active tasks per user initially, configurable later; queue additional work. Enforce one active run per chat and prevent concurrent mutation of the same working copy. Bound delegated execution separately.                                                                                                                      |
| P15 | Each task has a configurable spending allowance; increasing it requires approval. Show estimated usage distinctly from provider-confirmed charges. Count retries and delegated work towards task usage.                                                                                                                                          |
| P16 | Activity inbox and optional macOS notifications for completion, failure and required user decisions. Retain unread events across reconnects. Routine progress stays inside the app. Email and messaging are deferred.                                                                                                                            |
| P17 | Guided GitHub integration first, plus advanced custom MCP connections. Select which agents/projects receive tools and retain the approval policy for external writes.                                                                                                                                                                            |
| P18 | Local execution first, using a service independently runnable from Electron and a replaceable sandbox backend. Self-hosted connection settings are retained in the architecture and planned delivery.                                                                                                                                            |
| P19 | App-managed execution runtime with guided first-run download; no requirement that general users manually install Docker. The runtime technology is still subject to feasibility qualification.                                                                                                                                                   |
| P20 | Preservation-first storage. Preserve source uploads, deliverables, chats, memories and unapplied code until user deletion. Automatic cleanup is restricted to identified disposable runtime/cache data. Provide storage usage, configurable location and reviewed cleanup.                                                                       |
| P21 | Bounded retries for brief network/provider failures. Explicit Resume after service/machine interruptions. User-stopped work stays stopped. Reconcile uncertain side effects before retrying.                                                                                                                                                     |
| P22 | One local profile per macOS user initially, without an application account. Provider credentials are connections, not app sign-in. Self-hosted service authentication is separate.                                                                                                                                                               |
| P23 | Apple Silicon macOS first; Windows next. Intel Mac support and minimum OS/hardware requirements are not agreed.                                                                                                                                                                                                                                  |

## Independent service and future clients (P24)

The owner has agreed that the service remains independent of Electron so later CLI and mobile clients can connect to it. Electron is the only product client delivered in M1. Keep agent execution, durable task/thread state, approvals, provider credential access and shared limits behind the service boundary; the desktop presents these capabilities rather than owning a separate agent loop or policy authority. Credential access must work without depending on an Electron process.

Later clients should use a qualified supported server/SDK/HTTP interface and the same authenticated application policies. Two-active-task admission and task allowances apply across clients together, not per device; no client may bypass them through an exposed raw framework endpoint. A terminal chat/control client is distinct from an interactive sandbox terminal. Mobile access requires an available reachable service and appropriate authentication; it does not approve offline mobile execution, cross-device synchronisation or automatic remote exposure. Native versus mobile-web delivery, client release order and secure connection setup remain later decisions. See the [architecture and qualification plan](planning/milestone-1.md#independent-service-and-later-clients), [D12 evidence](planning/source-and-reuse-map.md#independent-service-and-client-interfaces-d12) and [DT-11 design trigger](planning/design-scope-and-brief.md#design-coverage-triggers).

## Development testing and resource rules

The owner-agreed [testing policy](testing-strategy.md), enforced by [AGENTS.md](../AGENTS.md), requires practical scenarios through the actual application with the configured OpenRouter agent before writing the affected unit tests. Test our code and integrations, not framework internals. Live practical scenarios determine acceptance; green unit/E2E pipelines are supporting signals, not a working-product claim. Keep live versus fixture evidence distinct.

Use two project-wide environment roles only: normal application/development plus one shared reusable testing environment, across all chats/tasks/branches. Limit testing to one VM and one Electron instance; discuss any additional environment before allocation. Reuse the designated test environment, guarantee shutdown and verify teardown. Retire disposable disks/profiles and temporary JSON/Markdown/reports after resolution and review; retain only compact final and necessary unresolved-failure evidence. This development cleanup policy does not weaken preservation of user files or unapplied product work.

## Permission and execution boundaries

The requested task authorises reads of selected material, web research, edits of managed working copies, and project-scoped commands/dependency installation in the designated sandbox. It does not grant unrestricted host access.

Ask before accessing additional private locations/accounts; overwriting originals or deleting user data; host/global installation or configuration; committing, pushing, merging, deploying, publishing or other external writes. Apply changes explicitly authorises the presented local patch, subject to conflict checks; it does not authorise a commit or push. Installing the app-managed runtime is covered by the guided setup the user elects to complete, not an agent improvising host installation during a coding task.

Deep Agents file permissions, approvals, Git working-copy isolation and execution isolation are separate controls. Filesystem permissions do not constrain arbitrary shell commands. The service must enforce the policy across UI, API, tools and background workers, not rely solely on prompts.

## Credentials, models and research

Onboarding selects OpenRouter by default, accepts a masked key, checks authentication separately from an optional chargeable model test, and lets users choose both default models. Keep credentials out of conversation state, workspace files, logs and sandbox environments; use OS-backed protection locally. Do not return saved plaintext credentials to the renderer. Remote connections must explain where credentials and files are processed.

Maintain a provider-neutral configuration with explicit provider/model identifiers and credential references. Prefer the dedicated LangChain OpenRouter integration over assuming all router-specific behaviour is preserved by a generic OpenAI adapter. Model metadata is advertised capability, not evidence of passing our tool, streaming, document or handoff journeys. Record the effective model/provider where observable; never silently change models on failure.

OpenRouter access does not automatically provide web search or a sandbox. The web-research integration, source retrieval, citations and its cost model remain to be selected and tested. Do not assume direct-provider search tools work with every routed model.

## Memory and preservation

Use conversation checkpoints for chat/run recovery, cross-thread storage for preferences/facts, and artifact/workspace storage for files. Durable storage is required; in-memory examples are insufficient.

The intended memory UX includes source conversation/date, scope, stated-versus-inferred information, update notices/undo, review/correction/deletion and disable-learning controls. These are proposed implementation details supporting P12, not proof of an existing extractor. Corrections/deletions must be respected in later fresh chats and after restart. Deleting a memory is not a claim that the source chat, checkpoints or backups were erased; disclose those retention boundaries.

Share personal preferences by local-profile identity. Project knowledge is retrieved only for the selected project; it must not leak into another project or an unrelated general chat. User-authored instructions outrank inferred memory. Uploaded documents, tool output and stored facts are source material, not new authority to act.

Execution instances may stop without deleting their durable work. Rehydration must be tested. Keep incomplete/applied states distinct and never delete unapplied work simply to satisfy a disk threshold.

## Background work, budgets and recovery

A closed window must not own service lifetime. Distinguish window close, disconnect, Stop task, quit/stop service and machine sleep/shutdown. Closing the desktop is not permission to prevent sleep or keep working after a machine stops.

Store task identity, state, selected model, allowance, usage records, workspace reference and pending decisions durably. Service-side scheduling enforces concurrency. UI reconnection must reconcile state and missed events without starting a duplicate run. Approval-waiting/interrupted-task slot accounting and fair scheduling are technical policy choices to settle in the plan.

Enforce call/time limits as well as a spending allowance. Exact monetary overshoot guarantees remain unqualified: in-flight requests, provider reports, tools and sandbox charges may arrive late or be separate. Reserve/estimate before admitting calls, stop new chargeable dispatch at exhaustion, and reconcile later charges. Never label an estimate as a guaranteed billing cap. No automatic allowance increase.

Only retry failures classified as transient, within bounded retry counts/backoff and the original allowance. Checkpoint recovery may replay interrupted operations. Use operation identities, reconciliation and idempotent tools where applicable; a checkpoint is not an external-side-effect rollback mechanism.

## Figma alignment

The [design scope audit and Deep Agents brief](planning/design-scope-and-brief.md) records material legacy-scope mismatches and missing M1 journeys. The owner authorised a separate [Agent Platform Deep Agents — Milestone One file](https://www.figma.com/design/pCoB36sHdGlhLJoy0xD2SH), now containing the first-run/OpenRouter/General Chat starting slice. This is the project-specific design source; the older file below remains a visual reference, not an authoritative feature inventory. Use the accepted requirements and milestone boundary when resolving conflicts. The new file does not yet cover every M1 state, and designs do not establish implemented behaviour.

Design file: [Agent Platform — Conversation-first MVP concepts](https://www.figma.com/design/FBQIeEoaPr1qjl4IaYevv7). Page: MVP conversation concepts (`0:1`). Metadata refreshed on 26 October 2026; Chat and Coding approval screens were inspected through design context and screenshots. Full-file design completeness is not verified.

| Design reference                                                                                                                                                                                   | Use                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Chat light, 35:197](https://www.figma.com/design/FBQIeEoaPr1qjl4IaYevv7?node-id=35-197)                                                                                                           | Conversation layout, navigation, composer and activity.                                |
| [Chat dark, 35:279](https://www.figma.com/design/FBQIeEoaPr1qjl4IaYevv7?node-id=35-279)                                                                                                            | Metadata-identified dark variant; inspect high-fidelity context before implementation. |
| [Idle composer, 34:222](https://www.figma.com/design/FBQIeEoaPr1qjl4IaYevv7?node-id=34-222)                                                                                                        | Shared input composition.                                                              |
| [Running composer, 76:586](https://www.figma.com/design/FBQIeEoaPr1qjl4IaYevv7?node-id=76-586) and [stopping composer, 76:637](https://www.figma.com/design/FBQIeEoaPr1qjl4IaYevv7?node-id=76-637) | Stop requested versus confirmed stopped.                                               |
| [Model menu, 78:1113](https://www.figma.com/design/FBQIeEoaPr1qjl4IaYevv7?node-id=78-1113)                                                                                                         | Model selection presentation; bind to actual configuration.                            |
| [Coding approval light, 259:6071](https://www.figma.com/design/FBQIeEoaPr1qjl4IaYevv7?node-id=259-6071)                                                                                            | Coding context and concise approval presentation.                                      |
| [Approval variants, 259:6066](https://www.figma.com/design/FBQIeEoaPr1qjl4IaYevv7?node-id=259-6066)                                                                                                | Pending/details/approved/completed/failed/unknown/denied; metadata confirmed.          |

The existing layouts explicitly use an Electron canvas, shadcn-style components, Geist typography, Lucide assets and semantic tokens. React/TypeScript/Vite is compatible with that presentation direction; generated reference code is not production implementation.

Reconcile earlier design wording with the newly agreed product: routine authorised reads should not prompt; model names are actual values, not hardcoded examples; a source folder differs from a sandbox working copy; Apply changes needs an explicit reviewed state. Voice remains planned, not a released feature. Onboarding, budgets, memory management, queue/inbox and runtime-download states require design coverage review; no completeness claim is made. Review only: no Figma edits were authorised by this documentation task.

## Framework reuse policy

Use supported Deep Agents configuration/abstractions and maintained integrations wherever possible. Obtain owner agreement before implementing bespoke components beyond those reuse paths. Feature approval is not blanket approval to build a custom agent loop, server protocol, persistence engine or sandbox manager. Record supported alternatives, demonstrated gaps and bounded proposals in M1-01 and affected issues; see the source/reuse map for the qualitative briefing.

## Development task management and critique

Use GitHub Issues without a Project board as the authoritative development tracker. The agent selects unblocked ready issues, records ownership, follows accepted criteria and keeps evidence/status/dependencies current. Repository specs remain requirement documents, not a competing task-status backlog. Closure requires live acceptance, C1–C4 and applicable critique/recheck; neither a PR merge nor CI green status establishes completion.

The owner authorises meaningful read-only critique agents during planning, substantial implementation/fixes and acceptance. They share existing evidence and do not create test environments or mutate reviewed work. See AGENTS.md for the operational policy.

## Deferred or unresolved

Deferred: direct spreadsheet cell editing, email/messaging notifications, automatic model switching, multiple local profiles, cross-device synchronisation, operated hosted service and Windows delivery until after macOS.

Unresolved qualification: runtime technology/distribution rights; service protocol and auth; durable local database/checkpointer; minimum hardware/OS; model shortlist and supported handoffs; exact budget enforcement limits; search provider; supported document format/feature matrix and licensing; GitHub/MCP auth and local/remote transport; installer signing/update infrastructure; subsequent feature ordering.

Proposed format/library shortlists discussed in chat are research candidates, not adopted dependencies or a guarantee of full Office compatibility. See the source map.
