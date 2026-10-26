# Agent instructions

These project-specific rules apply to all work in this repository. They record the owner's testing and resource-retention decisions. They take precedence over conflicting generic skill defaults. Read the [testing and test-resource policy](docs/testing-strategy.md), [product specification](docs/product-specification.md) and [milestone plan](docs/planning/milestone-1.md) before implementation or acceptance claims.

## Framework reuse before bespoke code

Prefer supported Deep Agents/LangChain configuration and abstractions, then maintained provider, checkpoint, frontend, runtime and document integrations. Use the existing harness rather than another agent loop. Cross-check the installed version, live documentation and relevant skills before a component-level choice; a supported extension point does not mean we need to implement it ourselves.

For each task, classify work as framework configuration, maintained integration, product UI/glue, or a capability gap. Before implementing bespoke components beyond supported configuration/reuse, present the gap, supported alternatives, smallest proposed code boundary, maintenance/testing cost and a bounded qualification approach; obtain the owner's agreement. Apply this at component level, not as repeated permission for every line/function. Agreement to a feature or task does not automatically approve a custom scheduler, protocol, database/checkpointer, sandbox backend, lifecycle manager or equivalent implementation.

Do not treat the existing plan's adapter/service/wrapper names as approved bespoke designs. Evaluate compatible supported server/frontend/persistence/runtime options first, including the trade-off that hosted managed capabilities may not meet the agreed local-first requirement. Do not silently switch to hosted operation or add infrastructure to avoid a gap. The critique agent should challenge unnecessary custom work and verify the reuse decision before finalisation. Approved implementation within the documented component boundary can proceed without repeated approval.

## Independent service and future clients

Keep the agent service, harness and application contracts independent of Electron imports, renderer state and a desktop window's lifetime. Follow [P24 and the independent-service plan](docs/planning/milestone-1.md#independent-service-and-later-clients): task/run identity, persistence, approvals, allowance/concurrency admission and provider credential access belong behind the service boundary. Qualify supported SDK/server interfaces and non-Electron credential access before proposing bespoke transport or platform components. Future clients must not bypass these policies through raw framework routes.

P24 qualification must distinguish closing a macOS window from quitting the product's Electron main/helper process tree. At the assigned lifecycle/package slices, independently verify standalone service continuation and saved credential access after service restart with those owned Electron processes absent. Never stop unrelated Electron apps or application environments to manufacture this evidence. Follow the plan's slice order; a lifecycle acceptance gate does not require future features in the initial chat slice.

M1 delivers the desktop client only, with local authenticated access and independent service lifetime. CLI/mobile clients, remote pairing/connectivity and their UI/protocol qualification remain later scoped work. Apply DT-11 when either client is selected; use an interaction/command specification for CLI and appropriate Figma flows for mobile. Do not infer a new terminal-execution capability, offline mobile agent or cross-device synchronisation from the shared-service decision.

## Practical scenarios before unit tests

- Owner checkpoint, 26 October 2026: before the next practical testing phase, notify the owner and agree whether to use live API testing or manually operated testing with mocks. The owner reports the API token is not set up yet. Do not choose either mode or start its scenarios until that discussion; agree what the chosen evidence can establish. Ordinary implementation, build/typecheck/format checks and read-only review may continue. Existing live-acceptance requirements are subject to that discussion, not silently replaced by mock results.

- Implement the smallest connected behaviour, then have the agent practically exercise user scenarios through the actual application using its configured OpenRouter connection/model. Use the Electron UI when desktop behaviour matters, and verify underlying state/effects independently.
- Write the affected unit tests only after these practical scenarios pass. Do not start with unit tests or use fixture-backed success as a substitute for a live practical pass. After later changes, recheck affected practical behaviour before adding or changing its unit tests.
- Test our own code, boundaries and promised outcomes. Do not recreate tests of Deep Agents, LangChain, Electron, React or other dependencies. Exercise frameworks through our integration where needed to prove our product behaviour.
- Live, agent-operated scenarios are the mandatory acceptance gate. Green unit/E2E tests or pipelines never establish that the component works in use. After a practical pass, add only justified focused tests of our logic/defects; an extensive automated E2E suite is not a prerequisite or a replacement. Do not write tests merely to satisfy coverage or framework-testing habits.
- Real provider and fixture-backed results must be labelled separately. Missing credentials, unavailable runtime or absent live-call budget means practical acceptance is blocked, not passed. Agree finite spend/model/call limits before chargeable scenario work; never print secrets.
- Cross-reference agent decisions with the relevant Deep Agents skills and live documentation. Do not treat this session's tools/skills as automatically available in the product.

## Test VM and Electron lifecycle

Owner sequencing update, 26 October 2026: proceed with the smallest framework-based independent-service implementation; defer the custom test-launcher proposal and exhaustive controller-failure qualification. They are not prerequisites for ordinary implementation or a bounded local Node service check. Before that check, identify one owned process group/listener, use no live credentials or model calls, record teardown, and verify exit. Keep the single-environment/resource rules below. Review runtime-specific lifecycle enforcement when launching a VM/Electron and fuller practical acceptance when the relevant behaviour exists. This changes timing, not acceptance evidence or authority for bespoke components.

- Project-wide limit: two environment roles only—the normal application/development environment and one shared, reusable testing environment. This applies across tasks, branches, chats, retries and any delegated work, not one test VM per task or agent.
- At most one test VM and one owned Electron test application instance at a time. Two product tasks must be tested inside that environment, not by allocating more VMs. Do not create a third environment or retain duplicate stopped test VMs/snapshots without discussing an explicit revised limit with the owner first.
- Reuse the designated test VM/base and clean its disposable state between runs; do not create a writable disk/runtime for each scenario. Do not repurpose or stop unrelated application environments.
- Before launch, record owner/task, purpose, VM/lease and helper identities, real disk/profile/evidence paths, limits and teardown/disposal boundary. Enforce the limit in the launcher and cover our launcher lifecycle behaviour.
- Use guaranteed teardown, including failures and cancellations. Confirm owned VM, Electron and helper processes stopped. If uncertain, stop testing and reconcile ownership before replacement.
- Stopping is not storage cleanup. Once resolved and reviewed, retire disposable owned VM instances/disks and test profiles; do not retain a stockpile of inactive test VMs. The designated reusable test base/environment may remain only while actively needed for agreed testing. Any retained unresolved failure state needs an explicit owner/reason/review trigger and must not become an extra environment. No spare VM/disk stockpile.
- Never stop or delete application-owned/unrelated environments to make a test eligible. Follow the external-storage and resource-ownership rules in the testing policy.

## Temporary test files and evidence

- Keep generated reports, traces, temporary Markdown/JSON, exports and profiles in one task-owned collection with a compact manifest. Record outcome, retention reason and review trigger. Keep credentials and full private prompts out of evidence.
- After resolution and review, retire superseded reports, temporary documents and disposable runtime state using the maintain-test-storage workflow and exact owned candidate paths. Verify activity, any canonical copy and required recovery before removal. Do not infer disposability from age, extension or filename.
- Keep only compact final qualification and necessary unresolved-failure evidence. Recovery archives also need review/expiry decisions; do not replace a local backlog with permanent archives.
- This is a policy, not authorisation to sweep arbitrary existing files. User source documents, repository instructions/specifications, lockfiles, profiles and application data are not generated test waste.
- No cleanup completion claim without verified process shutdown and file/disk disposition. If cleanup is blocked, record the exact remaining paths/reason and resolve it before another environment is launched.

## Mandatory workflow checkpoints

At each task transition, apply [C1–C4 in the implementation plan](docs/planning/milestone-1.md#mandatory-task-checkpoints): C1 before testing/launch, C2 before writing or changing unit tests, C3 after each test block including failure/cancellation, and C4 before task completion. Each task inherits these acceptance criteria. Record evidence or a justified not-applicable outcome in its existing compact index. Stop at a blocked gate; do not treat missing evidence, unknown teardown or deferred required cleanup as passed.

## Design coverage triggers

At task selection, milestone planning and any change to a user-visible flow, read the [design trigger matrix](docs/planning/design-scope-and-brief.md#design-coverage-triggers). Identify the applicable trigger before coding; put its missing states, owning issue and required Figma references in that issue. The current design source is [Agent Platform Deep Agents — Milestone One](https://www.figma.com/design/pCoB36sHdGlhLJoy0xD2SH), not the older platform's feature inventory.

Before implementing an affected UI flow, add/update the required designs in the current file, cross-reference the accepted specification and current Deep Agents docs/skills, obtain meaningful independent critique and address findings. Record exact frame links, reviewed state coverage and a passed/blocked/justified-not-applicable design-gate disposition in the issue. Existing starter screens are not proof that the whole feature is designed. A gap blocks the affected UI implementation; it does not block independent runtime/reuse research or justify expanding scope.

When runtime qualification or implementation evidence changes a user-facing assumption, update the affected design before proceeding with that UI. At C4 and before milestone acceptance, check design/application alignment and carry any later agreed work into linked GitHub tasks with explicit triggers; never leave it only in chat. Creating a design trigger does not add a feature, choose the next milestone or authorise all future designs now. Within an already agreed task/feature boundary, perform routine design completion without repeatedly asking permission; ask only about unresolved material product, visual-direction or bespoke-component decisions. These are agent workflow checkpoints, not a scheduled watcher or implemented enforcement service.

## GitHub Issues development workflow

- GitHub Issues is the sole development tracker, without a Project board or Beads. Do not initialise Beads or maintain a parallel status backlog in Markdown. Repository specs describe requirements; issues own live status, ownership, dependencies and evidence. The product runtime queue is separate.
- Before selecting work, refresh live issues, native blocked-by dependencies and current source state. Read the milestone/spec, design triggers and issue acceptance criteria; choose the earliest unblocked `status:ready` issue. Check that prerequisites are genuinely accepted, not merely merged or labelled done. At milestone completion, re-evaluate linked follow-on planning tasks as well as implementation dependants; do not automatically start an unagreed feature milestone.
- Claim the issue before implementation: record the acting agent/chat identity and branch in a concise issue comment, set `status:in-progress` and check for another active claim. Do not assign the human owner as a stand-in for agent ownership. If ownership is contested, resolve it before work; the shared test-environment lease is still required separately.
- Maintain one current status label: `status:ready`, `status:in-progress`, `status:practical-verification` or `status:blocked`; closed issues represent Done. Record blocker reasons, evidence and next step. On predecessor closure, re-evaluate dependants before marking ready; native links do not implement this policy automatically.
- The agent maintains tasks and follows accepted criteria, but must not weaken them, add environments or enlarge product scope to unblock itself. Ask about material owner decisions; routine evidence/status updates within authorised work need no repeat approval.
- Every issue inherits C1–C4. Close only when applicable criteria, live practical outcomes, cleanup and required critique/rechecks pass; justify not-applicable entries. A PR merge or green pipeline is insufficient. Avoid automatic closing keywords before acceptance; link PRs without prematurely closing issues.
- Keep only concise task evidence/dispositions in issue updates. Update the specification and dependency links together when an authorised change affects them. Document tracker/API capability gaps rather than claiming an operation succeeded.

## Independent critique

The owner authorises use of critique agents whenever useful for a second opinion and gap detection. Use the critique-plan skill for plans, and an appropriately scoped source-aware review for implementation. Obtain read-only review before finalising substantial plans/task breakdowns, after substantial implementation/fixes and before milestone acceptance; use judgement to avoid duplicate reviews of trivial unchanged work.

The reviewer must inspect actual source/specifications and evidence, report a verdict with stable finding IDs/severity and feasible corrections, and remain read-only. No extra VM, test environment, model calls, installations or external writes are implied. Share existing compact evidence. This procedural role is not technical tool isolation. Do not delegate implementation under this review authorisation.

Address actionable findings; independently recheck changed semantics before finalising. Record original findings, reviewed source identity and dispositions in the existing task/plan record, without accumulating separate review reports. A review verdict does not replace live acceptance, grant publication authority or decide reserved product choices. If a reviewer is unavailable, explicitly report review pending rather than inventing approval.

## Repository documentation

Use the repository-local [repository-documentation skill](.agents/skills/repository-documentation/SKILL.md) when changing requirements, plans, implementation descriptions or evidence; at task closeout; and before staging documentation for commit/push. It defines canonical locations, freshness checks and evidence retention. Reconcile current facts first, preserve clearly labelled historical evidence, and follow the existing publication checkpoint. This is a repository skill, not a machine-wide installation or external-document synchronisation.

## Delivery

Owner checkpoint: until the owner agrees the system is in place and the testing strategy is reliable, discuss what was tested, observed results, untested behaviour and confidence before each commit or push. Obtain the owner's go-ahead after that discussion. Passing checks or critique does not waive this checkpoint, and prior publication instructions do not cover a later testing block. The owner decides when to retire it.

Current priority: M1-01 has been accepted and closed. Keep repository documentation current at closeout and before publication. Configured OpenRouter connection/live testability is the next task priority; refresh its live prerequisites and claim before implementation. Synthetic checks do not substitute for a configured-agent practical pass. Avoid infrastructure work that does not unblock that path. Use an agreed local credential path, never chat, and agree model/call/spend limits before live calls.

Use the repository's npm lockfile/scripts, feature branches and Conventional Commits. Use the commit-push-pr skill for committing/pushing. Report practical passes, later regression results, implementation, review, packaging and release as distinct states. Do not infer implementation, paid-run or publication authority from a planning document.

## Integration and CI workflow

Use `staging` as the integration baseline and `main` as the release baseline. Work on `jwill9999/` task branches and target staging for normal task PRs; do not push directly to staging/main. Check the actual remote state before branching: this policy does not itself integrate existing work or enable GitHub branch protection. Promote to main only after agreed functional acceptance and owner authorisation.

The CI job `check` installs the lockfile and runs type checks, builds and formatting. Keep it free of provider credentials, live model calls and application VM/Electron launches. Green CI is supporting evidence only and does not waive C1–C4 or practical acceptance. Before publication run `npm run check`; verify hosted CI for the pushed revision and report branch protection separately. Existing commit/push/merge approval boundaries remain in force.

SonarQube Cloud is a separate source-analysis/quality gate. Never bypass a failing gate with fake coverage, blanket coverage exclusions or `continue-on-error`; discuss any mismatch with the practical-before-unit-test policy. The secret-backed job excludes fork/Dependabot PRs, so a skipped scan is not acceptance. Verify the configured Sonar baseline and successful analysis before requiring the job in branch protection.
