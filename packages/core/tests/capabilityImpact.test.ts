import { describe, expect, it } from "vitest";
import { analyzeCapabilityImpact, buildCapabilityImpactGraph } from "../src/capabilityImpact.js";
import type { LoadCapabilitiesResult, ParsedCapability, ProjectConfig } from "../src/types.js";

const config: ProjectConfig = {
  schema_version: "0.1",
  project: { name: "test" },
  validation: {
    require_acceptance: true,
    require_verification: true,
    allow_verification_gaps: true,
    require_implementation_references_for_status: ["implemented", "verified"]
  },
  output: { path: ".capabilities/dist/capabilities.json" },
  source: { include: ["**/*.capability.yaml"], exclude: ["dist/**"] }
};

function parsed(id: string, depends_on: string[] = []): ParsedCapability {
  return {
    filePath: `${id}.capability.yaml`,
    relativePath: `${id}.capability.yaml`,
    capability: {
      id,
      title: id,
      status: "planned",
      area: "core",
      summary: "Summary",
      intent: "Intent",
      acceptance: ["Acceptance"],
      agent: {
        depends_on,
        verification: {
          automated: [{ id: `${id}-test`, description: `Test ${id}`, command: "npm test" }],
          manual: [`Review ${id}`]
        }
      }
    }
  };
}

function loaded(capabilities: ParsedCapability[]): LoadCapabilitiesResult {
  return {
    rootDir: process.cwd(),
    capabilitiesDir: `${process.cwd()}/.capabilities`,
    config,
    capabilities,
    errors: []
  };
}

describe("buildCapabilityImpactGraph", () => {
  it("builds direct and transitive dependents", () => {
    const graph = buildCapabilityImpactGraph(
      loaded([
        parsed("core/base"),
        parsed("core/child", ["core/base"]),
        parsed("core/grandchild", ["core/child"]),
        parsed("core/sibling", ["core/base"])
      ])
    );

    expect(graph.dependencies["core/child"]).toEqual(["core/base"]);
    expect(graph.dependents["core/base"]).toEqual(["core/child", "core/sibling"]);
    expect(graph.transitive_dependents["core/base"]).toEqual(["core/child", "core/grandchild", "core/sibling"]);
  });
});

describe("analyzeCapabilityImpact", () => {
  it("reports impacted capabilities for the repository capability map", async () => {
    const report = await analyzeCapabilityImpact(process.cwd(), "core/graph/compile-capabilities");

    expect(report.direct_dependents).toContain("core/agents/prepare-agent-task-bundle");
    expect(report.impacted_capabilities).toContain("core/graph/compile-capabilities");
    expect(report.verification.automated.length).toBeGreaterThan(0);
  });
});
