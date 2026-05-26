import { adviseImplementationCoverage, type AssessmentAdviceStatus, type CriterionAssessmentAdvice } from "./assessmentAdvice.js";
import { loadCapabilities } from "./loadCapabilities.js";
import { validateLoadedCapabilities } from "./validateCapabilities.js";
import type { Capability, VerificationGap } from "./types.js";

export type CapabilityHealth = "ok" | "review" | "action" | "planned";

export interface StoryMapGroup {
  release: string;
  backbone: string;
  step: string;
  order?: number;
}

export interface CapabilityStatusSummary {
  capabilityId: string;
  title: string;
  status: Capability["status"];
  area: string;
  path: string;
  health: CapabilityHealth;
  summary: string;
  intent: string;
  references: {
    total: number;
    readable: number;
    missing: string[];
  };
  verification: {
    automated: number;
    manual: number;
    gaps: VerificationGap[];
  };
  counts: Record<AssessmentAdviceStatus, number>;
  nextAction: string;
  topFindings: CriterionAssessmentAdvice[];
  storyMap?: StoryMapGroup;
}

export interface StoryMapReleaseReport {
  release: string;
  capabilities: CapabilityStatusSummary[];
  deliveryStrategy: StoryMapDeliveryStrategy;
}

export type StoryMapDeliveryPhase = "opening" | "mid-game" | "end-game";

export interface StoryMapSliceRecommendation {
  order: number;
  phase: StoryMapDeliveryPhase;
  name: string;
  capabilityIds: string[];
  releaseStrategy: string;
  developmentStrategy: string;
  riskIntent: string;
  learningIntent: string;
  backboneCoverage: string[];
  missingBackbones: string[];
  stepCoverageGaps: string[];
  rationale: string;
}

export interface StoryMapDeliveryStrategy {
  release: string;
  recommendations: StoryMapSliceRecommendation[];
}

export interface CapabilityStatusReport {
  project: string;
  capabilities: CapabilityStatusSummary[];
  byStoryMap: {
    unassigned: CapabilityStatusSummary[];
    releases: StoryMapReleaseReport[];
  };
  summary: {
    total: number;
    ok: number;
    review: number;
    action: number;
    planned: number;
  };
}

const statuses: AssessmentAdviceStatus[] = [
  "covered",
  "weak-evidence",
  "implementation-gap",
  "missing-reference",
  "no-implementation-reference",
  "assessor-limitation",
  "ignored"
];

function emptyCounts(): Record<AssessmentAdviceStatus, number> {
  return Object.fromEntries(statuses.map((status) => [status, 0])) as Record<AssessmentAdviceStatus, number>;
}

function healthFor(
  capability: Capability,
  counts: Record<AssessmentAdviceStatus, number>,
  verificationGaps: VerificationGap[]
): CapabilityHealth {
  if (capability.status === "planned" || capability.status === "in-progress") {
    return "planned";
  }

  if (
    counts["implementation-gap"] > 0 ||
    counts["missing-reference"] > 0 ||
    counts["no-implementation-reference"] > 0 ||
    verificationGaps.length > 0
  ) {
    return "action";
  }

  if (counts["weak-evidence"] > 0 || counts["assessor-limitation"] > 0) {
    return "review";
  }

  return "ok";
}

function nextActionFor(summary: {
  health: CapabilityHealth;
  counts: Record<AssessmentAdviceStatus, number>;
  verificationGaps: VerificationGap[];
}): string {
  if (summary.health === "planned") {
    return "Keep as roadmap context until implementation starts.";
  }
  if (summary.counts["no-implementation-reference"] > 0) {
    return "Add implementation references or lower the capability status.";
  }
  if (summary.counts["missing-reference"] > 0) {
    return "Fix missing implementation reference paths.";
  }
  if (summary.verificationGaps.length > 0) {
    return "Resolve or explicitly ignore verification gaps.";
  }
  if (summary.counts["implementation-gap"] > 0) {
    return "Implement or test missing behavior, or update the capability intent.";
  }
  if (summary.counts["assessor-limitation"] > 0) {
    return "Split broad criteria or run semantic review.";
  }
  if (summary.counts["weak-evidence"] > 0) {
    return "Run semantic review, save review evidence, or ignore accepted findings.";
  }
  return "No immediate action.";
}

function topFindings(criteria: CriterionAssessmentAdvice[]): CriterionAssessmentAdvice[] {
  const priority: Record<AssessmentAdviceStatus, number> = {
    "missing-reference": 0,
    "no-implementation-reference": 1,
    "implementation-gap": 2,
    "assessor-limitation": 3,
    "weak-evidence": 4,
    covered: 5,
    ignored: 6
  };

  return criteria
    .filter((criterion) => criterion.action !== "none")
    .sort((a, b) => priority[a.status] - priority[b.status] || a.criterion.localeCompare(b.criterion))
    .slice(0, 3);
}

export async function summarizeCapabilityStatus(rootDir: string, capabilityId?: string): Promise<CapabilityStatusReport> {
  const loaded = await loadCapabilities(rootDir);
  const validation = validateLoadedCapabilities(loaded);
  const advice = await adviseImplementationCoverage(rootDir, capabilityId);
  const loadedById = new Map(loaded.capabilities.map((item) => [item.capability.id, item]));
  const capabilities: CapabilityStatusSummary[] = [];

  for (const capabilityAdvice of advice.capabilities) {
    const loadedCapability = loadedById.get(capabilityAdvice.capabilityId);
    if (!loadedCapability) {
      continue;
    }

    const counts = emptyCounts();
    for (const criterion of capabilityAdvice.criteria) {
      counts[criterion.status] += 1;
    }

    const capabilityVerificationGaps = validation.verificationGaps.filter(
      (gap) => gap.capabilityId === capabilityAdvice.capabilityId
    );
    const health = healthFor(loadedCapability.capability, counts, capabilityVerificationGaps);

    capabilities.push({
      capabilityId: capabilityAdvice.capabilityId,
      title: capabilityAdvice.title,
      status: loadedCapability.capability.status,
      area: loadedCapability.capability.area,
      path: capabilityAdvice.path,
      health,
      summary: loadedCapability.capability.summary,
      intent: loadedCapability.capability.intent,
      references: capabilityAdvice.references,
      verification: {
        automated: loadedCapability.capability.agent?.verification?.automated?.length ?? 0,
        manual: loadedCapability.capability.agent?.verification?.manual?.length ?? 0,
        gaps: capabilityVerificationGaps
      },
      counts,
      nextAction: nextActionFor({ health, counts, verificationGaps: capabilityVerificationGaps }),
      topFindings: topFindings(capabilityAdvice.criteria),
      storyMap: loadedCapability.capability.planning?.story_map
        ? {
            release: loadedCapability.capability.planning.story_map.release,
            backbone: loadedCapability.capability.planning.story_map.backbone,
            step: loadedCapability.capability.planning.story_map.step,
            order: loadedCapability.capability.planning.story_map.order
          }
        : undefined
    });
  }

  const summary = {
    total: capabilities.length,
    ok: capabilities.filter((capability) => capability.health === "ok").length,
    review: capabilities.filter((capability) => capability.health === "review").length,
    action: capabilities.filter((capability) => capability.health === "action").length,
    planned: capabilities.filter((capability) => capability.health === "planned").length
  };

  const unassigned = capabilities.filter((capability) => !capability.storyMap);
  const releasesMap = new Map<string, CapabilityStatusSummary[]>();
  for (const capability of capabilities) {
    const release = capability.storyMap?.release;
    if (!release) continue;
    releasesMap.set(release, [...(releasesMap.get(release) ?? []), capability]);
  }

  return {
    project: advice.project,
    capabilities: capabilities.sort(
      (a, b) =>
        ["action", "review", "planned", "ok"].indexOf(a.health) -
          ["action", "review", "planned", "ok"].indexOf(b.health) ||
        a.capabilityId.localeCompare(b.capabilityId)
    ),
    byStoryMap: {
      unassigned,
      releases: [...releasesMap.entries()]
        .sort((a,b)=>a[0].localeCompare(b[0]))
        .map(([release, capabilities]) => ({
          release,
          capabilities,
          deliveryStrategy: recommendDeliveryStrategy(release, capabilities)
        }))
    },
    summary
  };
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function compareStoryMapCapabilities(a: CapabilityStatusSummary, b: CapabilityStatusSummary): number {
  return (
    (a.storyMap?.order ?? Number.MAX_SAFE_INTEGER) - (b.storyMap?.order ?? Number.MAX_SAFE_INTEGER) ||
    (a.storyMap?.backbone ?? "").localeCompare(b.storyMap?.backbone ?? "") ||
    (a.storyMap?.step ?? "").localeCompare(b.storyMap?.step ?? "") ||
    a.capabilityId.localeCompare(b.capabilityId)
  );
}

function riskSignals(capabilities: CapabilityStatusSummary[]): string[] {
  const signals = sortedUnique(
    capabilities.flatMap((capability) => {
      const findings = [
        capability.health === "action" ? `${capability.capabilityId} needs action` : "",
        capability.health === "review" ? `${capability.capabilityId} needs review` : "",
        capability.verification.gaps.length > 0 ? `${capability.capabilityId} has verification gaps` : "",
        capability.references.missing.length > 0 ? `${capability.capabilityId} has missing references` : ""
      ].filter(Boolean);
      return findings.length > 0 ? findings : [`${capability.capabilityId} has normal delivery risk`];
    })
  );
  return signals;
}

function recommendDeliveryStrategy(
  release: string,
  capabilities: CapabilityStatusSummary[]
): StoryMapDeliveryStrategy {
  const mapped = capabilities
    .filter((capability): capability is CapabilityStatusSummary & { storyMap: StoryMapGroup } => Boolean(capability.storyMap))
    .sort(compareStoryMapCapabilities);
  const recommendations: StoryMapSliceRecommendation[] = [];
  const used = new Set<string>();
  const releaseBackbones = sortedUnique(mapped.map((capability) => capability.storyMap.backbone));
  const releaseSteps = sortedUnique(mapped.map((capability) => `${capability.storyMap.backbone} > ${capability.storyMap.step}`));

  const opening = releaseBackbones
    .map((backbone) => mapped.find((capability) => capability.storyMap.backbone === backbone))
    .filter((capability): capability is CapabilityStatusSummary & { storyMap: StoryMapGroup } => Boolean(capability));

  if (opening.length > 0) {
    for (const capability of opening) {
      used.add(capability.capabilityId);
    }
    recommendations.push({
      order: 1,
      phase: "opening",
      name: "Walking skeleton",
      capabilityIds: opening.map((capability) => capability.capabilityId),
      releaseStrategy: "Prove one coherent end-to-end slice before deepening individual steps.",
      developmentStrategy: "Integrate the earliest capability from each backbone first, keeping scope thin until the narrative works.",
      riskIntent: riskSignals(opening).join("; "),
      learningIntent: "Validate whether users and stakeholders can recognize a meaningful outcome across the release backbone.",
      backboneCoverage: releaseBackbones,
      missingBackbones: releaseBackbones.filter(
        (backbone) => !opening.some((capability) => capability.storyMap.backbone === backbone)
      ),
      stepCoverageGaps: releaseSteps.filter(
        (step) => !opening.some((capability) => `${capability.storyMap.backbone} > ${capability.storyMap.step}` === step)
      ),
      rationale:
        releaseBackbones.length > 1
          ? `Starts with one step from each mapped backbone: ${releaseBackbones.join(", ")}.`
          : `Starts with the earliest mapped step in ${releaseBackbones.join(", ")}.`
    });
  }

  const remaining = mapped.filter((capability) => !used.has(capability.capabilityId));
  const highRisk = remaining.filter((capability) => capability.health === "action" || capability.health === "review");
  const progressive = remaining.filter((capability) => capability.health !== "action" && capability.health !== "review");

  if (progressive.length > 0) {
    recommendations.push({
      order: recommendations.length + 1,
      phase: "mid-game",
      name: "Progressive capability layer",
      capabilityIds: progressive.map((capability) => capability.capabilityId),
      releaseStrategy: "Add the next coherent layer of user-visible capability after the walking skeleton is usable.",
      developmentStrategy: "Build in story-map order while preserving the release narrative and avoiding isolated deep work.",
      riskIntent: riskSignals(progressive).join("; "),
      learningIntent: "Learn which adjacent steps increase outcome value before investing in optimization or hardening.",
      backboneCoverage: sortedUnique(progressive.map((capability) => capability.storyMap.backbone)),
      missingBackbones: releaseBackbones.filter(
        (backbone) => !progressive.some((capability) => capability.storyMap.backbone === backbone)
      ),
      stepCoverageGaps: releaseSteps.filter(
        (step) => !progressive.some((capability) => `${capability.storyMap.backbone} > ${capability.storyMap.step}` === step)
      ),
      rationale: `Follows story-map order across ${sortedUnique(progressive.map((capability) => capability.storyMap.step)).join(", ")}.`
    });
  }

  if (highRisk.length > 0) {
    recommendations.push({
      order: recommendations.length + 1,
      phase: "end-game",
      name: "Risk burn-down and release hardening",
      capabilityIds: highRisk.map((capability) => capability.capabilityId),
      releaseStrategy: "Resolve delivery risks once the release story is visible enough to judge tradeoffs.",
      developmentStrategy: "Target review, action, verification, and reference gaps with explicit finish-line criteria.",
      riskIntent: riskSignals(highRisk).join("; "),
      learningIntent: "Learn whether remaining risks change scope, release confidence, or stakeholder messaging.",
      backboneCoverage: sortedUnique(highRisk.map((capability) => capability.storyMap.backbone)),
      missingBackbones: releaseBackbones.filter(
        (backbone) => !highRisk.some((capability) => capability.storyMap.backbone === backbone)
      ),
      stepCoverageGaps: releaseSteps.filter(
        (step) => !highRisk.some((capability) => `${capability.storyMap.backbone} > ${capability.storyMap.step}` === step)
      ),
      rationale: `Prioritizes capabilities with delivery risk signals: ${highRisk.map((capability) => capability.capabilityId).join(", ")}.`
    });
  }

  return { release, recommendations };
}

function healthLabel(health: CapabilityHealth): string {
  if (health === "ok") {
    return "ok";
  }
  if (health === "review") {
    return "needs-review";
  }
  if (health === "action") {
    return "needs-action";
  }
  return "planned";
}

function findingSummary(capability: CapabilityStatusSummary): string {
  if (capability.health === "planned") {
    return "roadmap";
  }

  const parts = [
    capability.counts["implementation-gap"] > 0 ? `${capability.counts["implementation-gap"]} gap` : "",
    capability.counts["missing-reference"] > 0 ? `${capability.counts["missing-reference"]} missing-ref` : "",
    capability.counts["no-implementation-reference"] > 0
      ? `${capability.counts["no-implementation-reference"]} no-ref`
      : "",
    capability.counts["assessor-limitation"] > 0 ? `${capability.counts["assessor-limitation"]} broad` : "",
    capability.counts["weak-evidence"] > 0 ? `${capability.counts["weak-evidence"]} review` : "",
    capability.verification.gaps.length > 0 ? `${capability.verification.gaps.length} verification` : ""
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "clean";
}

function fit(value: string, width: number): string {
  if (value.length <= width) {
    return value.padEnd(width);
  }
  if (width <= 1) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 1)}…`;
}

function formatOverview(report: CapabilityStatusReport): string {
  const idWidth = Math.min(56, Math.max(10, ...report.capabilities.map((capability) => capability.capabilityId.length)));
  const lines = [
    `CapabilityKit Status: ${report.project}`,
    "",
    `Capabilities: ${report.summary.total}  ok: ${report.summary.ok}  needs-review: ${report.summary.review}  needs-action: ${report.summary.action}  planned: ${report.summary.planned}`,
    "",
    `${"Capability".padEnd(idWidth)}  State         Signals`,
    `${"-".repeat(idWidth)}  ------------  -------`
  ];

  for (const capability of report.capabilities) {
    lines.push(
      `${fit(capability.capabilityId, idWidth)}  ${healthLabel(capability.health).padEnd(12)}  ${findingSummary(capability)}`
    );
  }

  lines.push("", "Use `capabilitykit status <capability-id>` for purpose, files, verification, and next action.");
  return `${lines.join("\n")}\n`;
}

function formatDetail(report: CapabilityStatusReport): string {
  const capability = report.capabilities[0];
  if (!capability) {
    return `CapabilityKit Status: ${report.project}\n\nNo capabilities matched.\n`;
  }

  const lines = [
    `CapabilityKit Status: ${capability.title}`,
    "",
    `${capability.capabilityId}`,
    `State: ${healthLabel(capability.health)} (${capability.status})`,
    `Area: ${capability.area}`,
    `Path: ${capability.path}`,
    "",
    "Purpose",
    capability.summary,
    "",
    "Why It Exists",
    capability.intent,
    "",
    "Implementation",
    `References: ${capability.references.readable}/${capability.references.total} readable`,
    capability.references.missing.length > 0 ? `Missing: ${capability.references.missing.join(", ")}` : "Missing: none",
    "",
    "Verification",
    `Automated checks: ${capability.verification.automated}`,
    `Manual checks: ${capability.verification.manual}`,
    `Verification gaps: ${capability.verification.gaps.length}`,
    "",
    "Coverage Signals",
    `Covered: ${capability.counts.covered}`,
    `Needs review: ${capability.counts["weak-evidence"] + capability.counts["assessor-limitation"]}`,
    `Needs action: ${
      capability.counts["implementation-gap"] +
      capability.counts["missing-reference"] +
      capability.counts["no-implementation-reference"]
    }`,
    `Ignored: ${capability.counts.ignored}`,
    "",
    "Next Action",
    capability.nextAction
  ];

  if (capability.topFindings.length > 0) {
    lines.push("", "Top Findings");
    for (const finding of capability.topFindings) {
      const evidence = finding.evidence[0];
      lines.push(
        `- ${finding.status}: ${finding.criterion}`,
        `  ${finding.recommendation}`,
        `  Evidence: ${evidence ? `${evidence.reference}${evidence.line ? `:${evidence.line}` : ""}` : "none"}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatCapabilityStatusReport(report: CapabilityStatusReport): string {
  return report.capabilities.length === 1 ? formatDetail(report) : formatOverview(report);
}
