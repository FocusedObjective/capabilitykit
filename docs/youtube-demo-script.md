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

Open a terminal in a separate todo application repository. The demo should feel
like a normal product repo, not the CapabilityKit source tree.

Suggested starting state:

- A small todo app already exists and runs locally.
- The project already has a few capability files, for example:
  - `todos/create-todo`
  - `todos/list-todos`
  - `todos/complete-todo`
- The existing capabilities have implementation references and review evidence.
- The app has at least one automated test command, such as `npm test`.
- Codex can see the CapabilityKit skill instructions, either from the installed
  CLI package at `node_modules/@capabilitykit/cli/SKILL.md` or from a copied
  project skill under `.codex/skills/capabilitykit/SKILL.md`.

Setup commands:

```bash
npm install -D @capabilitykit/cli
npx capabilitykit init
npx capabilitykit skill
```

Codex prompt:

```text
Read the CapabilityKit skill and create a new capability for filtering todos by
status. Draft only the human-authored spec first. Do not invent implementation
references or review evidence.
```

Recommended terminal commands:

```bash
npx capabilitykit status
npx capabilitykit inspect todos/create-todo
npx capabilitykit assess todos/create-todo
npx capabilitykit review todos/create-todo --no-save
npx capabilitykit create "Filter todos by status" --area todos
npx capabilitykit format
npx capabilitykit validate
npx capabilitykit compile
npx capabilitykit review todos/filter-todos-by-status --no-save
npx capabilitykit agent-task todos/filter-todos-by-status --mode implement --output tmp/filter-todos-task.md
npx capabilitykit review todos/filter-todos-by-status
npx capabilitykit create "Toggle todo list into Kanban view" --area todos
npx capabilitykit format
npx capabilitykit validate
npx capabilitykit compile
npx capabilitykit review todos/toggle-todo-list-into-kanban-view --no-save
npx capabilitykit diff --base HEAD
npx capabilitykit impact todos/list-todos
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

- Open `.capabilities/todos/create-todo.capability.yaml`.

Narration:

> This todo app already has CapabilityKit installed. A capability file is not a
> ticket. It is the durable contract for something the system should do. The
> human section says the title, status, summary, intent, and acceptance
> criteria.

Call out:

- `title`
- `status`
- `summary`
- `intent`
- `acceptance`
- `guidance`

Narration:

> The agent-maintained section records implementation references, verification
> checks, known gaps, and saved review evidence. That keeps the plan and the
> code from drifting apart silently.

### 3. Show Project Health

Command:

```bash
npx capabilitykit status
```

Narration:

> The first review question is simple: what is the health of the capability
> map? Status separates capabilities that are OK, need review, need action, or
> are still planned.

On screen:

- Show total capabilities.
- Point to `create-todo`, `list-todos`, and `complete-todo`.
- Show that existing behavior is already reviewed or OK.

Narration:

> This is already more useful than a task board because it tells us not only
> what exists, but how much confidence we have in each behavior.

### 4. Add A New Capability

Codex prompt:

```text
Use the CapabilityKit skill. Create a new capability for filtering todos by
status in this todo app. Draft the human-authored spec first, with acceptance
criteria for all, active, and completed filters. Do not add implementation
references or review evidence yet.
```

Commands:

```bash
npx capabilitykit create "Filter todos by status" --area todos
npx capabilitykit format
npx capabilitykit validate
npx capabilitykit compile
```

Narration:

> Now we add a new product behavior: filtering todos by status. At this point I
> ask Codex to use the CapabilityKit skill. The important instruction is that
> Codex writes the human-authored spec first. It should not pretend
> implementation exists yet, and it should not invent review evidence.

On screen:

- Open `.capabilities/todos/filter-todos-by-status.capability.yaml`.
- Add or show acceptance criteria:
  - The user can choose all, active, or completed todos.
  - The list only shows todos matching the selected filter.
  - Creating or completing a todo preserves the selected filter.
  - The default filter is all todos.

Narration:

> Format keeps the file in canonical shape, validate checks that the capability
> map is structurally sound, and compile refreshes the generated capability map
> other tools can consume.

### 5. Review Before Implementation

Command:

```bash
npx capabilitykit review todos/filter-todos-by-status --no-save
```

Narration:

> This review should fail, or at least come back uncertain. That is the point:
> the capability says what we want, but the code does not deliver it yet.

Call out:

- Missing implementation references.
- Acceptance criteria marked `not covered` or `uncertain`.
- Recommended next actions.

Narration:

> This is a useful failure. It tells the reviewer the new behavior is planned
> but not implemented, instead of letting a YAML file create false confidence.

### 6. Implement The Capability

Command:

```bash
npx capabilitykit agent-task todos/filter-todos-by-status --mode implement --output tmp/filter-todos-task.md
```

Narration:

> CapabilityKit can create an implementation task from the capability. The
> task gives a coding agent or developer the acceptance criteria, current
> references, and review expectations.

On screen:

- Open `tmp/filter-todos-task.md`.
- Implement the filter UI and behavior in the todo app.
- Add or update tests for all, active, and completed filters.
- Update the capability with concrete implementation references and
  verification checks.

Commands after implementation:

```bash
npm test
npx capabilitykit format
npx capabilitykit validate
npx capabilitykit compile
npx capabilitykit review todos/filter-todos-by-status
```

Narration:

> Now the review should be green because the capability, code, and tests agree.
> The saved review evidence becomes part of the repo history.

### 7. Add A Second Capability Example

Codex prompt:

```text
Use the CapabilityKit skill. Create a second capability for toggling the todo
list into a Kanban view with To do, Doing, and Done columns. Draft only the
human-authored spec first. Do not add implementation references or review
evidence yet.
```

Commands:

```bash
npx capabilitykit create "Toggle todo list into Kanban view" --area todos
npx capabilitykit format
npx capabilitykit validate
npx capabilitykit compile
npx capabilitykit review todos/toggle-todo-list-into-kanban-view --no-save
```

Narration:

> The filtering feature showed the full loop. Now I can use the same workflow
> again for a larger change: a Kanban view. The app still has the normal list
> view, but the user can toggle into columns for To do, Doing, and Done.

On screen:

- Open `.capabilities/todos/toggle-todo-list-into-kanban-view.capability.yaml`.
- Add or show acceptance criteria:
  - The user can switch between list view and Kanban view.
  - Kanban view shows To do, Doing, and Done columns.
  - Todos appear in the column matching their current state.
  - Moving a todo between columns updates its state.
  - Switching views preserves the todos and their states.

Narration:

> I would expect this one to fail review too, because it has not been
> implemented yet. That gives the team a clean, reviewable capability before
> we ask Codex or a developer to write the code.

### 8. Show A Change Breaking Existing Work

On screen:

- Make a small code change that accidentally breaks an existing behavior. For
  example, change the todo list query so completed todos disappear from the
  default `all` view, or change the complete action so it removes the item.

Command:

```bash
npm test
npx capabilitykit assess todos/list-todos
npx capabilitykit review todos/list-todos --no-save
```

Narration:

> Now I am going to make the kind of accidental regression that happens during
> normal feature work. The new filter behavior might still look fine, but an
> older capability, listing todos, has been damaged.

Call out:

- Covered criteria.
- Uncovered or uncertain criteria.
- Missing references.
- Any failing test output.

Narration:

> This is where capabilities become more than documentation. They give us named
> product behaviors to retest when code changes, and they make the regression
> understandable in product terms.

### 9. Show Capability Diff And Impact

Command:

```bash
npx capabilitykit diff --base HEAD
npx capabilitykit impact todos/list-todos
```

Narration:

> In a pull request, CapabilityKit can compare capability intent against a Git
> base. It reports added, removed, and changed capabilities. Impact answers the
> next question: if list behavior changed, what else should I retest?

Call out:

- Added `filter-todos-by-status` capability.
- Added `toggle-todo-list-into-kanban-view` capability.
- Changed implementation references or verification.
- Direct dependents.
- Transitive dependents.
- Suggested checks.
- Manual review.

Narration:

> This is how we narrow retesting. Instead of rerunning everything or guessing,
> we use the capability graph to decide what deserves attention.

### 10. Optional: Show Story Mapping

Command:

```bash
npx capabilitykit status --story-map --release todo-views
```

Browser:

- Open the generated story map viewer if the project uses one.

Narration:

> CapabilityKit also supports story-map metadata. A capability can belong to a
> release slice, backbone, and step without moving the file. That lets a team
> plan a thin slice, like todo views, while keeping every slice connected
> to implementation evidence and verification status.

Call out the `todo-views` slice:

- Create todos.
- List todos.
- Complete todos.
- Filter todos by status.
- Toggle todo list into Kanban view.

Narration:

> This is the bridge between story mapping and tests. The story map explains
> the release narrative. The capability verification tells us whether the
> delivered behavior still holds.

### 11. Close: The Workflow

Narration:

> CapabilityKit is for teams that want requirements to live with the code
> instead of drifting away from it. Capabilities are version-controlled. They
> can be diffed. They can be reviewed against implementation. They can drive
> retesting. And they help reviewers understand what a pull request should do,
> not just what files changed.

On screen:

```bash
npx capabilitykit validate
npx capabilitykit compile
npx capabilitykit graph-viewer
npx capabilitykit story-map-viewer
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
