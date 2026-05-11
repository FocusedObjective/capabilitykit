import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTaskBundle } from "../src/agentTask.js";

const tempDirs: string[] = [];

async function createTempProject(capabilitySource: string): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-agent-task-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: test
source:
  include:
    - "**/*.capability.yaml"
  exclude:
    - "dist/**"
`
  );
  await writeFile(path.join(rootDir, ".capabilities", "core", "example.capability.yaml"), capabilitySource);
  return rootDir;
}

describe("buildAgentTaskBundle", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("builds a review prompt with criterion-level instructions and referenced content", async () => {
    const rootDir = await createTempProject(`
id: core/example
title: Example
status: implemented
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - First criterion is covered.
  - Second criterion is covered.
guidance:
  - Keep it deterministic.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    automated:
      - id: example-tests
        description: Example tests run.
        command: npm test
    manual:
      - Review the output.
`);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "example.ts"), "export const value = 1;\n");

    const bundle = await buildAgentTaskBundle(rootDir, "core/example", { mode: "review" });

    expect(bundle.prompt).toContain("Mode: review");
    expect(bundle.prompt).toContain("First summarize the capability intent in your own words.");
    expect(bundle.prompt).toContain("covered, partial, uncovered, or uncertain");
    expect(bundle.prompt).toContain("1. First criterion is covered.");
    expect(bundle.prompt).toContain("### src/example.ts");
    expect(bundle.prompt).toContain("export const value = 1;");
    expect(bundle.missingReferences).toEqual([]);
  });

  it("reports missing implementation reference files in the prompt", async () => {
    const rootDir = await createTempProject(`
id: core/missing-reference
title: Missing Reference
status: planned
area: core
summary: Missing reference summary.
intent: Missing reference intent.
acceptance:
  - Missing references are visible.
agent:
  implementation:
    references:
      - src/missing.ts
  verification:
    manual:
      - Review the generated prompt.
`);

    const bundle = await buildAgentTaskBundle(rootDir, "core/missing-reference");

    expect(bundle.missingReferences).toEqual(["src/missing.ts"]);
    expect(bundle.prompt).toContain("### src/missing.ts");
    expect(bundle.prompt).toContain("Missing or unreadable.");
  });
});
