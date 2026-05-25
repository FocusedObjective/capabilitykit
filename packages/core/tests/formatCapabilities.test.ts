import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatCapabilities } from "../src/formatCapabilities.js";

const tempDirs: string[] = [];

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-format-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: format-test
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
title: Example
status: planned
summary: Example summary.
intent: Example intent.
acceptance:
  - It can be formatted.
planning:
  story_map:
    backbone: Model
    step: Define
    release: mvp
    order: 1
agent:
  verification:
    manual:
      - Review it.
`
  );
  return rootDir;
}

describe("formatCapabilities", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("writes concrete agent metadata commands for each capability", async () => {
    const rootDir = await createProject();

    const result = await formatCapabilities(rootDir, { write: true });
    const source = await readFile(path.join(rootDir, ".capabilities", "core", "example.capability.yaml"), "utf8");

    expect(result.changed).toBe(1);
    expect(source).toContain(
      [
        "#",
        "#",
        "agent:",
        "  # -----------------------------",
        "  # machine managed agent metadata"
      ].join("\n")
    );
    expect(source).toContain("# review all capabilities and save evidence: capabilitykit review");
    expect(source).toContain("# review this capability and save evidence: capabilitykit review core/example");
    expect(source).toContain("# run deterministic review only: capabilitykit review core/example --deterministic-only");
    expect(source).toContain("# ask an agent and save review evidence: capabilitykit review core/example --agent codex --handoff stdin");
    expect(source).toContain("# validate saved agent output without writing: capabilitykit review-result core/example --input review.json");
    expect(source).not.toContain("<capability-id>");
    expect(source).toContain("planning:\n  story_map:\n    backbone: Model\n    step: Define\n    release: mvp\n    order: 1");
  });
});
