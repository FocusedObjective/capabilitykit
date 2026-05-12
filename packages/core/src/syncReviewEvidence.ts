import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { adviseImplementationCoverage, type CapabilityAssessmentAdvice, type CriterionAssessmentAdvice } from "./assessmentAdvice.js";

export interface SyncReviewEvidenceResult {
  capabilityId: string;
  filePath: string;
  changed: boolean;
  gaps: string[];
  evidence: string[];
}

export interface SyncReviewEvidenceReport {
  dryRun: boolean;
  results: SyncReviewEvidenceResult[];
}

function reviewStatus(criterion: CriterionAssessmentAdvice): "covered" | "partial" | "uncovered" | "uncertain" {
  if (criterion.status === "covered") {
    return "covered";
  }
  if (criterion.status === "weak-evidence") {
    return "partial";
  }
  if (criterion.status === "assessor-limitation") {
    return "uncertain";
  }
  return "uncovered";
}

function evidencePath(evidence: CriterionAssessmentAdvice["evidence"][number]): string {
  return `${evidence.reference}${evidence.line ? `:${evidence.line}` : ""}`;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function reviewForCapability(capability: CapabilityAssessmentAdvice) {
  const reviewableCriteria = capability.criteria.filter((criterion) => criterion.status !== "ignored");
  const criteria = reviewableCriteria.map((criterion) => {
    const status = reviewStatus(criterion);
    return {
      criterion: criterion.criterion,
      status,
      evidence: criterion.evidence.map(evidencePath),
      notes: `${criterion.rationale} ${criterion.recommendation}`
    };
  });

  const gaps = reviewableCriteria
    .filter((criterion) => reviewStatus(criterion) !== "covered")
    .map((criterion) => `${criterion.criterion} ${criterion.recommendation}`);
  const evidence = uniqueSorted(criteria.flatMap((criterion) => criterion.evidence));
  const done = criteria.length > 0 && criteria.every((criterion) => criterion.status === "covered") && gaps.length === 0;

  return {
    depth: done ? "verified" : "partial",
    intent_summary: `Implementation evidence synchronized from deterministic assessment for ${capability.capabilityId}.`,
    done,
    criteria,
    evidence,
    gaps
  };
}

export async function syncReviewEvidence(
  rootDir: string,
  capabilityId?: string,
  options: { dryRun?: boolean } = {}
): Promise<SyncReviewEvidenceReport> {
  const advice = await adviseImplementationCoverage(rootDir, capabilityId);
  const results: SyncReviewEvidenceResult[] = [];

  for (const capability of advice.capabilities) {
    const review = reviewForCapability(capability);
    const filePath = capability.path.replace(/^\.\//, "");
    const resolvedPath = path.resolve(rootDir, filePath);

    if (!options.dryRun) {
      const document = parseDocument(await fs.readFile(resolvedPath, "utf8"));
      document.setIn(["agent", "review"], review);
      await fs.writeFile(resolvedPath, document.toString());
    }

    results.push({
      capabilityId: capability.capabilityId,
      filePath: resolvedPath,
      changed: !options.dryRun,
      gaps: review.gaps,
      evidence: review.evidence
    });
  }

  return {
    dryRun: Boolean(options.dryRun),
    results
  };
}

export function formatSyncReviewEvidenceReport(report: SyncReviewEvidenceReport): string {
  const lines = [
    `CapabilityKit review sync${report.dryRun ? " (dry run)" : ""}`,
    "",
    `Capabilities: ${report.results.length}`
  ];

  for (const result of report.results) {
    lines.push(
      "",
      `${result.changed ? "Updated" : "Would update"} ${result.capabilityId}`,
      `  Gaps: ${result.gaps.length}`,
      `  Evidence paths: ${result.evidence.length}`
    );
  }

  return `${lines.join("\n")}\n`;
}
