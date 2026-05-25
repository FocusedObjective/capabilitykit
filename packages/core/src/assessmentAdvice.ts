import { assessImplementationCoverage, type AcceptanceCriterionCoverage } from "./assessImplementationCoverage.js";
import { loadCapabilities } from "./loadCapabilities.js";
import { validateLoadedCapabilities } from "./validateCapabilities.js";
import type { AgentReviewCriterion, AgentReviewSource, AssessmentFindingIgnore, Capability, VerificationGap } from "./types.js";

export type AssessmentAdviceStatus =
  | "covered"
  | "weak-evidence"
  | "implementation-gap"
  | "missing-reference"
  | "no-implementation-reference"
  | "assessor-limitation"
  | "ignored";

export type AssessmentAdviceAction =
  | "none"
  | "add-implementation-reference"
  | "fix-implementation-reference"
  | "inspect-evidence"
  | "add-code-or-test"
  | "split-or-clarify-criterion"
  | "manual-review";

export interface CriterionAssessmentAdvice {
  capabilityId: string;
  title: string;
  criterion: string;
  status: AssessmentAdviceStatus;
  confidence: "high" | "medium" | "low";
  action: AssessmentAdviceAction;
  rationale: string;
  recommendation: string;
  evidence: AcceptanceCriterionCoverage["evidence"];
}

export interface CapabilityAssessmentAdvice {
  capabilityId: string;
  title: string;
  status: Capability["status"];
  path: string;
  references: {
    total: number;
    readable: number;
    missing: string[];
  };
  criteria: CriterionAssessmentAdvice[];
}

export interface AssessmentAdviceReport {
  project: string;
  capabilities: CapabilityAssessmentAdvice[];
  summary: {
    capabilities: number;
    criteria: number;
    statuses: Record<AssessmentAdviceStatus, number>;
    actions: Record<AssessmentAdviceAction, number>;
    verificationGaps: number;
  };
  verificationGaps: VerificationGap[];
}

const adviceStatuses: AssessmentAdviceStatus[] = [
  "covered",
  "weak-evidence",
  "implementation-gap",
  "missing-reference",
  "no-implementation-reference",
  "assessor-limitation",
  "ignored"
];

const adviceActions: AssessmentAdviceAction[] = [
  "none",
  "add-implementation-reference",
  "fix-implementation-reference",
  "inspect-evidence",
  "add-code-or-test",
  "split-or-clarify-criterion",
  "manual-review"
];

function emptyCounts<T extends string>(values: T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function looksBroad(criterion: string): boolean {
  const normalized = criterion.toLowerCase();
  return normalized.includes(" and ") || normalized.includes(" or ") || criterion.includes(",") || criterion.split(/\s+/).length > 12;
}

function classifyCriterion(
  capability: Capability,
  criterion: AcceptanceCriterionCoverage,
  references: { total: number; readable: number; missing: string[] }
): Omit<CriterionAssessmentAdvice, "capabilityId" | "title" | "criterion" | "evidence"> {
  if (references.total === 0) {
    return {
      status: "no-implementation-reference",
      confidence: "high",
      action: "add-implementation-reference",
      rationale: "The capability has no agent.implementation.references, so the assessor has no concrete files to inspect.",
      recommendation: `Add agent.implementation.references to ${capability.id}, or lower the status if this capability is only planned.`
    };
  }

  if (references.readable === 0 || (criterion.status === "uncovered" && references.missing.length > 0)) {
    return {
      status: "missing-reference",
      confidence: "high",
      action: "fix-implementation-reference",
      rationale: "One or more referenced implementation files are missing or unreadable.",
      recommendation: `Fix or remove missing references for ${capability.id}: ${references.missing.join(", ")}.`
    };
  }

  if (criterion.status === "covered") {
    return {
      status: "covered",
      confidence: "high",
      action: "none",
      rationale: "The criterion text appears directly in referenced implementation evidence.",
      recommendation: "No action needed."
    };
  }

  if (criterion.status === "uncertain") {
    return {
      status: "weak-evidence",
      confidence: "medium",
      action: "inspect-evidence",
      rationale: "Related implementation text was found, but deterministic matching cannot prove the behavior.",
      recommendation: "Review the cited evidence. If it is correct, save agent.review evidence or make the criterion/reference wording more explicit."
    };
  }

  if (looksBroad(criterion.criterion)) {
    return {
      status: "assessor-limitation",
      confidence: "medium",
      action: "split-or-clarify-criterion",
      rationale: "The criterion is broad or compound, which makes deterministic evidence matching brittle.",
      recommendation: "Split the criterion into smaller observable behaviors, or add more targeted implementation/test references."
    };
  }

  return {
    status: "implementation-gap",
    confidence: "medium",
    action: "add-code-or-test",
    rationale: "Readable references exist, but no deterministic evidence matched this criterion.",
    recommendation: "Either implement or test this behavior, or update the capability if the criterion no longer reflects intended behavior."
  };
}

function matchingIgnore(
  ignores: AssessmentFindingIgnore[],
  criterion: string,
  advice: Omit<CriterionAssessmentAdvice, "capabilityId" | "title" | "criterion">
): AssessmentFindingIgnore | undefined {
  return ignores.find((ignore) => {
    const statusMatches = ignore.status === "*" || ignore.status === advice.status;
    const exactCriterionMatches = ignore.criterion === undefined || ignore.criterion === criterion;
    const containsCriterionMatches =
      ignore.criterion_contains === undefined || criterion.includes(ignore.criterion_contains);
    return statusMatches && exactCriterionMatches && containsCriterionMatches;
  });
}

function ignoredAdvice(
  ignore: AssessmentFindingIgnore,
  evidence: AcceptanceCriterionCoverage["evidence"]
): Omit<CriterionAssessmentAdvice, "capabilityId" | "title" | "criterion"> {
  return {
    status: "ignored",
    confidence: "high",
    action: "none",
    rationale: `Ignored by agent.review.ignore_findings. Reason: ${ignore.reason}`,
    recommendation: "No action needed.",
    evidence
  };
}

function evidenceFromReview(evidence: string): AcceptanceCriterionCoverage["evidence"][number] {
  const match = evidence.match(/^(.*):(\d+)$/);
  return {
    reference: match?.[1] ?? evidence,
    line: match?.[2] ? Number(match[2]) : undefined,
    excerpt: "Saved agent.review evidence"
  };
}

function adviceFromSavedReview(
  review: AgentReviewCriterion | undefined,
  source: AgentReviewSource | undefined
): Omit<CriterionAssessmentAdvice, "capabilityId" | "title" | "criterion"> | undefined {
  if (!review) {
    return undefined;
  }

  if (source === "deterministic-assessment") {
    return undefined;
  }

  const evidence = review.evidence.map(evidenceFromReview);
  const notes = review.notes ? ` Notes: ${review.notes}` : "";
  const reviewer = source === "human" ? "human review" : "coding-agent review";

  if (review.status === "covered") {
    return {
      status: "covered",
      confidence: "high",
      action: "none",
      rationale: `Saved ${reviewer} marks this criterion covered.${notes}`,
      recommendation: "No action needed.",
      evidence
    };
  }

  if (review.status === "partial") {
    return {
      status: "weak-evidence",
      confidence: "high",
      action: "inspect-evidence",
      rationale: `Saved ${reviewer} marks this criterion partially covered.${notes}`,
      recommendation: "Review the saved evidence and resolve the remaining partial coverage before marking this criterion covered.",
      evidence
    };
  }

  if (review.status === "uncovered") {
    return {
      status: "implementation-gap",
      confidence: "high",
      action: "add-code-or-test",
      rationale: `Saved ${reviewer} marks this criterion uncovered.${notes}`,
      recommendation: "Implement or test this behavior, or update the capability if the criterion no longer reflects intended behavior.",
      evidence
    };
  }

  return {
    status: "assessor-limitation",
    confidence: "high",
    action: "manual-review",
    rationale: `Saved ${reviewer} marks this criterion uncertain.${notes}`,
    recommendation: "Run a human or Codex review for this criterion, or split the criterion into smaller observable behavior.",
    evidence
  };
}

export async function adviseImplementationCoverage(
  rootDir: string,
  capabilityId?: string
): Promise<AssessmentAdviceReport> {
  const loaded = await loadCapabilities(rootDir);
  const validation = validateLoadedCapabilities(loaded);
  const selected = capabilityId
    ? loaded.capabilities.filter((item) => item.capability.id === capabilityId)
    : loaded.capabilities;

  if (capabilityId && selected.length === 0) {
    throw new Error(`Capability not found: ${capabilityId}`);
  }

  const capabilities: CapabilityAssessmentAdvice[] = [];

  for (const item of selected) {
    const coverage = await assessImplementationCoverage(rootDir, item.capability.id);
    const references = {
      total: coverage.references.length,
      readable: coverage.references.filter((reference) => reference.readable).length,
      missing: coverage.missingReferences
    };

    capabilities.push({
      capabilityId: item.capability.id,
      title: item.capability.title,
      status: item.capability.status,
      path: `.capabilities/${item.relativePath}`,
      references,
      criteria: coverage.criteria.map((criterion) => {
        const savedReview = item.capability.agent?.review?.criteria?.find((review) => review.criterion === criterion.criterion);
        const savedAdvice = adviceFromSavedReview(savedReview, item.capability.agent?.review?.source);
        const baseAdvice = savedAdvice ?? {
          evidence: criterion.evidence,
          ...classifyCriterion(item.capability, criterion, references)
        };
        const ignore = matchingIgnore(item.capability.agent?.review?.ignore_findings ?? [], criterion.criterion, baseAdvice);
        return {
          capabilityId: item.capability.id,
          title: item.capability.title,
          criterion: criterion.criterion,
          ...(ignore ? ignoredAdvice(ignore, baseAdvice.evidence) : baseAdvice)
        };
      })
    });
  }

  const statuses = emptyCounts(adviceStatuses);
  const actions = emptyCounts(adviceActions);
  let criteria = 0;

  for (const capability of capabilities) {
    for (const criterion of capability.criteria) {
      criteria += 1;
      statuses[criterion.status] += 1;
      actions[criterion.action] += 1;
    }
  }

  return {
    project: loaded.config.project.name,
    capabilities,
    summary: {
      capabilities: capabilities.length,
      criteria,
      statuses,
      actions,
      verificationGaps: validation.verificationGaps.length
    },
    verificationGaps: validation.verificationGaps
  };
}

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  return ["", `## ${title}`, "", ...lines];
}

function evidenceSummary(criterion: CriterionAssessmentAdvice): string {
  if (criterion.evidence.length === 0) {
    return "Evidence: none";
  }
  const first = criterion.evidence[0];
  return `Evidence: ${first.reference}${first.line ? `:${first.line}` : ""}`;
}

export function formatAssessmentAdviceReport(report: AssessmentAdviceReport): string {
  const lines = [
    `# CapabilityKit Advice: ${report.project}`,
    "",
    "## Summary",
    "",
    `- Capabilities assessed: ${report.summary.capabilities}`,
    `- Criteria assessed: ${report.summary.criteria}`,
    `- Verification gaps: ${report.summary.verificationGaps}`,
    `- Covered: ${report.summary.statuses.covered}`,
    `- Weak evidence: ${report.summary.statuses["weak-evidence"]}`,
    `- Implementation gaps: ${report.summary.statuses["implementation-gap"]}`,
    `- Missing references: ${report.summary.statuses["missing-reference"]}`,
    `- No implementation references: ${report.summary.statuses["no-implementation-reference"]}`,
    `- Assessor limitations: ${report.summary.statuses["assessor-limitation"]}`,
    `- Ignored findings: ${report.summary.statuses.ignored}`
  ];

  const actionLines = report.capabilities.flatMap((capability) =>
    capability.criteria
      .filter((criterion) => criterion.action !== "none")
      .map((criterion) =>
        [
          `- ${criterion.status}: ${capability.capabilityId}`,
          `  Criterion: ${criterion.criterion}`,
          `  Advice: ${criterion.recommendation}`,
          `  ${evidenceSummary(criterion)}`
        ].join("\n")
      )
  );

  lines.push(...section("Recommended Actions", actionLines));

  if (report.verificationGaps.length > 0) {
    lines.push(
      ...section(
        "Verification Gaps",
        report.verificationGaps.map((gap) => `- ${gap.message}`)
      )
    );
  }

  const detailLines = report.capabilities.map((capability) => {
    const header = `### ${capability.title} (${capability.capabilityId})`;
    const refs = `References: ${capability.references.readable}/${capability.references.total} readable`;
    const criteria = capability.criteria.map((criterion, index) =>
      [
        `${index + 1}. ${criterion.status} (${criterion.confidence}): ${criterion.criterion}`,
        `   Rationale: ${criterion.rationale}`,
        `   Recommendation: ${criterion.recommendation}`,
        `   ${evidenceSummary(criterion)}`
      ].join("\n")
    );
    return [header, "", refs, "", ...criteria].join("\n");
  });

  lines.push(...section("Capability Details", detailLines));

  return `${lines.join("\n")}\n`;
}
