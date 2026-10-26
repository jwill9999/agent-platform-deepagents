# Testing and test-resource policy

Status: owner-agreed project rules. Recorded 26 October 2026. Applies to the [product specification](product-specification.md) and [milestone one](planning/milestone-1.md); enforced through [AGENTS.md](../AGENTS.md). This policy changes development testing, not the product's preservation-first treatment of user work.

## Acceptance authority

A component is accepted only after the agent practically operates the live application, using the configured OpenRouter agent where model-backed behaviour is involved, and verifies actual outcomes. Automated unit/E2E suites and pipeline results are supporting regression signals, never evidence that overrides a failing or missing practical scenario. This policy reflects the owner’s prior experience of green pipelines while the application did not work. It does not claim that a finite manual run proves every future condition.

## Transition checkpoints

Completed M1-01 authorisations: local synthetic service/SQLite checks, a separately approved temporary synthetic Keychain entry and one bounded temporary Lima VM. The qualification record documents their outcomes and verified cleanup. These approvals do not authorise real credential access, provider calls or another environment. Prioritise the OpenRouter connection and agree the next practical testing scope before launch.

Until the owner agrees the system and testing strategy are reliable, discuss test scope, observed outcomes, remaining gaps and confidence before each commit or push, and obtain the owner's go-ahead. No automatic publication follows a passing test block or critique. The owner decides when this temporary checkpoint can be removed.

Owner checkpoint added 26 October 2026: notify the owner before the next practical testing phase and discuss live testing with an API token versus manually operated testing with mocks. The API token is not yet set up, as reported by the owner. M1-01 subsequently used explicitly approved synthetic infrastructure checks; a live-provider mode for M1-02 has not been selected or authorised. Agree the mode, scenarios and what their evidence can establish before running them; agree model/call/spend limits if live testing is selected. Implementation, build/typecheck/format checks and read-only review can continue. This decision checkpoint takes precedence over the earlier automatic practical-testing sequence below; it does not itself declare mocks equivalent to live acceptance.

The [implementation plan’s mandatory C1–C4 checkpoints](planning/milestone-1.md#mandatory-task-checkpoints) are inherited task acceptance criteria: check before launching tests, before writing/changing unit tests, after every test block and before task closure. Keep dispositions in the existing task index. Justify not-applicable checks; blocked or unknown applicable checks prevent progression/closure.

## Required sequence

1. Define practical scenarios and observable outcomes before implementation. Include the happy path and relevant failure, Stop, approval, recovery and persistence behaviour. Defining scenarios is not writing unit tests.
2. Build the smallest connected slice. Builds, type checking, formatting and narrowly necessary infrastructure/ownership probes may run throughout; they are not a practical product pass.
3. Have the agent operate the real application using the configured OpenRouter connection and selected model. A direct SDK demo does not establish desktop behaviour. For an agent feature, let the configured product agent actually perform the requested task rather than replacing it with a scripted answer.
4. Independently inspect the resulting files, persisted records, service state, process termination or other promised effects. Fix observed defects and repeat only affected scenarios until they pass. Record failures honestly and bound retries/costs.
5. Only after the affected practical scenarios pass, write meaningful focused unit tests for our code and regression tests for our observed defects/contracts. Automate only where repeatability adds value; do not make a large E2E suite a separate acceptance requirement. Playwright may operate the live UI during practical testing, but a fixture-backed scripted pass is not a live configured-agent pass. Prefer a small useful suite over blanket coverage.
6. Run those checks and review the result. If the source changes materially after a practical pass, rerun affected practical scenarios before adding/changing unit tests for that behaviour or claiming completion.
7. Stop owned test processes and retire resolved disposable test data under the lifecycle policy. Record both behavioural outcome and cleanup disposition.

Apply this per connected slice, not by withholding every unit test until the entire product ships. When runtime/credentials/budget are missing, report the blocked practical gate. Fixture runs may aid diagnosis, but do not unlock the unit-test stage by being relabelled as live acceptance. Non-agent infrastructure should be exercised practically through its real entry points; do not spend model calls merely to test formatting or a download checksum.

The generic verify-e2e-quality skill still informs scenario quality, real UI coverage and regression evidence. Where it suggests automated tests alongside implementation, this owner's explicit practical-first/unit-later order takes precedence. No TDD requirement is introduced.

## Test our code, not framework internals

Useful targets: our permission policy, task queue/admission, allowance accounting, provider adapter/configuration, stream-to-state handling, cancellation, service lifecycle, persistence mappings/migrations, IPC validation, memory scoping, file transfers and Apply changes conflicts.

Not useful: recreating upstream agent-loop tests, asserting React/Electron internals, validating a library's arithmetic in isolation or counting tests/coverage without a promised behaviour. Checking that our adapter actually cancels a framework-backed run is an integration test of our contract, not redundant framework testing.

Use real framework/runtime code in connected scenarios. After the practical gate, provider fixtures can make our error/retry/accounting regression checks deterministic and avoid repeated paid calls. Distinguish live-provider evidence from external fixtures, fault injection and untested combinations; neither one proves the other.

## Practical scenario record

Use one compact index per task, not another report per retry. Record source/build/lockfile identity, date, scenario, configured provider/model and effective identity where observable, allowance/call cap, actions, independent postcondition, outcome, fixture/live classification and evidence paths. Reference credentials without values; do not copy full private prompts or raw secret-bearing responses.

A passing live text response does not prove tool use, document generation, model handoff or recovery. Add those practical journeys only when their feature is implemented. Run failing paths through actual application controls; use controlled fault injection when a real outage is unsafe or impractical, and label it.

## Independent-service evidence

For P24, follow the [plan's assigned practical scenarios](planning/milestone-1.md#practical-acceptance-scenarios-and-selective-regression-coverage). A closed window does not prove that Electron has exited. Verify the task-owned product main/helper process tree is absent while the independent service retains its identity and task state; reopen the desktop without duplicate dispatch. Verify saved credential resolution after service restart with Electron absent, using a non-generation authentication check separately from any authorised live generation. A key already cached in memory is insufficient evidence of durable credential access. M1-01 can qualify infrastructure with non-secret fixtures; M1-02 delivers the real configured connection and M1-06–M1-08 qualify lifecycle/package behaviour. Preserve practical-before-unit sequencing, the single shared test environment, compact evidence and ownership/cleanup requirements. No additional product CLI or mobile client is needed for these checks.

## VM, Electron and process limits

The project has two environment roles only:

1. The normal application/development environment being built.
2. One designated, shared and reusable testing environment.

This is a project-wide limit across branches, chats, tasks, retries and delegated work—not permission for every task to create its own test VM. At most one test VM and one owned Electron test application instance are active at a time. Helpers belong to that instance and must be tracked/stopped. The product's two concurrent tasks are exercised within the designated environment. Do not allocate another VM for a retry, scenario, agent or simultaneous task. Any proposed third environment or concurrent-instance exception must be discussed with the owner before allocation; no standing exception is implied.

Reuse the designated test instance and immutable base. Record owner/task/lease, purpose, launcher/helpers, real disk/profile/evidence paths, expected end and exact disposable outputs before launch. A shared lease and launcher limit must prevent two chats from each allocating a test VM. An instruction alone is not enforcement. The designated reusable environment can remain between blocks only for an active agreed testing purpose; stop its processes when not in use. Retire it when that purpose ends. Do not accumulate stopped VMs, snapshots or writable clones under a reuse label.

Put shutdown in guaranteed teardown. Verify VM/helper/application termination even after a failed/cancelled test. Do not start a replacement if shutdown or ownership is uncertain. Do not stop unrelated application instances or services.

Prefer the owner-configured external development storage for bulky disks/reports. Record actual paths and aliases; if a required external mount is missing, stop rather than allocating replacement disks in the home directory.

At block completion, stop the owned environment. Once the outcome is resolved and reviewed, retire its disposable writable disks/runtime/profile; stopping a VM alone does not satisfy cleanup. Keep inactive state only for an explicit active investigation/recovery requirement, with owner, reason and review trigger, without expanding the two-environment limit. Keep the designated reusable base separately identified; a new retained failure disk is not permission to create a replacement VM.

## Retention and cleanup

Generated test Markdown/JSON, intermediate exports, repeated preflights, traces, screenshots, archives and profiles share the same task collection. Do not scatter them across Documents/Downloads or add a new standalone report for every retry.

After resolution and review, select the exact obsolete/disposable files from the manifest and use the maintain-test-storage audit/retirement workflow. Existing manifest-scoped disposal authorisation may be reused; arbitrary older files are not implicitly authorised. Verify no active/open handles, protect source/user data, and verify the canonical location/digest before retiring duplicate evidence. Follow required recovery/archive checks; a blocked prerequisite is not permission to bypass them.

Retain compact final acceptance results and the smallest necessary evidence for unresolved failures. Track recovery archives' retention/review separately so they do not become a permanent second backlog. Source specs, instructions, source code, lockfiles and user documents are not disposable because they are Markdown/JSON. Product retention/deletion policies remain separate.

Cleanup is part of finishing the task, not an optional future maintenance project. Before final handoff, account for every owned temporary disk/profile/report. End each test block with a disposition: processes stopped, disposable outputs removed/retired, final evidence retained at exact paths, and any blocked retained items with reasons/review triggers. Resolve uncertain teardown before more environment launches. Old storage needs its own read-only inventory and exact scoped retirement; this policy update deletes nothing.

## First milestone application

The live-first General Chat scenarios cover configured OpenRouter setup, streamed response, Stop, persisted follow-up after restart, desktop reconnect to continuing work and explicit Resume after service interruption. Exercise concurrency/allowance through our real service and UI, using controlled delays/errors as necessary. Establish a bounded live practical pass per affected slice before its unit tests; then retain deterministic regression coverage for our scheduling, state, usage and failure handling.

The existing scaffold smoke check proves only shell loading and renderer isolation; it is not a configured-agent scenario pass. Hosted CI/unit results cannot be substituted for the practical gate.

## Early-phase Sonar coverage decision

On 26 October 2026 the owner authorised temporarily removing only this project's 80% coverage condition, while preserving security, reliability, maintainability and other quality checks. The signed-in SonarCloud project settings then showed that the current plan permits only the built-in Sonar way gate, so the authorised custom gate cannot currently be applied. Coverage remains visible and the built-in gate remains enforced; no purchase, broad coverage exclusion, invented report or whole-gate bypass is authorised by that decision.

Revisit the coverage threshold when the first meaningful tests of our code are added after practical acceptance, and no later than the M1 acceptance review. At that point agree an appropriate threshold with the owner, report actual coverage and verify the selected gate in Sonar. Until then, report a coverage-only gate failure explicitly rather than treating it as a product failure or a pass. The plan constraint and its disposition must be resolved before claiming all PR checks pass. The trigger belongs to M1-02's C2 and milestone C4 review, not a separate testing programme.

CI-only validation on 26 October 2026: a fresh task-owned source copy on the configured external volume ran `npm ci --ignore-scripts --no-audit --no-fund` followed by `npm run check` under Node 24.14.0; installation, type checks, builds and formatting passed. No service, VM, Electron or provider call was launched. The temporary source/dependency/build collection was removed on completion. Read-only critique approved the limited CI change; native runtime qualification is unaffected and not established by this check.
