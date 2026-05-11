import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveAgentReviewResult, validateAgentReviewResult } from "../src/agentReviewResult.js";
import { loadCapabilities } from "../src/loadCapabilities.js";

const tempDirs: string[] = [];

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-review-result-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: review-result-test
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
  - First criterion is covered.
  - Second criterion is covered.
agent:
  implementation:
    references:
      - src/example.ts
  verification:
    manual:
      - Review it.
`
  );
  await writeFile(path.join(rootDir, "src", "example.ts"), "export const value = 1;\n");
  return rootDir;
}

function validReview(): string {
  return JSON.stringify({
    intent_summary: "The capability proves review result ingestion.",
    criteria: [
      {
        criterion: "First criterion is covered.",
        status: "covered",
        evidence: ["src/example.ts:1"],
        notes: "Implemented."
      },
      {
        criterion: "Second criterion is covered.",
        status: "covered",
        evidence: ["src/example.ts:1"],
        notes: "Implemented."
      }
    ],
    remaining_gaps: [],
    done: true
  });
}

describe("agent review results", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("validates structured review output against acceptance criteria and evidence paths", async () => {
    const rootDir = await createProject();
    const loaded = await loadCapabilities(rootDir);
    const capability = loaded.capabilities[0]!.capability;

    const result = await validateAgentReviewResult(rootDir, capability, validReview());

    expect(result.valid).toBe(true);
    expect(result.depth).toBe("verified");
    expect(result.issues).toEqual([]);
  });

  it("reports missing criterion and missing evidence paths", async () => {
    const rootDir = await createProject();
    const loaded = await loadCapabilities(rootDir);
    const capability = loaded.capabilities[0]!.capability;

    const result = await validateAgentReviewResult(
      rootDir,
      capability,
      JSON.stringify({
        intent_summary: "Partial review.",
        criteria: [
          {
            criterion: "First criterion is covered.",
            status: "covered",
            evidence: ["src/missing.ts:1"],
            notes: "Not actually valid."
          }
        ],
        remaining_gaps: ["Second criterion still needs review."],
        done: false
      })
    );

    expect(result.valid).toBe(false);
    expect(result.depth).toBe("partial");
    expect(result.issues.map((issue) => issue.code)).toContain("criteria-count-mismatch");
    expect(result.issues.map((issue) => issue.code)).toContain("missing-criterion");
    expect(result.issues.map((issue) => issue.code)).toContain("missing-evidence-path");
  });

  it("saves valid review output to agent.review without changing capability status", async () => {
    const rootDir = await createProject();

    const result = await saveAgentReviewResult(rootDir, "core/example", validReview());

    expect(result.validation.valid).toBe(true);
    const source = await readFile(path.join(rootDir, ".capabilities", "core", "example.capability.yaml"), "utf8");
    expect(source).toContain("review:");
    expect(source).toContain("depth: verified");
    expect(source).toContain("status: implemented");
    expect(source).toContain("intent_summary: The capability proves review result ingestion.");
  });
});
