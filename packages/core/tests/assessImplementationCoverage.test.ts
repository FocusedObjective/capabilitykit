import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assessImplementationCoverage,
  formatImplementationCoverageReport
} from "../src/assessImplementationCoverage.js";

const tempDirs: string[] = [];

async function createProject(source: string): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-coverage-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: coverage-test
source:
  include:
    - "**/*.capability.yaml"
  exclude:
    - "dist/**"
`
  );
  await writeFile(path.join(rootDir, ".capabilities", "core", "example.capability.yaml"), source);
  return rootDir;
}

describe("assessImplementationCoverage", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("marks criteria covered when exact criterion text appears in referenced files", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Writes normalized JSON to the configured output path.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    manual:
      - Review it.
`);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "example.ts"),
      "// Writes normalized JSON to the configured output path.\nexport const value = 1;\n"
    );

    const report = await assessImplementationCoverage(rootDir, "core/example");

    expect(report.criteria[0]?.status).toBe("covered");
    expect(report.criteria[0]?.evidence[0]?.reference).toBe("src/example.ts");
  });

  it("marks criteria uncertain when only partial deterministic evidence exists", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: planned
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

    const report = await assessImplementationCoverage(rootDir, "core/example");

    expect(report.criteria[0]?.status).toBe("uncertain");
    expect(report.criteria[0]?.evidence.length).toBeGreaterThan(0);
  });

  it("marks criteria uncovered when references are missing or no evidence exists", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: planned
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Writes normalized JSON to the configured output path.
  - Reports missing or unreadable references.
agent:
  implementation:
    references:
      - src/missing.ts
      - src/unrelated.ts
  verification:
    manual:
      - Review it.
`);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "unrelated.ts"), "export const value = 1;\n");

    const report = await assessImplementationCoverage(rootDir, "core/example");
    const output = formatImplementationCoverageReport(report);

    expect(report.missingReferences).toEqual(["src/missing.ts"]);
    expect(report.criteria.map((criterion) => criterion.status)).toEqual(["uncovered", "uncovered"]);
    expect(output).toContain("src/missing.ts: missing or unreadable");
    expect(output).toContain("Evidence: none");
  });

  it("uses markdown headings as evidence for documentation criteria", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - README explains what a capability is.
  - README explains verification gaps.
agent:
  implementation:
    references:
      - README.md
  verification:
    manual:
      - Review it.
`);
    await writeFile(
      path.join(rootDir, "README.md"),
      "# Example\n\n## What Is A Capability?\n\nA capability describes behavior.\n\n## Verification Gaps\n\nGaps show missing confidence.\n"
    );

    const report = await assessImplementationCoverage(rootDir, "core/example");

    expect(report.criteria[0]?.status).toBe("uncertain");
    expect(report.criteria[0]?.evidence[0]?.excerpt).toBe("## What Is A Capability?");
    expect(report.criteria[1]?.status).toBe("uncertain");
    expect(report.criteria[1]?.evidence[0]?.excerpt).toBe("## Verification Gaps");
  });

  it("matches simple singular plural and code-token variants", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Detects duplicate capability IDs.
  - Detects broken agent.depends_on references.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    manual:
      - Review it.
`);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "example.ts"),
      'errors.push({ code: "duplicate-id", message: `Duplicate capability id "${id}"` });\nerrors.push({ code: "broken-dependency", message: "depends on missing capability" });\n'
    );

    const report = await assessImplementationCoverage(rootDir, "core/example");

    expect(report.criteria[0]?.status).toBe("uncertain");
    expect(report.criteria[0]?.evidence[0]?.excerpt).toContain("duplicate-id");
    expect(report.criteria[1]?.status).toBe("uncertain");
    expect(report.criteria[1]?.evidence[0]?.excerpt).toContain("broken-dependency");
  });

  it("uses YAML area fields as evidence for area coverage criteria", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Includes account and checkout capability areas.
agent:
  implementation:
    references:
      - account.capability.yaml
      - checkout.capability.yaml
  verification:
    manual:
      - Review it.
`);
    await writeFile(path.join(rootDir, "account.capability.yaml"), "area: account\n");
    await writeFile(path.join(rootDir, "checkout.capability.yaml"), "area: checkout\n");

    const report = await assessImplementationCoverage(rootDir, "core/example");

    expect(report.criteria[0]?.status).toBe("uncertain");
    expect(report.criteria[0]?.evidence.map((item) => item.excerpt)).toEqual(["area: account", "area: checkout"]);
  });

  it("uses compound object keys as evidence", async () => {
    const rootDir = await createProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Includes dependency graph information.
  - Includes validation results and verification summary.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    manual:
      - Review it.
`);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "example.ts"),
      "return { dependency_graph: {}, validation: result, verification_summary: {} };\n"
    );

    const report = await assessImplementationCoverage(rootDir, "core/example");

    expect(report.criteria[0]?.status).toBe("uncertain");
    expect(report.criteria[0]?.evidence[0]?.excerpt).toContain("dependency_graph");
    expect(report.criteria[1]?.status).toBe("uncertain");
    expect(report.criteria[1]?.evidence[0]?.excerpt).toContain("verification_summary");
  });
});
