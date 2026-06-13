import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDiscoveryAgentTaskBundle } from "../src/discoveryAgentTask.js";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-discovery-agent-task-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    `
schema_version: 0.1
project:
  name: fixture-project
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
  - Example behavior is visible.
`
  );
  await writeFile(path.join(rootDir, "src", "index.ts"), "export const value = 1;\n");
  return rootDir;
}

describe("buildDiscoveryAgentTaskBundle", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("builds a read-only project discovery prompt with inventory, goals, and existing capabilities", async () => {
    const rootDir = await createTempProject();

    const bundle = await buildDiscoveryAgentTaskBundle(rootDir, {
      goals: ["Map the primary workflows."]
    });

    expect(bundle.prompt).toContain("Mode: discovery");
    expect(bundle.prompt).toContain("Map the primary workflows.");
    expect(bundle.prompt).toContain("- src/");
    expect(bundle.prompt).toContain("- core/example [planned]: Example summary.");
    expect(bundle.prompt).toContain("main entrypoints, user workflows, UI components and UI flow code, APIs, routes and handlers, data models and persistence code, tests, scripts, and configuration");
    expect(bundle.prompt).toContain("Use README files, documentation, package metadata, and filenames only as supporting context.");
    expect(bundle.prompt).toContain("Split broad behavior into the smallest independently reviewable capabilities");
    expect(bundle.prompt).toContain("Use `likely_area` as a shared product-domain or workflow folder hint");
    expect(bundle.prompt).toContain("avoid one capability per folder");
    expect(bundle.prompt).toContain("Identify dependency relationships during first discovery");
    expect(bundle.prompt).toContain("acceptance_evidence");
    expect(bundle.prompt).toContain("likely_dependencies");
    expect(bundle.prompt).toContain("Do not create, overwrite, move, or edit capability files during discovery.");
    expect(bundle.prompt).toContain("agent.implementation.references");
    expect(bundle.prompt).toContain("Include verification gaps whenever behavior is inferred or not covered by tests.");
    expect(bundle.prompt).toContain("Use `retained_proposals` only for absent behavior the user explicitly wants to preserve");
    expect(bundle.prompt).toContain("code-backed `candidates` become `implemented`");
    expect(bundle.prompt).toContain("discovery output never claims `verified`");
    expect(bundle.capabilityIds).toEqual(["core/example"]);
  });
});
