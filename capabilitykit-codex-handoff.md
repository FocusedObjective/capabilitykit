# CapabilityKit Codex Handoff

## Project name

**CapabilityKit**

## Repository

Create the project under the FocusedObjective GitHub organization:

```text
github.com/FocusedObjective/capabilitykit
```

## Product positioning

CapabilityKit is an open-source toolkit for managing **capabilities as code** for AI-native software teams.

It helps teams define, organize, compile, validate, and evolve product/software capabilities directly inside a repository, so humans and AI coding agents work from the same source of intent.

Core idea:

> A modern software repo should not only contain code, tests, prompts, and docs. It should also contain a living capability map that describes what the system is supposed to do, how those capabilities compose, and how implementation can be verified.

## Important principle: use CapabilityKit to build CapabilityKit

This project must dogfood its own model from the first commit.

Before implementing the CLI, create a `.capabilities/` folder that describes CapabilityKit’s own capabilities.

The first capability specs should describe the project itself, including:

```text
.capabilities/
  capabilitykit.yaml
  core/
    initialize-project.capability.yaml
    define-capability.capability.yaml
    compile-capabilities.capability.yaml
    validate-capabilities.capability.yaml
    detect-verification-gaps.capability.yaml
  developer-experience/
    cli-workflow.capability.yaml
    vscode-extension.capability.yaml
    example-project.capability.yaml
  docs/
    readme.capability.yaml
    capability-format.capability.yaml
```

The first usable version of CapabilityKit should be built from these specs. Each CLI feature should have a matching capability spec before code is written. When the implementation changes, update the capability spec and validation rules with it.

## Product thesis

AI-native engineering needs a stronger source of truth than a backlog of stories or vague tickets.

Traditional backlogs describe tasks to do. CapabilityKit describes capabilities the system should have.

A capability is more durable than a story. It can contain intent, scope, dependencies, acceptance criteria, verification checks, known gaps, and an `agent` section for implementation references and review guidance.

This allows teams to replace or augment story backlogs with a capability backlog:

```text
Backlog of stories -> backlog of capabilities
Specs as documents -> capabilities as code
Errors and warnings -> verification gaps
AI code generation -> AI code generation grounded in capabilities
```

## MVP goal

Build a small but credible open-source TypeScript project that provides:

1. A CLI for creating and validating `.capabilities/` folders.
2. A YAML-based capability format.
3. A compiler that converts capability files into normalized JSON.
4. A validator that reports schema errors, missing fields, broken references, and verification gaps.
5. A dogfooded `.capabilities/` set for CapabilityKit itself.
6. Good README documentation and an example project.

Do not build a cloud product yet. Do not build a full VS Code extension yet. Prepare the package structure so those can be added later.

## Suggested package structure

Use a TypeScript monorepo with pnpm workspaces.

```text
capabilitykit/
  README.md
  LICENSE
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  .gitignore
  .capabilities/
    capabilitykit.yaml
    core/
      initialize-project.capability.yaml
      define-capability.capability.yaml
      compile-capabilities.capability.yaml
      validate-capabilities.capability.yaml
      detect-verification-gaps.capability.yaml
    developer-experience/
      cli-workflow.capability.yaml
      example-project.capability.yaml
    docs/
      readme.capability.yaml
      capability-format.capability.yaml
  packages/
    cli/
      package.json
      src/
        index.ts
        commands/
          init.ts
          create.ts
          compile.ts
          validate.ts
          inspect.ts
        utils/
    core/
      package.json
      src/
        index.ts
        loadCapabilities.ts
        parseCapability.ts
        compileCapabilities.ts
        validateCapabilities.ts
        schema.ts
        types.ts
    examples/
      basic-app/
        .capabilities/
          capabilitykit.yaml
          account/
            login.capability.yaml
            profile.capability.yaml
          checkout/
            cart.capability.yaml
            payment.capability.yaml
```

## NPM package names

Use the npm scope:

```text
@capabilitykit/cli
@capabilitykit/core
```

The CLI binary should be available as:

```bash
capabilitykit
```

And should also support usage through:

```bash
npx @capabilitykit/cli init
```

Later, consider adding an unscoped convenience package if useful:

```bash
npx capabilitykit init
```

## Tech stack

Use:

- TypeScript
- Node.js 20+
- pnpm workspaces
- tsup for builds
- vitest for tests
- zod for schemas and validation
- yaml for parsing YAML
- commander or cac for CLI commands
- eslint and prettier if quick to configure

Prefer simple dependencies. This should feel like a clean open-source developer tool, not a heavy framework.

## CLI commands for MVP

### `capabilitykit init`

Creates a `.capabilities/` folder in the current repo.

Expected behavior:

- Create `.capabilities/capabilitykit.yaml`
- Create an example capability file
- Refuse to overwrite existing files unless `--force` is passed
- Print next steps

Example:

```bash
capabilitykit init
```

Output:

```text
Created .capabilities/
Created .capabilities/capabilitykit.yaml
Created .capabilities/example.capability.yaml

Next steps:
  capabilitykit create "User login"
  capabilitykit validate
  capabilitykit compile
```

### `capabilitykit create <name>`

Creates a new capability YAML file.

Example:

```bash
capabilitykit create "User login" --area account
```

Creates:

```text
.capabilities/account/user-login.capability.yaml
```

### `capabilitykit validate`

Validates all capability files.

It should report:

- YAML parse errors
- Schema errors
- Missing required fields
- Duplicate IDs
- Broken dependency references
- Missing verification information
- Missing `agent.implementation.references` where applicable
- TODO markers or placeholder sections

Important concept:

Treat many traditional warnings as **verification gaps**.

Example output:

```text
CapabilityKit validation

✓ 8 capabilities parsed
✓ 8 unique IDs

Verification gaps:
  - core/compile-capabilities has no automated checks
  - core/validate-capability-files has no manual review guidance
  - developer-experience/cli-workflow has no agent.implementation.references

Result: valid with 3 verification gaps
```

### `capabilitykit compile`

Compiles YAML files into normalized JSON.

Default output:

```text
.capabilities/dist/capabilities.json
```

The compiled JSON should include:

- Project metadata
- Capability list
- Hierarchy/path information
- Dependency graph
- Verification summary
- Validation results or warnings

### `capabilitykit inspect <capability-id>`

Prints one capability and its relationships.

Example:

```bash
capabilitykit inspect core/validate-capability-files
```

Output should include:

- Title
- Intent
- Status
- Dependencies
- Verification checks
- Agent implementation references
- Open verification gaps

## Capability format MVP

Use YAML for the first version.

Example:

```yaml
id: core/validate-capability-files
title: Validate capability files
status: planned
area: core
summary: Validate all capability files for schema correctness, consistency, references, and verification gaps.
intent: >
  Help developers trust that their capability map is complete enough to guide human and AI implementation work.

acceptance:
  - Parses every capability YAML file in the repository.
  - Reports schema errors with file paths and line-aware messages when possible.
  - Detects duplicate capability IDs.
  - Detects broken depends_on references.
  - Detects missing or weak verification sections.

guidance:
  - Keep validation rules deterministic before adding AI-assisted suggestions.
  - Prefer actionable validation messages over abstract warnings.
  - Do not silently ignore malformed capability files.
  - Do not require a cloud service.

agent:
  inputs:
    - .capabilities/**/*.capability.yaml
  outputs:
    - validation report
    - verification gap list
  depends_on:
    - core/define-capability-format
  implementation:
    references:
      - packages/core/src/validateCapabilities.ts
      - packages/cli/src/commands/validate.ts
  verification:
    automated:
      - id: schema-validation-tests
        description: Unit tests cover valid and invalid capability YAML files.
        command: pnpm test
    manual:
      - Review validation output for a sample project and confirm it is understandable.
    gaps:
      - Line-aware YAML error reporting may be approximate in the MVP.
```

## Root config format MVP

Create:

```text
.capabilities/capabilitykit.yaml
```

Example:

```yaml
schema_version: 0.1
project:
  name: capabilitykit
  description: Capabilities as code for AI-native software teams.
  repository: https://github.com/FocusedObjective/capabilitykit

source:
  include:
    - "**/*.capability.yaml"
  exclude:
    - "dist/**"

validation:
  require_acceptance: true
  require_verification: true
  allow_verification_gaps: true
  require_implementation_references_for_status:
    - implemented
    - verified

output:
  path: .capabilities/dist/capabilities.json
```

## Capability status values

Support these statuses initially:

```text
planned
in-progress
implemented
verified
deprecated
```

Validation rules:

- `planned` can omit agent implementation references.
- `in-progress` should have either agent implementation references or verification gaps.
- `implemented` should have agent implementation references.
- `verified` should have at least one automated or manual verification item.
- `deprecated` should include replacement guidance if applicable.

## Verification gaps

Verification gaps are a first-class concept.

A verification gap is anything that prevents humans or agents from confidently knowing whether a capability is correctly implemented.

Examples:

- No automated tests
- No manual review guidance
- Ambiguous acceptance criteria
- No agent implementation references
- Broken dependency reference
- Missing owner or status
- Capability exists in code but not in `.capabilities/`
- Capability exists in `.capabilities/` but no implementation can be found
- AI-generated code changed behavior without updating capability specs

In the MVP, only implement deterministic verification gaps from capability files. Later versions can inspect code and infer gaps.

## AI-native design goals

CapabilityKit should help AI agents work better by making intent explicit.

Design the files so an AI coding agent can answer:

- What capabilities does this system have?
- Which capability am I changing?
- What dependencies might be affected?
- How do I know the change is correct?
- What tests or checks should I run?
- What manual review is still needed?
- What verification gaps remain?

## README structure

Create a strong README with this outline:

```markdown
# CapabilityKit

Capabilities as code for AI-native software teams.

## Why CapabilityKit?

AI agents can write more code faster, but teams still need a reliable way to describe what the system is supposed to do and how to verify it.

CapabilityKit adds a `.capabilities/` folder to your repo so product intent, acceptance criteria, agent-maintained implementation references, and verification checks live beside the code.

## Install

## Quick start

## What is a capability?

## Example capability file

## CLI commands

## Verification gaps

## Dogfooding: how CapabilityKit uses CapabilityKit

## Roadmap

## Contributing
```

## Initial roadmap

### Phase 0: repo bootstrap

- Create monorepo structure
- Add TypeScript build/test tooling
- Add `.capabilities/` folder for CapabilityKit itself
- Add README
- Add MIT license unless another license is preferred

### Phase 1: core parser and schema

- Define zod schemas
- Parse YAML files
- Normalize capability IDs and paths
- Unit test valid and invalid examples

### Phase 2: validation

- Validate required fields
- Detect duplicate IDs
- Detect broken `depends_on` references
- Detect verification gaps
- Return structured validation result

### Phase 3: compile

- Generate `.capabilities/dist/capabilities.json`
- Include dependency graph
- Include verification summary

### Phase 4: CLI

- Implement `init`
- Implement `create`
- Implement `validate`
- Implement `compile`
- Implement `inspect`

### Phase 5: examples and docs

- Add example app
- Add README examples
- Add dogfooding explanation

### Later: VS Code extension

Do not implement in MVP, but design toward it.

Future VS Code features:

- Tree view of capabilities
- Inline validation diagnostics
- Create capability from command palette
- Jump from capability to agent implementation references
- Suggest missing verification checks
- Show verification gaps as warnings

### Later: AI-assisted generation

Do not implement in MVP.

Future AI features:

- Suggest missing capabilities from codebase structure
- Reverse engineer capabilities from routes, tests, APIs, and UI components
- Suggest verification gaps
- Generate initial capability drafts
- Detect drift between implementation and capability specs

## Implementation requirements

Codex should implement this as production-quality open-source TypeScript.

General requirements:

- Keep code simple and well organized.
- Prefer deterministic behavior over AI calls in the MVP.
- Write tests for parser, schema validation, duplicate detection, broken references, and verification gaps.
- The CLI should return non-zero exit codes for validation failures.
- Consider verification gaps warnings by default, not hard failures, unless configured otherwise.
- Do not require network access or cloud services.
- Do not add unnecessary UI frameworks.

## First Codex task list

Start with these tasks in order:

1. Bootstrap a pnpm TypeScript monorepo.
2. Create the `.capabilities/` folder for CapabilityKit itself.
3. Write the initial capability specs for the MVP capabilities.
4. Implement `@capabilitykit/core` schemas and parser.
5. Add deterministic verification early: unit tests, validation fixtures, and CLI smoke checks should be created as features are added, not left to the end.
6. Implement `capabilitykit validate`.
7. Run validation and tests after each meaningful change so the project can evolve without relying on a human reviewer to catch regressions manually.
8. Implement `capabilitykit compile`.
9. Implement `capabilitykit init`.
10. Implement `capabilitykit create`.
11. Implement `capabilitykit inspect`.
12. Create the example project.
13. Polish README and package metadata.
14. Finish by running the full local verification loop: install, build, test, validate the dogfooded `.capabilities/`, and compile.

Verification is part of the implementation plan, not a separate cleanup phase. Every capability should say how it can be checked, and every code change should either add automated coverage or record a clear verification gap. This keeps changes safe as the project grows and reduces the human bottleneck by giving agents and maintainers concrete checks to run before asking for review.

## Suggested initial capability specs to create

Create these before implementing code:

### `core/define-capability-format`

Purpose: define the YAML schema and TypeScript types for a capability.

### `core/validate-capability-files`

Purpose: validate schema correctness, references, and verification gaps.

### `core/compile-capabilities`

Purpose: compile capabilities into normalized JSON.

### `core/detect-verification-gaps`

Purpose: identify missing or weak verification information.

### `developer-experience/cli-workflow`

Purpose: provide CLI commands for init, create, validate, compile, and inspect.

### `docs/capability-format-documentation`

Purpose: document the capability YAML format.

### `docs/readme`

Purpose: explain the project, quick start, and dogfooding model.

## Definition of done for MVP

The MVP is done when:

- `pnpm install` works.
- `pnpm build` works.
- `pnpm test` works.
- `pnpm capabilitykit validate` or equivalent validates the project’s own `.capabilities/` folder.
- `capabilitykit init` creates a starter `.capabilities/` folder in a test repo.
- `capabilitykit create "Some capability" --area example` creates a valid capability file.
- `capabilitykit compile` writes `.capabilities/dist/capabilities.json`.
- The README explains the concept clearly enough for a developer to try it.
- CapabilityKit’s own repo uses CapabilityKit to describe itself.

## Tone and positioning for docs

Use practical developer language.

Avoid sounding like UML, enterprise architecture, or heavyweight modeling.

Preferred language:

- capabilities as code
- living capability map
- verification gaps
- AI-native software engineering
- source of intent
- repo-native
- CLI-first
- works with human and AI developers

Avoid overusing:

- UML
- modeling language
- enterprise architecture framework
- methodology
- governance platform

The product should feel lightweight, useful, and close to the code.

## Future positioning notes

CapabilityKit may eventually connect to:

- PromptOpsKit for prompt and system instruction lifecycle management
- DeliveryTower for value/risk/readiness scoring of AI-generated work
- UsageTap for usage/cost signals tied to capabilities
- LLM as a Service for AI execution, routing, and context operations

Do not couple the MVP to those products. Keep CapabilityKit independently useful as an open-source project.
