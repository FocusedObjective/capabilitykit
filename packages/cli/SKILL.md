---
name: capabilitykit
description: Work with CapabilityKit capabilities as code. Use when creating, editing, validating, compiling, reviewing, or comparing .capability.yaml files against agent.implementation.references.
---

# CapabilityKit

Use CapabilityKit to keep product intent, acceptance criteria, agent-maintained implementation references, and verification checks close to the code.

## Human-owned vs derived fields

- Human-authored capability content should focus on: `title`, `status`, `summary`, `intent`, `acceptance`, optional `guidance`, optional `agent`, and optional `replacement`.
- `id` and `area` are derived from the capability file path and should normally be omitted from YAML files.
- Run `capabilitykit format` to remove non-custom `id`/`area` fields and keep canonical section order.
- `capabilitykit validate` reports warnings when explicit `id` or `area` fields are present.

## Workflow

1. Read `.capabilities/capabilitykit.yaml` to understand project settings.
2. Read the relevant `*.capability.yaml` files before editing code for that behavior.
3. When behavior changes, update the matching capability spec in the same change.
4. Run `capabilitykit validate` to catch schema, dependency, verification, and implementation-reference gaps.
5. Run `capabilitykit compile` to update the configured compiled capability map.

## Implementation Review

When asked whether a capability matches implementation behavior:

1. Treat the capability file as the source of truth.
2. Inspect every path in `agent.implementation.references`.
3. Compare each acceptance criterion with concrete code, test, or documentation evidence.
4. Report each criterion as `covered`, `partially covered`, `not covered`, or `uncertain`.
5. Do not infer coverage from filenames alone.
6. Recommend the smallest code, test, or capability-spec change for each gap.

## Useful Commands

```bash
capabilitykit create "User login" --area account
capabilitykit validate
capabilitykit status
capabilitykit status core/example
capabilitykit inspect account/user-login
capabilitykit impact account/user-login
capabilitykit diff --base HEAD
capabilitykit diff account/user-login --base main
capabilitykit diff --base HEAD --verbose
capabilitykit assess account/user-login
capabilitykit advise account/user-login
capabilitykit review-noisy --limit 5
capabilitykit sync-review account/user-login --dry-run
capabilitykit compile
capabilitykit skill
```

## Review and Agent Commands

Use these commands when assessing implementation coverage or handing work to an
external coding agent:

```bash
capabilitykit assess core/example
capabilitykit assess core/example --json
capabilitykit advise
capabilitykit advise core/example --json
capabilitykit review-noisy --command codex --limit 5
capabilitykit sync-review core/example
capabilitykit agent-task core/example --mode implement --output tmp/capability-task.md
capabilitykit agent-task core/example --mode review --no-references
capabilitykit agent-review core/example --command codex --arg exec --handoff stdin --dry-run --no-references
capabilitykit review-result core/example --input tmp/review.json
capabilitykit review-result core/example --input tmp/review.json --save
capabilitykit agent-run core/example --command codex --arg exec --handoff stdin --mode implement --dry-run
```

- `assess` produces deterministic criterion-by-criterion implementation evidence.
- `advise` turns coverage findings into grouped recommended actions and confidence notes.
- `status` summarizes the capability map into ok, needs-review, needs-action, and planned buckets.
- `diff` compares current capability intent against a Git base and summarizes added, changed, or removed capabilities.
- `review-noisy` lists high-value capabilities for semantic human or Codex review.
- `sync-review` updates `agent.review` from deterministic implementation evidence while leaving status and gaps explicit.
- `impact` reports direct and transitive downstream capabilities plus suggested verification.
- `agent-task` creates an inspectable implementation or review prompt bundle.
- `agent-review` combines a review bundle with the deterministic coverage report.
- `review-result` validates or saves structured review JSON under `agent.review`.
- `agent-run` executes an external CLI with stdin, argument, or prompt-file handoff.
