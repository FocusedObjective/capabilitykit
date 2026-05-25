import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatCapabilityStatusReport, summarizeCapabilityStatus } from "../src/capabilityStatus.js";

const tempDirs: string[] = [];

async function createProject(capabilities: Record<string, string>): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-status-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: status-test
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
`
  );

  await Promise.all(
    Object.entries(capabilities).map(([name, source]) =>
      writeFile(path.join(rootDir, ".capabilities", "core", `${name}.capability.yaml`), source)
    )
  );
  return rootDir;
}

describe("summarizeCapabilityStatus", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("summarizes capability health into action-oriented buckets", async () => {
    const rootDir = await createProject({
      review: `
title: Review
status: implemented
summary: Review summary.
intent: Review intent.
acceptance:
  - Reports missing implementation reference files.
agent:
  implementation:
    references:
      - src/review.ts
  verification:
    automated:
      - id: tests
        description: Run tests.
        command: npm test
    manual:
      - Review it.
`,
      action: `
title: Action
status: implemented
summary: Action summary.
intent: Action intent.
acceptance:
  - Has implementation references.
agent:
  verification:
    manual:
      - Review it.
`,
      planned: `
title: Planned
status: planned
summary: Planned summary.
intent: Planned intent.
acceptance:
  - Will exist later.
agent:
  verification:
    manual:
      - Review it.
`
    });
    await writeFile(path.join(rootDir, "src", "review.ts"), "throw new Error('missing implementation reference');\n");

    const report = await summarizeCapabilityStatus(rootDir);
    const output = formatCapabilityStatusReport(report);

    expect(report.summary.review).toBe(1);
    expect(report.summary.action).toBe(1);
    expect(report.summary.planned).toBe(1);
    expect(report.capabilities.find((capability) => capability.capabilityId === "core/review")?.health).toBe("review");
    expect(report.capabilities.find((capability) => capability.capabilityId === "core/action")?.nextAction).toContain(
      "Add implementation references"
    );
    expect(output).toContain("needs-review");
    expect(output).toContain("needs-action");
  });

  it("formats one capability as a purpose-first detail view", async () => {
    const rootDir = await createProject({
      example: `
title: Example
status: implemented
summary: Example summary.
intent: Example intent.
acceptance:
  - Example has clear acceptance criteria.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    automated:
      - id: tests
        description: Run tests.
        command: npm test
    manual:
      - Review it.
`
    });
    await writeFile(path.join(rootDir, "src", "example.ts"), "Example has clear acceptance criteria.\n");

    const report = await summarizeCapabilityStatus(rootDir, "core/example");
    const output = formatCapabilityStatusReport(report);

    expect(output).toContain("Purpose");
    expect(output).toContain("Why It Exists");
    expect(output).toContain("Implementation");
    expect(output).toContain("Next Action");
  });

  it("groups mixed story-map datasets by release and unassigned capabilities", async () => {
    const rootDir = await createProject({
      mapped: `
title: Mapped
status: planned
summary: Mapped summary.
intent: Mapped intent.
acceptance:
  - Planned with story map metadata.
planning:
  story_map:
    backbone: Explore
    step: Search
    release: mvp
agent:
  verification:
    manual:
      - Review it.
`,
      done: `
title: Done
status: implemented
summary: Done summary.
intent: Done intent.
acceptance:
  - Implemented with story map metadata.
planning:
  story_map:
    backbone: Explore
    step: Search
    release: mvp
agent:
  implementation:
    references:
      - src/done.ts
  verification:
    manual:
      - Review it.
`,
      unmapped: `
title: Unmapped
status: planned
summary: Unmapped summary.
intent: Unmapped intent.
acceptance:
  - Works without story map metadata.
agent:
  verification:
    manual:
      - Review it.
`
    });
    await writeFile(path.join(rootDir, "src", "done.ts"), "Implemented with story map metadata.\n");

    const report = await summarizeCapabilityStatus(rootDir);
    const mvp = report.byStoryMap.releases.find((entry) => entry.release === "mvp");

    expect(mvp?.capabilities.map((capability) => capability.capabilityId).sort()).toEqual(["core/done", "core/mapped"]);
    expect(mvp?.capabilities.map((capability) => capability.status).sort()).toEqual(["implemented", "planned"]);
    expect(report.byStoryMap.unassigned.map((capability) => capability.capabilityId)).toEqual(["core/unmapped"]);
  });

});
