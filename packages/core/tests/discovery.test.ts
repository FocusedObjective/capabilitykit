import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveDiscoveryReport, validateDiscoveryReport } from "../src/discoveryReport.js";

const tempDirs: string[] = [];

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-discovery-report-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".capabilities"), { recursive: true });
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(path.join(rootDir, "src", "checkout.ts"), "export const checkout = true;\n");
  await writeFile(path.join(rootDir, "README.md"), "# Fixture\n");
  return rootDir;
}

function validReport(): string {
  return JSON.stringify({
    inspection_summary: {
      inspected_areas: ["checkout workflow"],
      inspected_paths: ["src/checkout.ts"],
      uninspected_areas: ["production payment provider"]
    },
    candidates: [
      {
        title: "Complete checkout",
        likely_area: "checkout",
        summary: "Allow a user to complete checkout.",
        inferred_intent: "Turn a prepared order into a completed purchase.",
        acceptance_criteria: ["A prepared order can be checked out."],
        implementation_references: ["src/checkout.ts:1"],
        verification_gaps: ["Production payment provider behavior was not inspected."],
        likely_relationships: ["Depends on order preparation."],
        inspected_code_paths: ["src/checkout.ts"],
        confidence: "medium",
        confidence_notes: ["The implementation entrypoint is present but external provider behavior was not inspected."]
      }
    ],
    quarantined_candidates: [
      {
        title: "Refund payment",
        likely_area: "checkout",
        reason: "Only a README mention was found.",
        source_evidence: ["README.md"],
        confidence_notes: ["No implementation path was found."]
      }
    ],
    discovery_gaps: ["Production payment provider behavior was not inspected."],
    confidence_notes: ["Checkout has concrete code evidence."]
  });
}

describe("discovery reports", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("validates code-backed candidates and extracts JSON from agent chatter", async () => {
    const rootDir = await createProject();

    const result = await validateDiscoveryReport(rootDir, `agent output\n${validReport()}\ntokens used`);

    expect(result.valid).toBe(true);
    expect(result.report.candidates[0]?.title).toBe("Complete checkout");
    expect(result.report.quarantined_candidates[0]?.title).toBe("Refund payment");
  });

  it("rejects documentation-only evidence, missing paths, and unlabeled low confidence", async () => {
    const rootDir = await createProject();
    const report = JSON.parse(validReport());
    report.candidates[0].implementation_references = ["README.md"];
    report.candidates[0].inspected_code_paths = ["src/missing.ts"];
    report.candidates[0].confidence = "low";
    report.candidates[0].verification_gaps = [];

    const result = await validateDiscoveryReport(rootDir, JSON.stringify(report));

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("documentation-only-evidence");
    expect(result.issues.map((issue) => issue.code)).toContain("missing-evidence-path");
    expect(result.issues.map((issue) => issue.code)).toContain("low-confidence-without-gap");
  });

  it("rejects supporting context as primary evidence and unlabeled shallow inspection", async () => {
    const rootDir = await createProject();
    const report = JSON.parse(validReport());
    report.candidates[0].implementation_references = ["src/checkout.ts:1", "README.md"];
    report.candidates[0].verification_gaps = [];

    const result = await validateDiscoveryReport(rootDir, JSON.stringify(report));

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("supporting-context-primary-evidence");
    expect(result.issues.map((issue) => issue.code)).toContain("shallow-inspection-without-gap");
  });

  it("requires uninspected areas to be recorded as discovery gaps", async () => {
    const rootDir = await createProject();
    const report = JSON.parse(validReport());
    report.discovery_gaps = [];

    const result = await validateDiscoveryReport(rootDir, JSON.stringify(report));

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("uninspected-area-without-gap");
  });

  it("saves a durable report with provenance and never overwrites an existing report", async () => {
    const rootDir = await createProject();

    const result = await saveDiscoveryReport(rootDir, validReport(), {
      reportId: "checkout-discovery",
      selectedAgentCommand: "codex",
      agentTranscript: "agent transcript"
    });

    expect(result.validation.valid).toBe(true);
    expect(result.filePath).toBe(path.join(rootDir, ".capabilities", "discovery", "checkout-discovery.json"));
    const saved = JSON.parse(await readFile(result.filePath!, "utf8"));
    expect(saved.provenance.report_id).toBe("checkout-discovery");
    expect(saved.provenance.selected_agent_command).toBe("codex");
    expect(saved.provenance.agent_transcript).toBe("agent transcript");
    await expect(saveDiscoveryReport(rootDir, validReport(), { reportId: "checkout-discovery" })).rejects.toThrow(
      "Discovery report already exists"
    );
  });
});
