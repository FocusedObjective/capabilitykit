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
});
