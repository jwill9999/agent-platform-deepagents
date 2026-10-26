---
name: repository-documentation
description: Maintain this repository's Markdown specifications, plans, instructions and qualification evidence. Use when behaviour or decisions change, a task closes, or repository documentation is prepared for commit or push.
---

# Repository documentation

Keep the repository's documents current with accepted decisions and verified implementation. Resolve paths from the repository root; this skill lives at `.agents/skills/repository-documentation/SKILL.md`. It does not install a machine-wide workflow or publish to Notion or another document service.

## Canonical locations

| Location                                  | Purpose                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `README.md`                               | Entry point, setup commands, current implemented boundaries and links to detailed documents. |
| `AGENTS.md`                               | Agent workflow instructions and triggers; link policies rather than duplicating them.        |
| `docs/product-specification.md`           | Accepted product requirements, stable requirement IDs and scope boundaries.                  |
| `docs/testing-strategy.md`                | Practical acceptance, C1–C4, test ownership and retention policy.                            |
| `docs/planning/milestone-1.md`            | Milestone scope, dependencies, acceptance scenarios and reviewed decisions.                  |
| `docs/planning/source-and-reuse-map.md`   | Framework/maintained integration choices, source references and bespoke-code boundaries.     |
| `docs/planning/design-scope-and-brief.md` | Design scope, Figma frame links, coverage triggers and owning issues.                        |
| `docs/planning/m1-01-qualification.md`    | Retained M1-01 component choices, concise evidence, limitations and cleanup dispositions.    |
| `docs/scaffold-verification.md`           | Historical scaffold evidence, explicitly bounded to its source revision.                     |

Use the existing canonical file before creating another. When a later milestone is agreed, place its plan in `docs/planning/milestone-<number>.md`. Add a separate task qualification record only when durable technical evidence warrants it; use `docs/planning/<task-id>-qualification.md`. Do not create one report per retry or a Markdown task board. GitHub Issues owns current status, claims and dependencies; repository documents own specifications and retained decisions. Add new canonical documents to the README's documentation links when they need discovery. Do not create empty folders or speculative templates.

## Freshness before staging

Read the root instructions, affected documents, actual source/locked dependencies and live issue state relevant to the change. Cross-reference new or changed framework claims with the relevant Deep Agents skills and current docs MCP; a wording/status correction does not require repeating unchanged research or launching the application.

Reconcile current summaries before adding files to Git. Distinguish planned, implemented, practically tested, accepted, committed, pushed and released. Record source revision and evidence limits; never turn synthetic checks into live-provider acceptance or a runtime probe into installer/sandbox acceptance. Preserve stable requirement IDs and unresolved gates. Changes to product scope or bespoke components still require the owner's agreement.

Keep historical failed probes and decisions only where they explain the outcome. Label their scope and point to the current disposition so old “pending”, “blocked” or “uncommitted” text cannot be mistaken for active instructions. Remove redundant working drafts after review under the retention policy; do not rewrite an old failure as a pass.

## Evidence and publication

Retain concise final results and necessary unresolved-failure evidence. Raw logs, traces, VM disks, synthetic databases and temporary exports belong in the task-owned external test collection described by `docs/testing-strategy.md`, not the documentation tree. Never include credentials or private prompts. A synthetic credential namespace identifies a fixture, not its secret value. Review exact disposable paths and ownership using `maintain-test-storage`; do not delete source documents or archive everything indefinitely.

Before committing, check Markdown formatting with repository tooling, local file/anchor links, cross-document consistency and the staged diff. Obtain proportionate read-only critique for substantial planning/instruction changes as required by `AGENTS.md`. Do not launch VMs, Electron or paid model calls for a documentation-only update. Report these checks as documentation validation, not product testing.

Use `commit-push-pr` for publication and respect the owner's current approval. Existing explicit commit/push authority covers routine corrections within the approved documentation scope; do not repeatedly ask for the same approval. Stage named documents and skill files, keep documentation separate from unrelated code, run hooks, and verify the pushed revision. Update affected issue references with the actual published source link when needed, preserving issue scope and history. Do not claim publication before the push succeeds, start the next task, or publish to another service implicitly.
