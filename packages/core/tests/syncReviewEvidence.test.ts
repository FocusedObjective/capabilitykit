import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { syncReviewEvidence } from "../src/syncReviewEvidence.js";

const tempDirs: string[] = [];

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-sync-review-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: sync-review-test
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
  - Marks criteria as covered, uncovered, or uncertain.
  - Missing behavior remains visible.
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
    "export type Status = 'covered' | 'uncovered' | 'uncertain';\n"
  );
  return rootDir;
}

describe("syncReviewEvidence", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("updates agent.review from current implementation evidence without changing status", async () => {
    const rootDir = await createProject();

    const result = await syncReviewEvidence(rootDir, "core/example");
    const source = await readFile(path.join(rootDir, ".capabilities", "core", "example.capability.yaml"), "utf8");
    const parsed = YAML.parse(source);

    expect(result.results[0]?.changed).toBe(true);
    expect(parsed.status).toBe("implemented");
    expect(parsed.agent.review.depth).toBe("partial");
    expect(parsed.agent.review.source).toBe("deterministic-assessment");
    expect(parsed.agent.review.done).toBe(false);
    expect(parsed.agent.review.criteria).toHaveLength(2);
    expect(parsed.agent.review.gaps.length).toBeGreaterThan(0);
    expect(parsed.agent.review.evidence).toBeUndefined();
    expect(source).toContain("# machine managed agent metadata");
    expect(source).toContain("# review all capabilities and save evidence: capabilitykit review");
    expect(source).toContain("# review this capability and save evidence: capabilitykit review core/example");
    expect(source).toContain("# run deterministic review only: capabilitykit review core/example --deterministic-only");
    expect(source).toContain("# ask an agent and save review evidence: capabilitykit review core/example --agent codex --arg exec --handoff stdin");
    expect(source).toContain("# validate saved agent output without writing: capabilitykit review-result core/example --input review.json");
  });

  it("reports dry-run changes without writing files", async () => {
    const rootDir = await createProject();
    const filePath = path.join(rootDir, ".capabilities", "core", "example.capability.yaml");
    const before = await readFile(filePath, "utf8");

    const result = await syncReviewEvidence(rootDir, "core/example", { dryRun: true });
    const after = await readFile(filePath, "utf8");

    expect(result.dryRun).toBe(true);
    expect(result.results[0]?.changed).toBe(false);
    expect(after).toBe(before);
  });
});
