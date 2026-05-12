# CapabilityKit

Capabilities as code for AI-native software teams.

## Why CapabilityKit?

AI agents can write more code faster, but teams still need a reliable way to describe what the system is supposed to do and how to verify it.

CapabilityKit adds a `.capabilities/` folder to your repo so product intent, acceptance criteria, human guidance, implementation review notes, and verification checks live beside the code.

The practical goal is to reduce the human bottleneck in review. Humans should not have to rediscover intent or manually invent every regression check after each AI-assisted change. Capability specs make the expected behavior and required verification visible before code changes start.

## Install

This repository is currently set up as a workspace project:

```bash
npm install
npm run build
```

The package is designed for pnpm workspaces and the CLI package is named `@capabilitykit/cli`.

## Quick Start

```bash
npm run build
npm run capabilitykit -- validate
npm run capabilitykit -- compile
```

In another repository, the CLI will eventually be used as:

```bash
npx @capabilitykit/cli init
capabilitykit create "User login" --area account
capabilitykit skill
capabilitykit validate
capabilitykit compile
```

## What Is A Capability?

A capability is a repo-native description of something the system should do. The default format keeps human-authored intent and guidance at the root of the file and puts implementation details, dependencies, and verification that agents can infer or maintain under `agent`.

Capability IDs should mirror the file path when a project has enough capabilities to benefit from hierarchy. For example, `.capabilities/core/validation/validate-capability-files.capability.yaml` should use `id: core/validation/validate-capability-files`.

Use folders to show ownership and maintenance boundaries:

- `core/model` for schema and format capabilities.
- `core/validation` for checks that protect capability quality.
- `core/graph` for compile-time graph and impact analysis.
- `core/agents` for agent handoff and review workflows.
- `developer-experience/*` for CLI, examples, skills, and integrations.
- `docs/*` for user-facing and reference documentation.

Capability dependencies still belong in `agent.depends_on`. Folder hierarchy makes the map easier to scan, but explicit dependencies are the source of truth for impact analysis.

## Example Capability File

```yaml
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
  verification:
    manual:
      - Review login behavior against the acceptance criteria.
  implementation:
    references:
      - src/auth/login.ts
      - src/auth/session.ts
  review:
    depth: partial
    gaps:
      - Add automated tests for invalid credentials.
```

## CLI Commands

- `capabilitykit init` creates a starter `.capabilities/` folder.
- `capabilitykit create <name> --area <area>` creates a capability file.
- `capabilitykit skill` creates or updates CapabilityKit skill files and agent entrypoints.
- `capabilitykit status [capability-id]` shows a developer-friendly capability health summary.
- `capabilitykit validate` validates capability files and reports verification gaps.
- `capabilitykit compile` writes normalized JSON to `.capabilities/dist/capabilities.json`.
- `capabilitykit inspect <capability-id>` prints one capability and its relationships.
- `capabilitykit impact <capability-id>` reports direct and transitive downstream capabilities plus suggested verification.
- `capabilitykit diff [capability-id]` compares capability changes against a Git base ref.
- `capabilitykit assess <capability-id>` compares acceptance criteria with referenced implementation evidence.
- `capabilitykit advise [capability-id]` groups assessment findings into recommended next actions.
- `capabilitykit review-noisy --limit 5` lists high-value capabilities for semantic Codex or human review.
- `capabilitykit sync-review [capability-id]` updates `agent.review` from current implementation evidence without changing capability status.

`status` is the best first command when you want to understand what the
capability map says about the project:

```bash
capabilitykit status
capabilitykit status core/graph/compile-capabilities
capabilitykit diff --base HEAD
capabilitykit diff --base HEAD --verbose
```

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

Use `code: "*"` only when every verification gap for that capability is intentionally handled elsewhere.

Advisory assessment findings can also be ignored when a maintainer accepts the
deterministic assessor's limitation for a specific criterion. Ignored findings
are removed from recommended actions and `review-noisy` scoring, but remain
auditable in the capability file:

```yaml
agent:
  review:
    ignore_findings:
      - status: weak-evidence
        criterion: README explains what a capability is.
        reason: Documentation wording was manually reviewed and accepted.
```

Use `criterion_contains` for a small family of related findings, and `status: "*"` only for intentionally accepted findings across statuses.

## Dogfooding

CapabilityKit uses its own `.capabilities/` folder from the first usable version. Each MVP feature has a matching capability spec, and the project verification loop validates and compiles those specs.

## Roadmap

- Bootstrap the TypeScript CLI and core library.
- Strengthen validation and verification gap detection.
- Add richer examples and documentation.
- Prepare for editor integrations without making the MVP dependent on them.

## Contributing

Keep changes close to the code, specs, and tests they affect. When behavior changes, update the relevant capability spec and run the local verification loop:

```bash
npm run verify
```

## Website (capabilitykit.com)

A simple static marketing site is available in `website/` and is ready for Amazon S3 static hosting.

Run locally:

```bash
cd website
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
