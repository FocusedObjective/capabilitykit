---
name: capabilitykit
description: Work with CapabilityKit capabilities as code. Use when creating, editing, validating, compiling, reviewing, or comparing .capability.yaml files against implementation references.
---

# CapabilityKit

Use CapabilityKit to keep product intent, acceptance criteria, implementation references, and verification checks close to the code.

## Workflow

1. Read `.capabilities/capabilitykit.yaml` to understand project settings.
2. Read the relevant `*.capability.yaml` files before editing code for that behavior.
3. When behavior changes, update the matching capability spec in the same change.
4. Run `capabilitykit validate` to catch schema, dependency, verification, and implementation-reference gaps.
5. Run `capabilitykit compile` to update `.capabilities/dist/capabilities.json`.

## Implementation Review

When asked whether a capability matches implementation behavior:

1. Treat the capability file as the source of truth.
2. Inspect every path in `implementation.references`.
3. Compare each acceptance criterion with concrete code, test, or documentation evidence.
4. Report each criterion as `covered`, `partially covered`, `not covered`, or `uncertain`.
5. Do not infer coverage from filenames alone.
6. Recommend the smallest code, test, or capability-spec change for each gap.

## Useful Commands

```bash
capabilitykit create "User login" --area account
capabilitykit validate
capabilitykit inspect account.login
capabilitykit compile
capabilitykit install-agent-guidance
```
