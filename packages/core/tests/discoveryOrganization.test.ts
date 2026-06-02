import { describe, expect, it } from "vitest";
import { organizeDiscoveredCapabilityMap } from "../src/discoveryOrganization.js";
import type { DiscoveryReport } from "../src/discoveryReport.js";

function report(candidates: DiscoveryReport["candidates"]): DiscoveryReport {
  return {
    inspection_summary: {
      inspected_areas: ["checkout"],
      inspected_paths: ["src/checkout.ts"],
      uninspected_areas: []
    },
    candidates,
    retained_proposals: [],
    quarantined_candidates: [],
    discovery_gaps: [],
    confidence_notes: []
  };
}

function candidate(
  title: string,
  likely_area: string,
  likely_relationships: string[] = [],
  confidence: "high" | "medium" | "low" = "high"
): DiscoveryReport["candidates"][number] {
  return {
    title,
    likely_area,
    summary: `${title} summary.`,
    inferred_intent: `${title} intent.`,
    acceptance_criteria: [`${title} works.`],
    implementation_references: ["src/checkout.ts:1"],
    verification_gaps: [],
    likely_relationships,
    inspected_code_paths: ["src/checkout.ts"],
    confidence,
    confidence_notes: [`${title} confidence notes.`]
  };
}

describe("organizeDiscoveredCapabilityMap", () => {
  it("builds stable area paths, an index, and conservative dependency suggestions without writing files", () => {
    const plan = organizeDiscoveredCapabilityMap(
      report([
        candidate("Prepare order", "commerce / checkout"),
        candidate("Complete checkout", "commerce / checkout", ["Depends on Prepare order."]),
        candidate("View catalog", "commerce")
      ])
    );

    expect(plan.capabilities.map((item) => item.proposedPath)).toEqual([
      ".capabilities/commerce/checkout/prepare-order.capability.yaml",
      ".capabilities/commerce/checkout/complete-checkout.capability.yaml",
      ".capabilities/commerce/view-catalog.capability.yaml"
    ]);
    expect(plan.capabilities[1]?.dependsOn).toEqual(["commerce/checkout/prepare-order"]);
    expect(plan.areas).toEqual([
      {
        area: "commerce",
        capabilityIds: ["commerce/checkout/complete-checkout", "commerce/checkout/prepare-order", "commerce/view-catalog"],
        topLevelCapabilityIds: ["commerce/view-catalog"]
      }
    ]);
  });

  it("reports collisions and ambiguous grouping decisions for human review", () => {
    const plan = organizeDiscoveredCapabilityMap(
      report([
        candidate("Manage users", "src / handlers / admin", [], "medium"),
        candidate("Manage users", "src / handlers / admin")
      ]),
      { existingCapabilityIds: ["src/handlers/manage-users"] }
    );

    expect(plan.collisions).toEqual([
      {
        capabilityId: "src/handlers/manage-users",
        candidates: ["Manage users", "Manage users"],
        reason: "Multiple discovered candidates resolve to the same capability ID."
      },
      {
        capabilityId: "src/handlers/manage-users",
        candidates: ["Manage users"],
        reason: "The proposed capability ID already exists."
      }
    ]);
    expect(plan.reviewFlags.map((flag) => flag.message)).toContain(
      'Collapsed deep area hint "src / handlers / admin" to "src/handlers".'
    );
    expect(plan.reviewFlags.some((flag) => flag.message.includes("code structure"))).toBe(true);
    expect(plan.reviewFlags.some((flag) => flag.message.includes("confidence is medium"))).toBe(true);
  });
});
