import { describe, expect, it } from "vitest";
import type { CapabilityStatusReport, CapabilityStatusSummary } from "@capabilitykit/core";
import { filterStatusReportByRelease, formatStoryMapStatusReport, formatStoryMapViewerHtml } from "../src/statusOutput.js";

function capability(
  capabilityId: string,
  status: CapabilityStatusSummary["status"],
  health: CapabilityStatusSummary["health"],
  storyMap?: CapabilityStatusSummary["storyMap"]
): CapabilityStatusSummary {
  return {
    capabilityId,
    title: capabilityId,
    status,
    area: "core",
    path: `.capabilities/${capabilityId}.capability.yaml`,
    health,
    summary: `${capabilityId} summary.`,
    intent: `${capabilityId} intent.`,
    references: { total: 0, readable: 0, missing: [] },
    verification: { automated: 0, manual: 1, gaps: [] },
    counts: {
      covered: 0,
      "weak-evidence": 0,
      "implementation-gap": 0,
      "missing-reference": 0,
      "no-implementation-reference": 0,
      "assessor-limitation": 0,
      ignored: 0
    },
    nextAction: "No immediate action.",
    topFindings: [],
    storyMap
  };
}

function report(): CapabilityStatusReport {
  const mappedB = capability("core/b", "implemented", "ok", {
    release: "mvp",
    backbone: "Browse",
    step: "Search",
    order: 20
  });
  const mappedA = capability("core/a", "planned", "planned", {
    release: "mvp",
    backbone: "Browse",
    step: "Search",
    order: 10
  });
  const mappedV2 = capability("core/v2", "planned", "planned", {
    release: "v2",
    backbone: "Checkout",
    step: "Pay",
    order: 10
  });
  const unassigned = capability("core/unassigned", "planned", "planned");

  return {
    project: "status-test",
    capabilities: [mappedB, mappedA, mappedV2, unassigned],
    byStoryMap: {
      releases: [
        {
          release: "mvp",
          capabilities: [mappedB, mappedA],
          deliveryStrategy: {
            release: "mvp",
            recommendations: [
              {
                order: 1,
                phase: "opening",
                name: "Walking skeleton",
                capabilityIds: ["core/a", "core/b"],
                releaseStrategy: "Prove one coherent end-to-end slice before deepening individual steps.",
                developmentStrategy: "Integrate the earliest capability from each backbone first.",
                riskIntent: "core/a has normal delivery risk; core/b has normal delivery risk",
                learningIntent: "Validate whether stakeholders can recognize the outcome.",
                backboneCoverage: ["Browse"],
                missingBackbones: ["Checkout"],
                stepCoverageGaps: ["Checkout > Pay"],
                rationale: "Starts with one step from each mapped backbone: Browse."
              }
            ]
          },
          presentation: {
            outcome: "mvp helps teams move from Search to Search across 1 backbone activity.",
            narrativePath: [{ backbone: "Browse", step: "Search", capabilityIds: ["core/a", "core/b"], health: "planned" }],
            coverageSignals: [
              { kind: "missing", label: "Checkout", message: "Checkout is not covered in the recommended slice." },
              { kind: "missing", label: "Checkout > Pay", message: "Checkout > Pay is not covered in the recommended slice." }
            ]
          }
        },
        {
          release: "v2",
          capabilities: [mappedV2],
          deliveryStrategy: { release: "v2", recommendations: [] },
          presentation: {
            outcome: "v2 helps teams move from Pay to Pay across 1 backbone activity.",
            narrativePath: [{ backbone: "Checkout", step: "Pay", capabilityIds: ["core/v2"], health: "planned" }],
            coverageSignals: []
          }
        }
      ],
      unassigned: [unassigned]
    },
    summary: {
      total: 4,
      ok: 1,
      review: 0,
      action: 0,
      planned: 3
    }
  };
}

describe("story-map status output", () => {
  it("formats releases, backbone groups, and capabilities deterministically", () => {
    const output = formatStoryMapStatusReport(report());

    expect(output).toContain("CapabilityKit Story Map Status: status-test");
    expect(output).toContain("Release: mvp");
    expect(output).toContain("Outcome: mvp helps teams move from Search to Search across 1 backbone activity.");
    expect(output).toContain("Narrative path: Browse > Search");
    expect(output).not.toContain("Coverage signals:");
    expect(output).toContain("  Browse > Search");
    expect(output.indexOf("    - core/a [planned] (planned)")).toBeLessThan(
      output.indexOf("    - core/b [implemented] (ok)")
    );
    expect(output.indexOf("Release: mvp")).toBeLessThan(output.indexOf("Release: v2"));
    expect(output).toContain("Unassigned (1):\n  - core/unassigned [planned] (planned)");
  });

  it("filters status reports by story-map release and recalculates summary counts", () => {
    const filtered = filterStatusReportByRelease(report(), "mvp");

    expect(filtered.capabilities.map((item) => item.capabilityId)).toEqual(["core/b", "core/a"]);
    expect(filtered.byStoryMap.releases.map((item) => item.release)).toEqual(["mvp"]);
    expect(filtered.byStoryMap.unassigned).toEqual([]);
    expect(filtered.summary).toEqual({
      total: 2,
      ok: 1,
      review: 0,
      action: 0,
      planned: 1
    });
  });

  it("renders a self-contained story-map viewer page", () => {
    const html = formatStoryMapViewerHtml(report());

    expect(html).toContain("<title>status-test story map</title>");
    expect(html).toContain("Plan by release, backbone, and step");
    expect(html).toContain("const report = ");
    expect(html).toContain('"release":"mvp"');
    expect(html).toContain('"capabilityId":"core/unassigned"');
    expect(html).toContain("Search capabilities");
    expect(html).toContain("Planning");
    expect(html).toContain("Coverage");
    expect(html).toContain("outcome-oriented planning view and implementation-health view");
    expect(html).toContain("release-outcome");
    expect(html).toContain(".narrative-step.ok");
    expect(html).toContain("a.order - b.order");
  });

  it("can include release and development strategy recommendations", () => {
    const output = formatStoryMapStatusReport(report(), { recommendOrder: true, showCoverage: true });

    expect(output).toContain("Coverage signals:");
    expect(output).toContain("Recommended delivery strategy:");
    expect(output).toContain("1. opening: Walking skeleton");
    expect(output).toContain("Release: Prove one coherent end-to-end slice");
    expect(output).toContain("Development: Integrate the earliest capability");
    expect(output).toContain("Capabilities: core/a, core/b");
    expect(output).toContain("Backbone coverage: Browse");
    expect(output).toContain("Missing backbones: Checkout");
    expect(output).toContain("Step coverage gaps: Checkout > Pay");
  });

  it("renders selected-release recommendations with coverage rationale", () => {
    const filtered = filterStatusReportByRelease(report(), "mvp");
    const output = formatStoryMapStatusReport(filtered, { recommendOrder: true });

    expect(output).toContain("Release: mvp");
    expect(output).not.toContain("Release: v2");
    expect(output).toContain("Recommended delivery strategy:");
    expect(output).toContain("Backbone coverage: Browse");
    expect(output).toContain("Missing backbones: Checkout");
    expect(output).toContain("Step coverage gaps: Checkout > Pay");
  });
});
