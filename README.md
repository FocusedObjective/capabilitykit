# CapabilityKit

Capabilities as code for AI-native software teams.

## Why CapabilityKit?

AI agents can write more code faster, but teams still need a reliable way to describe what the system is supposed to do and how to verify it.

CapabilityKit adds a `.capabilities/` folder to your repo so product intent, implementation references, dependencies, acceptance criteria, and verification checks live beside the code.

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
capabilitykit validate
capabilitykit compile
```

## What Is A Capability?

A capability is a repo-native description of something the system should do. It can include intent, scope, dependencies, acceptance criteria, implementation references, verification checks, and known gaps.

## Example Capability File

```yaml
id: core.validate-capabilities
title: Validate capability files
status: implemented
area: core
summary: Validate capability files for schema correctness, references, and verification gaps.
intent: Help developers and agents know whether the capability map is trustworthy.
inputs:
  - .capabilities/**/*.capability.yaml
outputs:
  - validation report
depends_on:
  - core.define-capability
acceptance:
  - Reports schema errors.
  - Detects duplicate capability IDs.
  - Detects broken dependency references.
  - Detects missing verification information.
verification:
  automated:
    - id: validation-tests
      description: Unit tests cover validation behavior.
      command: npm test
  manual:
    - Run capabilitykit validate and confirm the report is understandable.
implementation:
  references:
    - packages/core/src/validateCapabilities.ts
    - packages/cli/src/index.ts
```

## CLI Commands

- `capabilitykit init` creates a starter `.capabilities/` folder.
- `capabilitykit create <name> --area <area>` creates a capability file.
- `capabilitykit validate` validates capability files and reports verification gaps.
- `capabilitykit compile` writes normalized JSON to `.capabilities/dist/capabilities.json`.
- `capabilitykit inspect <capability-id>` prints one capability and its relationships.

## Verification Gaps

CapabilityKit treats missing confidence as a first-class signal. Missing automated checks, vague acceptance criteria, broken references, missing implementation references, and manual review gaps are reported as verification gaps.

Gaps are warnings by default. They should be fixed or intentionally documented so humans and agents know what still needs review.

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
