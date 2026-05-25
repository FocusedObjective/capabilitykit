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
  planning: { releases: ["mvp", "v2"] },
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

  it("ignores selected verification gaps declared by the capability", () => {
    const result = validateLoadedCapabilities(
      loaded([
        parsed("core/gap", {
          agent: {
            verification: {
              automated: [],
              manual: [],
              gaps: ["Needs a real check."],
              ignore_gaps: [
                {
                  code: "missing-automated-checks",
                  reason: "Manual review is sufficient for this example."
                },
                {
                  code: "declared-gap",
                  message_contains: "Needs a real check.",
                  reason: "Tracked separately."
                }
              ]
            }
          }
        })
      ])
    );

    expect(result.verificationGaps.map((gap) => gap.code)).not.toContain("missing-automated-checks");
    expect(result.verificationGaps.map((gap) => gap.code)).not.toContain("declared-gap");
    expect(result.verificationGaps.map((gap) => gap.code)).toContain("missing-manual-review");
  });

  it("can ignore all verification gaps for one capability", () => {
    const result = validateLoadedCapabilities(
      loaded([
        parsed("core/gap", {
          agent: {
            verification: {
              automated: [],
              manual: [],
              gaps: ["Known limitation."],
              ignore_gaps: [{ code: "*", reason: "Intentional example capability." }]
            }
          }
        }),
        parsed("core/other", {
          agent: {
            verification: {
              automated: [],
              manual: []
            }
          }
        })
      ])
    );

    expect(result.verificationGaps.some((gap) => gap.capabilityId === "core/gap")).toBe(false);
    expect(result.verificationGaps.some((gap) => gap.capabilityId === "core/other")).toBe(true);
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

  it("reports invalid story-map release values when configured", () => {
    const result = validateLoadedCapabilities(
      loaded([
        parsed("core/story", {
          planning: {
            story_map: {
              backbone: "Browse",
              step: "View",
              release: "beta"
            }
          }
        })
      ])
    );

    expect(result.verificationGaps.some((gap) => gap.code === "invalid-story-map-release")).toBe(true);
  });

});
