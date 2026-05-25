# CapabilityKit

Capabilities as code for AI-native software teams.

CapabilityKit helps developers review what changed in product behavior, not only what changed in code. It keeps capability intent, acceptance criteria, implementation references, dependency relationships, and verification evidence in a repo-native `.capabilities/` folder so a PR can answer three questions quickly:

1. Which capabilities changed?
2. How deeply are those capabilities verified against implementation?
3. What other capabilities may be affected by this change?

## Why CapabilityKit?

AI agents can produce a lot of implementation quickly. The harder engineering problem is preserving the reason the code was written and proving that the resulting system still delivers the intended capability.

Planning documents help make code decisions, but they often diverge from implementation. After an AI agent finishes coding, the plan may no longer explain what behavior exists, which files implement it, what checks prove it works, or which downstream behavior depends on it.

CapabilityKit makes that review surface explicit. A capability file is not a one-time plan. It is a living contract between product intent, code, tests, manual review, and future agent work.

## The Developer Review Loop

Use CapabilityKit during review when a change is more meaningful than a raw code diff can explain:

```bash
npm run build
npm run capabilitykit -- status
npm run capabilitykit -- diff HEAD
npm run capabilitykit -- assess core/assessment/assess-implementation-coverage
npm run capabilitykit -- impact core/graph/compile-capabilities
```

`status` gives a project-wide health view. It separates capabilities into `ok`, `needs-review`, `needs-action`, and `planned` so reviewers know where confidence is thin.

`diff` compares capability intent against a Git base. Instead of asking reviewers to infer product meaning from YAML or code, it summarizes added, changed, and removed capabilities, highlights changes to intent, acceptance, verification, implementation references, and ignore policy, and includes downstream impact context.

`assess` reads the implementation references declared by a capability and places each acceptance criterion beside concrete source, test, or documentation evidence. It marks criteria as `covered`, `uncovered`, or `uncertain`; uncertainty is intentional because deterministic text evidence can identify review targets but cannot prove semantic correctness by itself.

`impact` traverses explicit `agent.depends_on` relationships to show direct and transitive dependents. A small edit to a foundational capability can affect agent handoff, diff reporting, CLI behavior, and verification commands; the graph makes that visible before review narrows too early.

## Dependency Viewer

CapabilityKit can generate a self-contained HTML dependency viewer with a side panel and SVG fallback:

```bash
npm run capabilitykit -- graph-viewer
```

The default local outputs are `.capabilities/dependency-viewer.html` and `.capabilities/dependency-graph.svg`. The website embeds the published viewer on the home page and keeps a browser-openable SVG copy at [capabilitykit.com/dependency-graph.svg](https://capabilitykit.com/dependency-graph.svg).

## What A Capability Captures

A capability is a repo-native description of something the system should do and how that claim is checked.

```yaml
id: account/user-login
title: User login
status: implemented
area: account
summary: Let users sign in with valid account credentials.
intent: Give returning users secure access to their account.
acceptance:
  - Users can submit an email and password.
  - Valid credentials create an authenticated session.
  - Invalid credentials show a clear error without creating a session.
guidance:
  - Keep credential errors clear without exposing sensitive details.
agent:
  depends_on:
    - account/session-management
  implementation:
    references:
      - src/auth/login.ts
      - src/auth/session.ts
      - tests/auth/login.test.ts
  verification:
    automated:
      - id: login-tests
        description: Covers valid and invalid credential flows.
        command: npm test -- tests/auth/login.test.ts
    manual:
      - Review login copy and lockout behavior against the acceptance criteria.
    gaps:
      - Add rate-limit tests before marking this verified.
```

The root fields are human-authored intent. The `agent` section contains the implementation references, dependencies, verification checks, review evidence, and accepted gaps that developers and AI agents use during follow-up work.

## Reviewing Capability Diffs

Code diffs show how files changed. Capability diffs show how declared behavior changed.

CapabilityKit reports:

- Added, changed, and removed capabilities by ID.
- Intent, summary, status, and acceptance changes.
- Implementation reference changes.
- Automated and manual verification changes.
- Verification gaps and ignore policy changes.
- Direct and transitive downstream impact.

Review evidence churn is excluded from the default diff because saved review output can be large and stale. Use `--include-review` when review evidence itself is the subject of the change.

## Assessing Verification Depth

CapabilityKit treats verification as part of the capability, not a separate checklist that gets reconstructed during PR review.

Verification depth comes from several signals:

- Acceptance criteria that are specific enough to inspect.
- Implementation references that point to real files.
- Automated checks with commands reviewers can run.
- Manual review steps for behavior that cannot be proven by tests alone.
- Saved `agent.review` evidence when a human or external agent has reviewed semantic coverage.
- Declared gaps and ignored findings with explicit reasons.

Missing confidence is visible by design. `validate`, `status`, `assess`, `advise`, `review-noisy`, `agent-review`, `review-result`, and `sync-review` all exist to help teams grow capabilities from planned intent toward properly verified behavior without pretending that filename matches or generated prose are proof.

## Understanding Impact

Capability folders help people navigate ownership, but explicit dependencies are the source of truth for impact analysis.

Use `agent.depends_on` when one capability relies on another:

```yaml
agent:
  depends_on:
    - core/model/define-capability-format
    - core/validation/validate-capability-files
```

Then run:

```bash
npm run capabilitykit -- impact core/graph/compile-capabilities
```

The report includes dependencies, direct dependents, transitive dependents, impacted capabilities, suggested automated checks, manual review steps, and known verification gaps. This is useful when a simple-looking change affects shared schema, compiled output, agent prompts, CLI behavior, or docs.

## Install

This repository is currently set up as a workspace project:

```bash
npm install
npm run build
```

The package is designed for pnpm workspaces and the CLI package is named `@capabilitykit/cli`.

In another repository, the CLI will eventually be used as:

```bash
npx @capabilitykit/cli init
capabilitykit create "User login" --area account
capabilitykit skill
capabilitykit validate
capabilitykit compile
```

## CLI Commands

- `capabilitykit init` creates a starter `.capabilities/` folder.
- `capabilitykit create <name> --area <area>` creates a capability file.
- `capabilitykit skill` creates or updates CapabilityKit skill files and agent entrypoints.
- `capabilitykit status [capability-id]` shows a developer-friendly capability health summary.
- `capabilitykit diff [base]` compares capability changes against a Git base ref.
- `capabilitykit assess <capability-id>` compares acceptance criteria with referenced implementation evidence.
- `capabilitykit advise [capability-id]` groups assessment findings into recommended next actions.
- `capabilitykit impact <capability-id>` reports direct and transitive downstream capabilities plus suggested verification.
- `capabilitykit graph` writes an interactive SVG dependency graph to `.capabilities/dependency-graph.svg`.
- `capabilitykit graph-viewer` writes the richer HTML dependency viewer and SVG fallback.
- `capabilitykit validate` validates capability files and reports verification gaps.
- `capabilitykit compile` writes normalized JSON to `.capabilities/dist/capabilities.json`.
- `capabilitykit inspect <capability-id>` prints one capability and its relationships.
- `capabilitykit review-noisy --limit 5` lists high-value capabilities for semantic Codex or human review.
- `capabilitykit agent-task <capability-id>` creates an inspectable implementation or review prompt bundle.
- `capabilitykit agent-review <capability-id>` combines a review bundle with deterministic coverage evidence.
- `capabilitykit review-result <capability-id>` validates or saves structured review JSON under `agent.review`.
- `capabilitykit sync-review [capability-id]` updates `agent.review` from current implementation evidence without changing capability status.

## Organizing Capabilities

Capability IDs should mirror the file path when a project has enough capabilities to benefit from hierarchy. For example, `.capabilities/core/validation/validate-capability-files.capability.yaml` should use `id: core/validation/validate-capability-files`.

Use folders to show ownership and maintenance boundaries:

- `core/model` for schema and format capabilities.
- `core/validation` for checks that protect capability quality.
- `core/graph` for compile-time graph, diff, and impact analysis.
- `core/assessment` for implementation coverage and review depth.
- `core/agents` for agent handoff and review workflows.
- `developer-experience/*` for CLI, examples, skills, and integrations.
- `docs/*` for user-facing and reference documentation.

Capability dependencies still belong in `agent.depends_on`. Folder hierarchy makes the map easier to scan, but explicit dependencies power impact analysis.

## Verification Gaps

CapabilityKit treats missing confidence as a first-class signal. Missing automated checks, vague acceptance criteria, broken references, missing `agent.implementation.references`, and manual review gaps are reported as verification gaps.

Gaps are warnings by default. They should be fixed or intentionally documented so humans and agents know what still needs review.

When a warning is intentionally accepted, suppress it in the capability with an explicit reason:

```yaml
agent:
  verification:
    ignore_gaps:
      - code: missing-automated-checks
        reason: Manual review is the accepted verification path for this documentation-only capability.
      - code: declared-gap
        message_contains: Known external dependency.
        reason: Tracked outside CapabilityKit for this release.
```

Advisory assessment findings can also be ignored when a maintainer accepts the deterministic assessor's limitation for a specific criterion:

```yaml
agent:
  review:
    ignore_findings:
      - status: weak-evidence
        criterion: README explains what a capability is.
        reason: Documentation wording was manually reviewed and accepted.
```

Ignored findings are removed from recommended actions and `review-noisy` scoring, but remain auditable in the capability file.

## Dogfooding

CapabilityKit uses its own `.capabilities/` folder. Current capabilities cover the schema, validation, implementation reference checks, compiled graph output, capability diffing, impact analysis, implementation coverage assessment, external agent handoff, CLI workflow, skill installation, examples, and documentation.

The project verification loop builds both workspaces, runs the test suite, validates capability files, and refreshes the compiled capability map:

```bash
npm run verify
```

Release preparation uses the same verification loop before asking for one explicit confirmation to commit, tag, and push:

```bash
npm run release:prep -- patch
```

Use `minor`, `major`, or an exact version in place of `patch` when appropriate. See [PUBLISHING.md](PUBLISHING.md) for the full release flow.

## Website

A static site is available in `website/` and is ready for Amazon S3 static hosting.

Run locally:

```bash
cd website
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
