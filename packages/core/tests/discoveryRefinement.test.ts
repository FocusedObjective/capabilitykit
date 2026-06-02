import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDraftCapabilities } from "../src/discoveryGeneration.js";
import { organizeDiscoveredCapabilityMap } from "../src/discoveryOrganization.js";
import { refineDiscoveredCapabilities } from "../src/discoveryRefinement.js";
import type { DurableDiscoveryReport } from "../src/discoveryReport.js";

const tempDirs: string[] = [];

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-discovery-refinement-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "discovery"), { recursive: true });
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".capabilities", "capabilitykit.yaml"),
    "schema_version: 0.1\nproject:\n  name: refinement-fixture\n"
  );
  await writeFile(path.join(rootDir, "src", "checkout.ts"), "export const checkout = true;\n");
  await writeFile(path.join(rootDir, "src", "checkout.test.ts"), "export const checkoutTest = true;\n");
  await writeFile(path.join(rootDir, "README.md"), "# Checkout fixture\n");
  return rootDir;
}

function report(): DurableDiscoveryReport {
  return {
    inspection_summary: {
      inspected_areas: ["checkout"],
      inspected_paths: ["src/checkout.ts"],
      uninspected_areas: []
    },
    candidates: [
      {
        title: "Complete checkout",
        likely_area: "src / handlers / checkout",
        summary: "Allow a user to complete checkout.",
        inferred_intent: "Turn a prepared order into a completed purchase.",
        acceptance_criteria: ["Checkout works."],
        implementation_references: ["src/checkout.ts:1", "src/checkout.test.ts:1", "README.md"],
        verification_gaps: ["Inspect adjacent checkout paths before accepting the draft."],
        likely_relationships: [],
        inspected_code_paths: ["src/checkout.ts"],
        confidence: "medium",
        confidence_notes: ["Only one implementation path was inspected."]
      }
    ],
    retained_proposals: [],
    quarantined_candidates: [
      {
        title: "Refund payment",
        likely_area: "checkout",
        reason: "No implementation path was found.",
        source_evidence: [],
        confidence_notes: ["Review this after checkout refinement."]
      }
    ],
    discovery_gaps: ["Payment provider behavior was not inspected."],
    confidence_notes: [],
    provenance: {
      report_id: "refinement-discovery",
      saved_at: "2026-06-01T00:00:00.000Z"
    }
  };
}

describe("refineDiscoveredCapabilities", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("reports prioritized recommendations with audit links without mutating generated drafts", async () => {
    const rootDir = await createProject();
    const discoveryReport = report();
    const plan = organizeDiscoveredCapabilityMap(discoveryReport);
    const generated = await generateDraftCapabilities(rootDir, discoveryReport, plan, { apply: true });
    const before = await readFile(generated.files[0].filePath, "utf8");

    const refinement = await refineDiscoveredCapabilities(rootDir, discoveryReport, plan);

    expect(refinement.summary.generatedCapabilities).toBe(1);
    expect(refinement.summary.needingHumanReview).toBe(1);
    expect(refinement.quarantinedCandidates[0]?.title).toBe("Refund payment");
    expect(refinement.capabilities[0]?.auditTrail.reportId).toBe("refinement-discovery");
    expect(refinement.capabilities[0]?.recommendations.map((recommendation) => recommendation.kind)).toEqual(
      expect.arrayContaining(["shallow-inspection", "documentation-inference-review", "vague-acceptance", "poor-area-placement"])
    );
    expect(refinement.capabilities[0]?.dispositions.map((disposition) => disposition.action)).toEqual([
      "accept",
      "revise",
      "remove"
    ]);
    expect(await readFile(generated.files[0].filePath, "utf8")).toBe(before);
  });
});
