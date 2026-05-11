import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileCapabilities, writeCompiledCapabilities } from "../src/compileCapabilities.js";

describe("compileCapabilities", () => {
  it("compiles the repository capability map", async () => {
    const compiled = await compileCapabilities(process.cwd());

    expect(compiled.project.name).toBe("capabilitykit");
    expect(compiled.capabilities.length).toBeGreaterThan(0);
    expect(compiled.dependency_graph["core/validation/validate-capability-files"]).toContain("core/model/define-capability-format");
    expect(compiled.impact_graph.dependents["core/graph/compile-capabilities"]).toContain("core/agents/prepare-agent-task-bundle");
    expect(compiled.impact_graph.transitive_dependents["core/graph/compile-capabilities"]).toContain("core/agents/prepare-agent-task-bundle");
    expect(compiled.verification_summary.automated_checks).toBeGreaterThan(0);
  });

  it("writes compiled output to the configured path", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-compile-"));
    try {
      await mkdir(path.join(rootDir, ".capabilities", "core"), { recursive: true });
      await Promise.all([
        writeFile(
          path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
          `
schema_version: 0.1
project:
  name: compile-test
source:
  include:
    - "**/*.capability.yaml"
  exclude:
    - "dist/**"
output:
  path: build/capabilities/custom.json
`
        ),
        writeFile(
          path.join(rootDir, ".capabilities", "core", "example.capability.yaml"),
          `
id: core/example
title: Example
status: planned
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - Example has clear acceptance criteria.
agent:
  verification:
    manual:
      - Review it.
`
        )
      ]);

      const result = await writeCompiledCapabilities(rootDir);

      expect(result.outputPath).toBe(path.join(rootDir, "build", "capabilities", "custom.json"));
      const written = JSON.parse(await readFile(result.outputPath, "utf8"));
      expect(written.project.name).toBe("compile-test");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
