import { describe, expect, it } from "vitest";
import { validateLoadedCapabilities } from "../src/validateCapabilities.js";
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

function parsed(id: string, overrides: Partial<ParsedCapability["capability"]> = {}): ParsedCapability {
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
        verification: {
          automated: [{ id: "test", description: "Runs tests", command: "npm test" }],
          manual: ["Review output"]
        }
      },
      ...overrides
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

describe("validateLoadedCapabilities", () => {
  it("detects duplicate IDs", () => {
    const result = validateLoadedCapabilities(loaded([parsed("core/same"), parsed("core/same")]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "duplicate-id")).toBe(true);
  });

  it("detects broken dependencies", () => {
    const result = validateLoadedCapabilities(loaded([parsed("core/child", { agent: { depends_on: ["core/missing"] } })]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "broken-dependency")).toBe(true);
  });

  it("reports verification gaps without making the result invalid", () => {
    const result = validateLoadedCapabilities(
      loaded([
        parsed("core/gap", {
          agent: { verification: { automated: [], manual: [], gaps: ["Needs a real check."] } }
        })
      ])
    );

    expect(result.valid).toBe(true);
    expect(result.verificationGaps.map((gap) => gap.code)).toContain("missing-automated-checks");
    expect(result.verificationGaps.map((gap) => gap.code)).toContain("missing-manual-review");
    expect(result.verificationGaps.map((gap) => gap.code)).toContain("declared-gap");
  });

  it("requires implementation references for implemented capabilities", () => {
    const result = validateLoadedCapabilities(loaded([parsed("core/done", { status: "implemented" })]));
    expect(result.valid).toBe(true);
    expect(result.verificationGaps.some((gap) => gap.code === "missing-implementation-references")).toBe(true);
  });

  it("reports implementation references that do not resolve to files", () => {
    const result = validateLoadedCapabilities(
      loaded([
        parsed("core/done", {
          status: "implemented",
          agent: {
            verification: {
              automated: [{ id: "test", description: "Runs tests", command: "npm test" }],
              manual: ["Review output"]
            },
            implementation: {
              references: ["packages/core/src/validateCapabilities.ts", "packages/core/src/missing.ts"]
            }
          }
        })
      ])
    );

    expect(result.valid).toBe(true);
    expect(result.verificationGaps).toContainEqual(
      expect.objectContaining({
        code: "missing-implementation-reference-target",
        capabilityId: "core/done",
        message: 'core/done references missing implementation path "packages/core/src/missing.ts"'
      })
    );
    expect(result.verificationGaps).not.toContainEqual(
      expect.objectContaining({
        message: 'core/done references missing implementation path "packages/core/src/validateCapabilities.ts"'
      })
    );
  });
});
