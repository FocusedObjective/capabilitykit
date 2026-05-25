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

## Creating capability files

When asked to create a new capability file from product intent, write only the
human-authored spec by default:

- `title`
- `status`
- `summary`
- `intent`
- `acceptance`
- optional `guidance`
- optional `replacement`

Do not invent `agent.inputs`, `agent.outputs`, implementation references,
verification checks, dependencies, review results, or other agent metadata while
drafting a new capability. Add an `agent` section only when it comes from
concrete implementation evidence, an explicit dependency relationship, or a
real verification/review workflow.

After creating or editing capability files:

1. Run `capabilitykit format` to apply canonical ordering and refresh comments
   on any existing agent section.
2. Run `capabilitykit validate` to check schema, dependency, verification, and
   implementation-reference gaps.
3. Run `capabilitykit compile` to update the configured compiled capability map.
4. Use `capabilitykit review <capability-id>` when implementation evidence or
   code-review metadata should be generated and saved. Add `--agent codex` for
   semantic coding-agent review, or `--no-save`/`--dry-run` when you only want
   to inspect the result.

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
capabilitykit review account/user-login
capabilitykit review account/user-login --agent codex --handoff stdin
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
capabilitykit review core/example
capabilitykit review core/example --no-save
capabilitykit review core/example --agent codex --handoff stdin
capabilitykit review core/example --agent codex --handoff stdin --no-save
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
capabilitykit review-result core/example --input tmp/review.json --no-save
capabilitykit agent-run core/example --command codex --arg exec --handoff stdin --mode implement --dry-run
```

- `review` is the recommended happy path; it saves `agent.review` by default.
- `review --no-save` validates or previews review output without writing.
- `review --deterministic-only` uses the local deterministic assessor even when
  an agent command is available.
- `review --agent <command>` runs semantic coding-agent review and saves valid
  structured output by default.
- `assess` produces deterministic criterion-by-criterion implementation evidence.
- `advise` turns coverage findings into grouped recommended actions and confidence notes.
- `status` summarizes the capability map into ok, needs-review, needs-action, and planned buckets.
- `diff` compares current capability intent against a Git base and summarizes added, changed, or removed capabilities.
- `review-noisy` lists high-value capabilities for semantic human or Codex review.
- `sync-review` updates `agent.review` from deterministic implementation evidence while leaving status and gaps explicit.
- `impact` reports direct and transitive downstream capabilities plus suggested verification.
- `agent-task` creates an inspectable implementation or review prompt bundle.
- `agent-review` combines a review bundle with the deterministic coverage report.
- `review-result` saves valid structured review JSON under `agent.review` by
  default; use `--no-save` to validate without writing.
- `agent-run` executes an external CLI with stdin, argument, or prompt-file handoff.
