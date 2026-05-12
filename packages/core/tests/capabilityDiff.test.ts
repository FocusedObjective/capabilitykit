import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { diffCapabilities, formatCapabilityDiffReport } from "../src/capabilityDiff.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function git(rootDir: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: rootDir });
}

async function createRepo(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-diff-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: diff-test
source:
  include:
    - "**/*.capability.yaml"
  exclude:
    - "dist/**"
`
  );
  await writeFile(
    path.join(rootDir, ".capabilities", "core", "example.capability.yaml"),
    `
id: core/example
title: Example
status: implemented
area: core
summary: Base summary.
intent: Base intent.
acceptance:
  - First behavior works.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    manual:
      - Review it.
`
  );
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(path.join(rootDir, "src", "example.ts"), "export const value = 1;\n");
  await git(rootDir, ["init"]);
  await git(rootDir, ["add", "."]);
  await git(rootDir, ["-c", "user.name=CapabilityKit", "-c", "user.email=capabilitykit@example.com", "commit", "-m", "base"]);
  return rootDir;
}

describe("diffCapabilities", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("reports added, changed, and removed capabilities against a git base", async () => {
    const rootDir = await createRepo();
    await writeFile(
      path.join(rootDir, ".capabilities", "core", "example.capability.yaml"),
      `
id: core/example
title: Example
status: implemented
area: core
summary: Updated summary.
intent: Base intent.
acceptance:
  - First behavior works.
  - Second behavior works.
agent:
  implementation:
    references:
      - src/example.ts
      - src/second.ts
  verification:
    manual:
      - Review it.
`
    );
    await writeFile(
      path.join(rootDir, ".capabilities", "core", "added.capability.yaml"),
      `
id: core/added
title: Added
status: planned
area: core
summary: Added summary.
intent: Added intent.
acceptance:
  - Added behavior exists.
agent:
  verification:
    manual:
      - Review it.
`
    );

    const report = await diffCapabilities(rootDir, { base: "HEAD" });
    const output = formatCapabilityDiffReport(report);

    expect(report.summary.added).toBe(1);
    expect(report.summary.changed).toBe(1);
    expect(report.entries.find((entry) => entry.capabilityId === "core/example")?.fieldDiffs.map((diff) => diff.field)).toContain(
      "acceptance"
    );
    expect(output).toContain("CapabilityKit Diff: HEAD..working-tree");
    expect(output).toContain("Summary");
    expect(output).toContain("+ core/added");
    expect(output).toContain("~ core/example");
    expect(output).toContain("Notable changes");
    expect(output).toContain("Use `capabilitykit diff --verbose`");
    expect(formatCapabilityDiffReport(report, { verbose: true })).toContain("acceptance");
  });
});
