# CapabilityKit YouTube Demo Script

## Video Goal

Show developers why CapabilityKit exists: requirements and acceptance should
live close to code, change with code, and give humans and coding agents a
shared way to review whether software still delivers the intended capability.

## Target Length

8 to 10 minutes.

## Audience

Engineering leaders, senior developers, and AI-assisted teams who feel Jira,
planning docs, and raw pull request diffs do not explain what the software
should do or whether it still works.

## Core Message

CapabilityKit turns product capability into a repo-native contract:

- The human-authored capability says what the system should do.
- Acceptance criteria describe what must be true.
- Implementation references point to the code, tests, and docs that support the
  capability.
- Verification records automated checks, manual review, known gaps, and agent
  review evidence.
- Diff, impact, assessment, and story-map views help reviewers understand what
  changed and what needs retesting.

## Demo Setup

Open a terminal at the repository root and keep the website open in a browser.

Recommended browser tabs:

- `website/index.html`
- `website/story-map-viewer.html`
- `website/dependency-viewer.html`

Recommended terminal commands:

```bash
node packages/cli/dist/index.js status
node packages/cli/dist/index.js diff --base HEAD
node packages/cli/dist/index.js assess core/assessment/assess-implementation-coverage
node packages/cli/dist/index.js impact core/model/define-capability-format
node packages/cli/dist/index.js status --story-map --release pr-review
```

## Script

### 1. Hook: The Problem

Narration:

> Most teams keep requirements in Jira, planning docs, or chat threads. Then
> the code changes, especially with AI agents, and reviewers are left asking
> what the pull request actually does, what it was supposed to do, and what
> might have broken.

On screen:

- Show a normal code diff or the CapabilityKit repo.
- Point out that raw code changes are not enough to explain behavior.

Narration:

> CapabilityKit is a small idea: keep capabilities close to the code, version
> them like code, and use them as the review contract between product intent,
> implementation, tests, manual review, and coding agents.

### 2. Show A Capability File

On screen:

- Open `.capabilities/core/graph/diff-capabilities.capability.yaml`.

Narration:

> A capability file is not a ticket. It is the durable contract for something
> the system should do. The human section says the title, status, summary,
> intent, and acceptance criteria.

Call out:

- `title`
- `status`
- `summary`
- `intent`
- `acceptance`
- `guidance`

Narration:

> Later, the agent-maintained section can record dependencies, implementation
> references, verification checks, known gaps, and saved review evidence. That
> keeps the plan and the code from drifting apart silently.

### 3. Show Project Health

Command:

```bash
node packages/cli/dist/index.js status
```

Narration:

> The first review question is simple: what is the health of the capability
> map? Status separates capabilities that are OK, need review, need action, or
> are still planned.

On screen:

- Show total capabilities.
- Point to planned PR-review capabilities.

Narration:

> This is already more useful than a task board because it tells us not only
> what exists, but how much confidence we have in it.

### 4. Show Capability Diff

Command:

```bash
node packages/cli/dist/index.js diff --base HEAD
```

Narration:

> In a pull request, CapabilityKit can compare capability intent against a Git
> base. It reports added, removed, and changed capabilities. That means a
> reviewer can understand what behavior changed before reading every line of
> code.

Call out:

- Added capabilities.
- Changed acceptance criteria.
- Changed verification.
- Changed implementation references.

Narration:

> The goal is not to replace code review. The goal is to give code review the
> missing "what should this do?" layer.

### 5. Show Implementation Assessment

Command:

```bash
node packages/cli/dist/index.js assess core/assessment/assess-implementation-coverage
```

Narration:

> A capability is only useful if we can compare it to implementation. Assess
> reads the referenced files and places each acceptance criterion beside
> concrete source, test, or documentation evidence.

Call out:

- Covered criteria.
- Uncovered or uncertain criteria.
- Missing references.

Narration:

> This deterministic assessment is intentionally conservative. It can find
> evidence and gaps, but it does not pretend a text match proves semantic
> correctness. For that, CapabilityKit can hand the evidence to a coding agent
> or human reviewer and save the review result.

### 6. Show Impact

Command:

```bash
node packages/cli/dist/index.js impact core/model/define-capability-format
```

Narration:

> The third review question is impact. If a foundational capability changes,
> what else might be affected? CapabilityKit follows explicit dependencies and
> collects suggested checks, manual review guidance, and known verification
> gaps across the impacted set.

Call out:

- Direct dependents.
- Transitive dependents.
- Suggested checks.
- Manual review.

Narration:

> This is how we narrow retesting. Instead of rerunning everything or guessing,
> we use the capability graph to decide what deserves attention.

### 7. Show Story Mapping

Command:

```bash
node packages/cli/dist/index.js status --story-map --release pr-review
```

Browser:

- Open `website/story-map-viewer.html`.

Narration:

> CapabilityKit also supports story-map metadata. A capability can belong to a
> release slice, backbone, and step without moving the file. That lets a team
> plan thin slices, like PR review, while keeping every slice connected to
> implementation evidence and verification status.

Call out the `pr-review` slice:

- Identify affected capabilities.
- Retest affected capabilities.
- Explain PR behavior and risk.

Narration:

> This is the bridge between story mapping and tests. The story map explains
> the release narrative. The capability verification tells us whether the
> delivered behavior still holds.

### 8. Close: The Workflow

Narration:

> CapabilityKit is for teams that want requirements to live with the code
> instead of drifting away from it. Capabilities are version-controlled. They
> can be diffed. They can be reviewed against implementation. They can drive
> retesting. And they help reviewers understand what a pull request should do,
> not just what files changed.

On screen:

```bash
node packages/cli/dist/index.js validate
node packages/cli/dist/index.js compile
node packages/cli/dist/index.js graph-viewer
node packages/cli/dist/index.js story-map-viewer
```

Final line:

> The goal is not another project management tool. The goal is to keep the
> software's intended capabilities close enough to the code that humans and
> agents can keep them true.

## Website Explanation

Use this short structure on the website:

1. Requirements drift when they live outside the repo.
2. A capability is a version-controlled behavior contract.
3. Acceptance criteria are reviewed against implementation evidence.
4. Code changes can be mapped back to affected capabilities.
5. PR review should explain changed intent, affected behavior, and required
   retesting.
6. Story maps organize capability slices without separating planning from
   delivery evidence.

