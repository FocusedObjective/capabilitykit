import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentReviewPrompt } from "../src/agentReview.js";

const tempDirs: string[] = [];

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-agent-review-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: review-test
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
`
  );
  await writeFile(
    path.join(rootDir, "src", "example.ts"),
    "// Writes normalized JSON to the configured output path.\nexport const value = 1;\n"
  );
  return rootDir;
}

describe("buildAgentReviewPrompt", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("builds a review prompt with deterministic coverage and structured output instructions", async () => {
    const rootDir = await createProject();

    const review = await buildAgentReviewPrompt(rootDir, "core/example", { includeReferences: false });

    expect(review.capabilityId).toBe("core/example");
    expect(review.missingReferences).toEqual([]);
    expect(review.prompt).toContain("Mode: review");
    expect(review.prompt).toContain("# Deterministic Implementation Coverage Report");
    expect(review.prompt).toContain("covered: Writes normalized JSON to the configured output path.");
    expect(review.prompt).toContain('"intent_summary": "string"');
    expect(review.prompt).toContain('"status": "covered | partial | uncovered | uncertain"');
    expect(review.prompt).toContain("Set `done` to true only when every criterion is covered");
  });
});
