import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDraftCapabilities } from "../src/discoveryGeneration.js";
import { organizeDiscoveredCapabilityMap } from "../src/discoveryOrganization.js";
import { parseCapability } from "../src/parseCapability.js";
import type { DurableDiscoveryReport } from "../src/discoveryReport.js";

const tempDirs: string[] = [];

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-discovery-generation-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities", "discovery"), { recursive: true });
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(path.join(rootDir, "src", "checkout.ts"), "export const checkout = true;\n");
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
        likely_area: "commerce / checkout",
        summary: "Allow a user to complete checkout.",
        inferred_intent: "Turn a prepared order into a completed purchase.",
        acceptance_criteria: ["A prepared order can be checked out."],
        acceptance_evidence: [
          {
            criterion: "A prepared order can be checked out.",
            evidence: ["src/checkout.ts:1"],
            notes: "Checkout export provides the behavior entrypoint."
          }
        ],
        implementation_references: ["src/checkout.ts:1"],
        verification_gaps: ["Production payment provider behavior needs review."],
        likely_relationships: [],
        likely_dependencies: [],
        inspected_code_paths: ["src/checkout.ts"],
        confidence: "medium",
        confidence_notes: ["External provider behavior was not inspected."]
      }
    ],
    retained_proposals: [],
    quarantined_candidates: [],
    discovery_gaps: [],
    confidence_notes: [],
    provenance: {
      report_id: "checkout-discovery",
      saved_at: "2026-06-01T00:00:00.000Z"
    }
  };
}

describe("generateDraftCapabilities", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("previews without writing and explicitly applies parseable capability files with durable plan evidence", async () => {
    const rootDir = await createProject();
    const discoveryReport = report();
    const plan = organizeDiscoveredCapabilityMap(discoveryReport);

    const preview = await generateDraftCapabilities(rootDir, discoveryReport, plan);
    expect(preview.applied).toBe(false);
    await expect(readFile(preview.files[0].filePath, "utf8")).rejects.toThrow();

    const result = await generateDraftCapabilities(rootDir, discoveryReport, plan, { apply: true });
    expect(result.applied).toBe(true);
    const source = await readFile(result.files[0].filePath, "utf8");
    const parsed = parseCapability(source, result.files[0].filePath);
    expect(parsed.capability?.id).toBe("commerce/checkout/complete-checkout");
    expect(parsed.capability?.status).toBe("implemented");
    expect(parsed.capability?.agent?.implementation?.references).toEqual(["src/checkout.ts:1"]);
    expect(parsed.capability?.agent?.verification?.gaps).toEqual(["Production payment provider behavior needs review."]);
    expect(parsed.capability?.agent?.review?.criteria).toEqual([
      {
        criterion: "A prepared order can be checked out.",
        status: "covered",
        evidence: ["src/checkout.ts:1"],
        notes: "Checkout export provides the behavior entrypoint."
      }
    ]);
    expect(parsed.capability?.agent?.review?.done).toBe(false);
    expect(JSON.parse(await readFile(result.reportPath, "utf8")).provenance.report_id).toBe("checkout-discovery");
    expect(JSON.parse(await readFile(result.auditPath, "utf8")).plan.capabilities[0].groupingDecision.sourceArea).toBe(
      "commerce / checkout"
    );
  });

  it("reports file collisions and refuses overwrite unless force is requested", async () => {
    const rootDir = await createProject();
    const discoveryReport = report();
    const plan = organizeDiscoveredCapabilityMap(discoveryReport);
    await generateDraftCapabilities(rootDir, discoveryReport, plan, { apply: true });

    const blocked = await generateDraftCapabilities(rootDir, discoveryReport, plan, { apply: true });
    expect(blocked.applied).toBe(false);
    expect(blocked.collisions.map((collision) => collision.reason)).toContain("The proposed capability file already exists.");

    const forced = await generateDraftCapabilities(rootDir, discoveryReport, plan, { apply: true, force: true });
    expect(forced.applied).toBe(true);
  });

  it("rejects documentation-only candidates", async () => {
    const rootDir = await createProject();
    const discoveryReport = report();
    discoveryReport.candidates[0].implementation_references = ["README.md"];
    const plan = organizeDiscoveredCapabilityMap(discoveryReport);

    await expect(generateDraftCapabilities(rootDir, discoveryReport, plan)).rejects.toThrow(
      'Candidate "Complete checkout" relies only on documentation or package metadata.'
    );
  });

  it("rejects edited plans that escape .capabilities or disagree with their path-derived ID", async () => {
    const rootDir = await createProject();
    const discoveryReport = report();
    const escapedPlan = organizeDiscoveredCapabilityMap(discoveryReport);
    escapedPlan.capabilities[0].proposedPath = "src/complete-checkout.capability.yaml";
    await expect(generateDraftCapabilities(rootDir, discoveryReport, escapedPlan)).rejects.toThrow(
      "Proposed capability path must remain under .capabilities"
    );

    const mismatchedPlan = organizeDiscoveredCapabilityMap(discoveryReport);
    mismatchedPlan.capabilities[0].capabilityId = "commerce/checkout/renamed";
    await expect(generateDraftCapabilities(rootDir, discoveryReport, mismatchedPlan)).rejects.toThrow(
      "does not match path-derived ID"
    );

    const wrongStatusPlan = organizeDiscoveredCapabilityMap(discoveryReport);
    wrongStatusPlan.capabilities[0].status = "planned";
    await expect(generateDraftCapabilities(rootDir, discoveryReport, wrongStatusPlan)).rejects.toThrow(
      "discovered capabilities must use implemented status"
    );
  });

  it("revalidates durable reports before generation", async () => {
    const rootDir = await createProject();
    const discoveryReport = report();
    discoveryReport.candidates[0].implementation_references = ["src/missing.ts"];
    const plan = organizeDiscoveredCapabilityMap(discoveryReport);

    await expect(generateDraftCapabilities(rootDir, discoveryReport, plan)).rejects.toThrow(
      "Candidate evidence path does not exist"
    );
  });

  it("rejects malformed selected plans and mismatched saved report linkage", async () => {
    const rootDir = await createProject();
    const discoveryReport = report();
    const plan = organizeDiscoveredCapabilityMap(discoveryReport);
    await expect(
      generateDraftCapabilities(rootDir, discoveryReport, { ...plan, areas: undefined } as never)
    ).rejects.toThrow("Invalid organized discovery plan");

    await generateDraftCapabilities(rootDir, discoveryReport, plan, { apply: true });
    const changedReport = report();
    changedReport.candidates[0].summary = "Changed after the durable report was saved.";
    await expect(generateDraftCapabilities(rootDir, changedReport, plan, { apply: true, force: true })).rejects.toThrow(
      "Saved discovery report does not match selected report"
    );
  });

  it("generates explicitly retained absent-behavior proposals as planned drafts", async () => {
    const rootDir = await createProject();
    const discoveryReport = report();
    discoveryReport.candidates = [];
    discoveryReport.retained_proposals = [
      {
        title: "Refund payment",
        likely_area: "commerce / checkout",
        summary: "Allow a user to request a refund.",
        inferred_intent: "Retain a planned refund workflow for product review.",
        acceptance_criteria: ["A completed payment can be selected for refund."],
        verification_gaps: ["Refund behavior is not implemented yet."],
        likely_relationships: [],
        likely_dependencies: [],
        confidence: "medium",
        confidence_notes: ["This is an explicitly retained absent-behavior proposal."],
        retention_reason: "The user requested that refund support remain in the generated map."
      }
    ];
    const plan = organizeDiscoveredCapabilityMap(discoveryReport);

    const result = await generateDraftCapabilities(rootDir, discoveryReport, plan, { apply: true });
    const parsed = parseCapability(await readFile(result.files[0].filePath, "utf8"), result.files[0].filePath);
    expect(parsed.capability?.status).toBe("planned");
    expect(parsed.capability?.agent?.implementation).toBeUndefined();
  });
});
