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
    step: "Search"
  });
  const mappedA = capability("core/a", "planned", "planned", {
    release: "mvp",
    backbone: "Browse",
    step: "Search"
  });
  const mappedV2 = capability("core/v2", "planned", "planned", {
    release: "v2",
    backbone: "Checkout",
    step: "Pay"
  });
  const unassigned = capability("core/unassigned", "planned", "planned");

  return {
    project: "status-test",
    capabilities: [mappedB, mappedA, mappedV2, unassigned],
    byStoryMap: {
      releases: [
        { release: "mvp", capabilities: [mappedB, mappedA] },
        { release: "v2", capabilities: [mappedV2] }
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
  });
});
