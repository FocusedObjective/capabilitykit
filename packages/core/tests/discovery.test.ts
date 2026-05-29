import { describe, expect, it } from "vitest";
import { buildCapabilityDiscoveryPrompt, validateDiscoveryReport } from "../src/discovery.js";

const baseReport = {
  inspected_files: ["src/routes/login.ts", "src/routes/login.test.ts", "README.md"],
  inspected_areas: ["routes", "tests", "docs"],
  candidates: [
    {
      title: "Authenticate users",
      likely_area: "accounts/authentication",
      source_evidence: [
        { path: "src/routes/login.ts", kind: "route" as const, notes: "Handles login requests." },
        { path: "src/routes/login.test.ts", kind: "test" as const, notes: "Covers successful login." }
      ],
      confidence: "high" as const
    }
  ]
};

describe("validateDiscoveryReport", () => {
  it("accepts candidates with inspected files, areas, and concrete code evidence", () => {
    const result = validateDiscoveryReport(baseReport);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it("flags documentation-only evidence and shallow inspection as review gaps", () => {
    const result = validateDiscoveryReport({
      inspected_files: [],
      inspected_areas: [],
      candidates: [
        {
          title: "Explain the product",
          likely_area: "docs",
          source_evidence: [{ path: "README.md", kind: "doc" }],
          confidence: "low"
        }
      ]
    });

    expect(result.valid).toBe(true);
    expect(result.gaps.map((gap) => gap.code)).toEqual([
      "shallow-inspection",
      "shallow-inspection",
      "missing-code-evidence",
      "documentation-only-evidence",
      "low-confidence"
    ]);
  });

  it("rejects candidates without source evidence", () => {
    const result = validateDiscoveryReport({
      inspected_files: ["src/app.ts"],
      inspected_areas: ["source"],
      candidates: [
        {
          title: "Run app",
          likely_area: "app",
          source_evidence: [],
          confidence: "medium"
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: "missing-evidence", candidate: "Run app" });
  });
});

describe("buildCapabilityDiscoveryPrompt", () => {
  it("instructs agents to inspect code and return JSON without writing capability files", () => {
    const prompt = buildCapabilityDiscoveryPrompt("/repo");

    expect(prompt).toContain("Project root: /repo");
    expect(prompt).toContain("Inspect source code, tests, routes, handlers, UI flows, data models, scripts, configuration, and documentation");
    expect(prompt).toContain("README files, package metadata, and docs as supporting context only");
    expect(prompt).toContain("Do not create or overwrite `.capability.yaml` files");
    expect(prompt).toContain('"candidates"');
  });
});
