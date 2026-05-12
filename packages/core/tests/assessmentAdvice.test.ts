import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adviseImplementationCoverage, formatAssessmentAdviceReport } from "../src/assessmentAdvice.js";

const tempDirs: string[] = [];

async function createProject(capability: string): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-advice-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: advice-test
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
  await writeFile(path.join(rootDir, ".capabilities", "core", "example.capability.yaml"), capability);
  return rootDir;
}

describe("adviseImplementationCoverage", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("groups coverage findings by recommended action", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Explains what a capability is.
agent:
  verification:
    manual:
      - Review it.
`);

    const report = await adviseImplementationCoverage(rootDir);
    const output = formatAssessmentAdviceReport(report);

    expect(report.summary.statuses["no-implementation-reference"]).toBe(1);
    expect(report.capabilities[0]?.criteria[0]?.action).toBe("add-implementation-reference");
    expect(output).toContain("## Recommended Actions");
    expect(output).toContain("Add agent.implementation.references");
  });

  it("marks uncertain deterministic matches as weak evidence", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Reports missing implementation reference files.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    manual:
      - Review it.
`);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "example.ts"), "throw new Error('missing implementation reference');\n");

    const report = await adviseImplementationCoverage(rootDir, "core/example");

    expect(report.summary.statuses["weak-evidence"]).toBe(1);
    expect(report.capabilities[0]?.criteria[0]?.action).toBe("inspect-evidence");
  });

  it("marks broad uncovered criteria as assessor limitations", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Includes project metadata and all parsed capabilities.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    manual:
      - Review it.
`);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "example.ts"), "export const value = 1;\n");

    const report = await adviseImplementationCoverage(rootDir, "core/example");

    expect(report.summary.statuses["assessor-limitation"]).toBe(1);
    expect(report.capabilities[0]?.criteria[0]?.action).toBe("split-or-clarify-criterion");
  });

  it("uses saved agent review criteria before deterministic advice", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Behavior is semantically reviewed.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    manual:
      - Review it.
  review:
    depth: verified
    done: true
    criteria:
      - criterion: Behavior is semantically reviewed.
        status: covered
        evidence:
          - src/example.ts:1
        notes: Confirmed by Codex review.
`);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "example.ts"), "export const value = 1;\n");

    const report = await adviseImplementationCoverage(rootDir, "core/example");

    expect(report.summary.statuses.covered).toBe(1);
    expect(report.capabilities[0]?.criteria[0]?.action).toBe("none");
    expect(report.capabilities[0]?.criteria[0]?.rationale).toContain("Saved agent.review");
  });

  it("ignores accepted advisory findings from capability metadata", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Reports missing implementation reference files.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    manual:
      - Review it.
  review:
    ignore_findings:
      - status: weak-evidence
        criterion: Reports missing implementation reference files.
        reason: This text-only criterion is intentionally accepted for now.
`);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "example.ts"), "throw new Error('missing implementation reference');\n");

    const report = await adviseImplementationCoverage(rootDir, "core/example");
    const output = formatAssessmentAdviceReport(report);

    expect(report.summary.statuses["weak-evidence"]).toBe(0);
    expect(report.summary.statuses.ignored).toBe(1);
    expect(report.summary.actions["inspect-evidence"]).toBe(0);
    expect(report.capabilities[0]?.criteria[0]?.status).toBe("ignored");
    expect(output).not.toContain("Review the cited evidence");
  });
});
