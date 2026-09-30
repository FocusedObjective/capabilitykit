import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { adviseImplementationCoverage, type CapabilityAssessmentAdvice, type CriterionAssessmentAdvice } from "./assessmentAdvice.js";
import { agentMetadataCommentLines } from "./agentMetadataComments.js";
import { setAgentSectionComment } from "./agentSectionComment.js";

export interface SyncReviewEvidenceResult {
  capabilityId: string;
  filePath: string;
  changed: boolean;
  gaps: string[];
  evidence: string[];
  retained?: boolean;
  signal?: "green" | "amber" | "red";
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
    const evidence = criterion.evidence.map(evidencePath);
    return {
      criterion: criterion.criterion,
      status,
      ...(evidence.length > 0 ? { evidence } : {}),
      notes: `${criterion.rationale} ${criterion.recommendation}`
    };
  });

  const gaps = reviewableCriteria
    .filter((criterion) => reviewStatus(criterion) !== "covered")
    .map((criterion) => `${criterion.criterion} ${criterion.recommendation}`);
  const evidence = uniqueSorted(criteria.flatMap((criterion) => criterion.evidence ?? []));
  const done = criteria.length > 0 && criteria.every((criterion) => criterion.status === "covered") && gaps.length === 0;

  return {
    depth: done ? "verified" : "partial",
    source: "deterministic-assessment",
    intent_summary: `Implementation evidence synchronized from deterministic assessment for ${capability.capabilityId}.`,
    done,
    criteria,
    evidence,
    ...(gaps.length > 0 ? { gaps } : {})
  };
}

export async function syncReviewEvidence(
  rootDir: string,
  capabilityId?: string,
  options: { dryRun?: boolean; preserveSemantic?: boolean } = {}
): Promise<SyncReviewEvidenceReport> {
  const advice = await adviseImplementationCoverage(rootDir, capabilityId);
  const results: SyncReviewEvidenceResult[] = [];

  for (const capability of advice.capabilities) {
    const review = reviewForCapability(capability);
    const filePath = capability.path.replace(/^\.\//, "");
    const resolvedPath = path.resolve(rootDir, filePath);
    const { evidence, ...reviewForYaml } = review;

    const document = parseDocument(await fs.readFile(resolvedPath, "utf8"));
    const source = document.getIn(["agent", "review", "source"]);
    const retained = Boolean(options.preserveSemantic && (source === "coding-agent" || source === "human"));
    if (!options.dryRun && !retained) {
      document.setIn(["agent", "review"], reviewForYaml);
      setAgentSectionComment(document, agentMetadataCommentLines(capability.capabilityId));
      await fs.writeFile(resolvedPath, document.toString());
    }

    results.push({
      capabilityId: capability.capabilityId,
      filePath: resolvedPath,
      changed: !options.dryRun && !retained,
      retained,
      signal: capability.status === "planned" || advice.verificationGaps.some((gap) => gap.capabilityId === capability.capabilityId) ||
        capability.criteria.some((criterion) => ["implementation-gap", "missing-reference", "no-implementation-reference"].includes(criterion.status))
        ? "red" : capability.criteria.some((criterion) => criterion.status !== "covered" && criterion.status !== "ignored") ? "amber" : "green",
      gaps: review.gaps ?? [],
      evidence
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
    const light = result.signal === "green" ? "🟢" : result.signal === "red" ? "🔴" : "🟠";
    lines.push(
      `${light} ${result.retained ? "Kept semantic review" : result.changed ? "Updated" : "Would update"} ${result.capabilityId} — ${result.gaps.length} findings`
    );
  }

  lines.push("", "Local evidence summary; semantic review and verification confidence remain available in capabilitykit status <id>.");

  return `${lines.join("\n")}\n`;
}
