import path from "node:path";
import { adviseImplementationCoverage, type CapabilityAssessmentAdvice } from "./assessmentAdvice.js";
import { loadCapabilities } from "./loadCapabilities.js";
import { validateDurableDiscoveryReport, type DurableDiscoveryReport } from "./discoveryReport.js";
import { parseOrganizedDiscoveryPlan, type OrganizedDiscoveryPlan } from "./discoveryOrganization.js";

export type DiscoveryRefinementPriority = "high" | "medium" | "low";
export type DiscoveryRefinementKind =
  | "weak-code-evidence"
  | "shallow-inspection"
  | "documentation-inference-review"
  | "vague-acceptance"
  | "missing-verification"
  | "poor-area-placement"
  | "assessment-finding"
  | "planned-proposal-review";

export interface DiscoveryRefinementRecommendation {
  kind: DiscoveryRefinementKind;
  priority: DiscoveryRefinementPriority;
  message: string;
  suggestedEdit: string;
}

export interface DiscoveryRefinementDisposition {
  action: "accept" | "revise" | "remove";
  description: string;
}

export interface DiscoveryRefinementCapability {
  capabilityId: string;
  title: string;
  status: "implemented" | "planned";
  path: string;
  candidateKind: "discovered" | "retained-proposal";
  needsHumanReview: boolean;
  recommendations: DiscoveryRefinementRecommendation[];
  dispositions: DiscoveryRefinementDisposition[];
  assessment: CapabilityAssessmentAdvice;
  auditTrail: {
    reportId: string;
    reportPath: string;
    auditPath: string;
    inspectedCodePaths: string[];
    confidenceNotes: string[];
    groupingDecision: OrganizedDiscoveryPlan["capabilities"][number]["groupingDecision"];
  };
}

export interface DiscoveryRefinementReport {
  reportId: string;
  capabilities: DiscoveryRefinementCapability[];
  quarantinedCandidates: DurableDiscoveryReport["quarantined_candidates"];
  discoveryGaps: string[];
  summary: {
    generatedCapabilities: number;
    needingHumanReview: number;
    recommendations: number;
  };
}

function isVagueAcceptance(criterion: string): boolean {
  return (
    criterion.split(/\s+/).length < 5 ||
    /\b(works|supported|handled|appropriate|correctly|as expected|clear)\b/i.test(criterion)
  );
}

function isSupportingContextOnly(reference: string): boolean {
  const normalized = (reference.match(/^(.*):\d+$/)?.[1] ?? reference).replace(/\\/g, "/").toLowerCase();
  const basename = path.posix.basename(normalized);
  return (
    basename.startsWith("readme") ||
    basename === "package.json" ||
    basename === "package-lock.json" ||
    basename === "pnpm-lock.yaml" ||
    basename === "yarn.lock" ||
    normalized.startsWith("docs/") ||
    /\.(md|mdx|txt)$/.test(normalized)
  );
}

function uniqueRecommendations(recommendations: DiscoveryRefinementRecommendation[]): DiscoveryRefinementRecommendation[] {
  return recommendations.filter(
    (recommendation, index, all) =>
      all.findIndex((candidate) => candidate.kind === recommendation.kind && candidate.message === recommendation.message) ===
      index
  );
}

function assessmentRecommendations(assessment: CapabilityAssessmentAdvice): DiscoveryRefinementRecommendation[] {
  return assessment.criteria
    .filter((criterion) => criterion.action !== "none")
    .map((criterion) => ({
      kind: "assessment-finding" as const,
      priority: criterion.status === "implementation-gap" || criterion.status === "missing-reference" ? "high" : "medium",
      message: `${criterion.status}: ${criterion.criterion}`,
      suggestedEdit: criterion.recommendation
    }));
}

export async function refineDiscoveredCapabilities(
  rootDir: string,
  report: DurableDiscoveryReport,
  plan: OrganizedDiscoveryPlan
): Promise<DiscoveryRefinementReport> {
  const resolvedRoot = path.resolve(rootDir);
  const reportValidation = await validateDurableDiscoveryReport(resolvedRoot, JSON.stringify(report));
  if (!reportValidation.valid) {
    throw new Error(`Invalid durable discovery report: ${reportValidation.issues.map((issue) => issue.message).join("; ")}`);
  }
  report = reportValidation.report;
  plan = parseOrganizedDiscoveryPlan(plan);
  const loaded = await loadCapabilities(resolvedRoot);
  const reportPath = `.capabilities/discovery/${report.provenance.report_id}.json`;
  const auditPath = `.capabilities/discovery/${report.provenance.report_id}.generation-plan.json`;
  const capabilities: DiscoveryRefinementCapability[] = [];

  for (const organized of plan.capabilities) {
    const loadedCapability = loaded.capabilities.find(({ capability }) => capability.id === organized.capabilityId);
    if (!loadedCapability) {
      throw new Error(`Generated capability not found: ${organized.capabilityId}`);
    }
    const candidate =
      organized.candidateKind === "discovered"
        ? report.candidates.find((item) => item.title === organized.title)
        : report.retained_proposals.find((item) => item.title === organized.title);
    if (!candidate) {
      throw new Error(`Discovery evidence not found for generated capability: ${organized.capabilityId}`);
    }
    const advice = await adviseImplementationCoverage(resolvedRoot, organized.capabilityId);
    const assessment = advice.capabilities[0];
    const recommendations = assessmentRecommendations(assessment);

    if (organized.candidateKind === "retained-proposal") {
      recommendations.push({
        kind: "planned-proposal-review",
        priority: "medium",
        message: "This planned draft represents explicitly retained absent behavior.",
        suggestedEdit: "Accept the planned proposal, revise its product intent, or remove the generated draft after review."
      });
    } else if (organized.implementationReferences.length < 2) {
      recommendations.push({
        kind: "weak-code-evidence",
        priority: "high",
        message: "The generated draft has fewer than two concrete implementation references.",
        suggestedEdit: "Inspect another relevant implementation path and add a concrete code or test reference."
      });
    }
    if ("inspected_code_paths" in candidate && candidate.inspected_code_paths.length < 2) {
      recommendations.push({
        kind: "shallow-inspection",
        priority: "medium",
        message: "The discovery candidate was backed by a shallow inspected-path summary.",
        suggestedEdit: "Revisit adjacent entrypoints, tests, handlers, or persistence code before accepting the draft."
      });
    }
    if (
      "implementation_references" in candidate &&
      candidate.implementation_references.some(isSupportingContextOnly)
    ) {
      recommendations.push({
        kind: "documentation-inference-review",
        priority: "medium",
        message: "The discovery candidate includes supporting documentation or package metadata references.",
        suggestedEdit: "Review each inferred acceptance criterion against implementation code and keep supporting context secondary."
      });
    }
    for (const criterion of candidate.acceptance_criteria.filter(isVagueAcceptance)) {
      recommendations.push({
        kind: "vague-acceptance",
        priority: "medium",
        message: `Acceptance criterion may be vague: ${criterion}`,
        suggestedEdit: "Rewrite the criterion as a specific observable behavior grounded in implementation evidence."
      });
    }
    if (candidate.verification_gaps.length === 0) {
      recommendations.push({
        kind: "missing-verification",
        priority: "medium",
        message: "The generated draft has no explicit verification gap.",
        suggestedEdit: "Confirm deterministic coverage or add the remaining manual or automated verification gap."
      });
    }
    if (organized.groupingDecision.notes.length > 0) {
      recommendations.push({
        kind: "poor-area-placement",
        priority: "medium",
        message: organized.groupingDecision.notes.join(" "),
        suggestedEdit: "Review the generated area placement and move the draft if a product-domain folder is clearer."
      });
    }
    const unique = uniqueRecommendations(recommendations);
    capabilities.push({
      capabilityId: organized.capabilityId,
      title: organized.title,
      status: organized.status,
      path: `.capabilities/${loadedCapability.relativePath}`,
      candidateKind: organized.candidateKind,
      needsHumanReview: unique.length > 0,
      recommendations: unique,
      dispositions: [
        { action: "accept", description: "Keep the generated draft and preserve its discovery audit trail." },
        { action: "revise", description: "Edit the draft while retaining its discovery report and generation-plan links." },
        { action: "remove", description: "Remove the draft only after reviewing the retained discovery audit trail." }
      ],
      assessment,
      auditTrail: {
        reportId: report.provenance.report_id,
        reportPath,
        auditPath,
        inspectedCodePaths: "inspected_code_paths" in candidate ? candidate.inspected_code_paths : [],
        confidenceNotes: candidate.confidence_notes,
        groupingDecision: organized.groupingDecision
      }
    });
  }

  return {
    reportId: report.provenance.report_id,
    capabilities,
    quarantinedCandidates: report.quarantined_candidates,
    discoveryGaps: report.discovery_gaps,
    summary: {
      generatedCapabilities: capabilities.length,
      needingHumanReview: capabilities.filter((capability) => capability.needsHumanReview).length,
      recommendations: capabilities.reduce((total, capability) => total + capability.recommendations.length, 0)
    }
  };
}

export function formatDiscoveryRefinementReport(report: DiscoveryRefinementReport): string {
  const lines = [
    `CapabilityKit discovery refinement: ${report.reportId}`,
    "",
    `${report.summary.generatedCapabilities} generated capabilities`,
    `${report.summary.needingHumanReview} need human review`,
    `${report.summary.recommendations} recommendations`
  ];
  for (const capability of report.capabilities) {
    lines.push("", `${capability.capabilityId} [${capability.status}]`);
    for (const recommendation of capability.recommendations) {
      lines.push(`  - ${recommendation.priority} ${recommendation.kind}: ${recommendation.message}`);
      lines.push(`    Edit: ${recommendation.suggestedEdit}`);
    }
    lines.push(`  Audit: ${capability.auditTrail.reportPath}`);
  }
  return `${lines.join("\n")}\n`;
}
