import path from "node:path";
import { z } from "zod";
import type { DiscoveryReport } from "./discoveryReport.js";

const ambiguousAreaNames = new Set(["app", "application", "core", "feature", "features", "general", "misc", "other", "src"]);
const nonEmptyString = z.string().trim().min(1);
const confidenceSchema = z.enum(["high", "medium", "low"]);

export interface DiscoveryOrganizationOptions {
  existingCapabilityIds?: string[];
}

export interface DiscoveryGroupingDecision {
  candidate: string;
  sourceArea: string;
  areaSegments: string[];
  notes: string[];
}

export interface DiscoveryDependencySuggestion {
  capabilityId: string;
  dependsOn: string;
  relationship: string;
}

export interface DiscoveryPlanCollision {
  capabilityId: string;
  candidates: string[];
  reason: string;
}

export interface DiscoveryPlanReviewFlag {
  candidate?: string;
  message: string;
}

export interface OrganizedDiscoveryCapability {
  title: string;
  capabilityId: string;
  fileName: string;
  proposedPath: string;
  areaSegments: string[];
  groupingDecision: DiscoveryGroupingDecision;
  dependsOn: string[];
  dependencySuggestions: DiscoveryDependencySuggestion[];
  implementationReferences: string[];
  confidence: DiscoveryReport["candidates"][number]["confidence"];
  candidateKind: "discovered" | "retained-proposal";
  status: "implemented" | "planned";
}

export interface DiscoveryAreaIndex {
  area: string;
  capabilityIds: string[];
  topLevelCapabilityIds: string[];
}

export interface OrganizedDiscoveryPlan {
  capabilities: OrganizedDiscoveryCapability[];
  areas: DiscoveryAreaIndex[];
  collisions: DiscoveryPlanCollision[];
  reviewFlags: DiscoveryPlanReviewFlag[];
  quarantinedCandidates: DiscoveryReport["quarantined_candidates"];
  discoveryGaps: string[];
}

const groupingDecisionSchema = z.object({
  candidate: nonEmptyString,
  sourceArea: nonEmptyString,
  areaSegments: z.array(nonEmptyString).min(1).max(2),
  notes: z.array(nonEmptyString)
});

const dependencySuggestionSchema = z.object({
  capabilityId: nonEmptyString,
  dependsOn: nonEmptyString,
  relationship: nonEmptyString
});

const collisionSchema = z.object({
  capabilityId: nonEmptyString,
  candidates: z.array(nonEmptyString).min(1),
  reason: nonEmptyString
});

const reviewFlagSchema = z.object({
  candidate: nonEmptyString.optional(),
  message: nonEmptyString
});

const quarantinedCandidateSchema = z.object({
  title: nonEmptyString,
  likely_area: nonEmptyString.optional(),
  reason: nonEmptyString,
  source_evidence: z.array(nonEmptyString),
  confidence_notes: z.array(nonEmptyString).min(1)
});

const organizedDiscoveryPlanSchema = z.object({
  capabilities: z.array(
    z.object({
      title: nonEmptyString,
      capabilityId: nonEmptyString,
      fileName: nonEmptyString,
      proposedPath: nonEmptyString,
      areaSegments: z.array(nonEmptyString).min(1).max(2),
      groupingDecision: groupingDecisionSchema,
      dependsOn: z.array(nonEmptyString),
      dependencySuggestions: z.array(dependencySuggestionSchema),
      implementationReferences: z.array(nonEmptyString),
      confidence: confidenceSchema,
      candidateKind: z.enum(["discovered", "retained-proposal"]),
      status: z.enum(["implemented", "planned"])
    })
  ),
  areas: z.array(
    z.object({
      area: nonEmptyString,
      capabilityIds: z.array(nonEmptyString),
      topLevelCapabilityIds: z.array(nonEmptyString)
    })
  ),
  collisions: z.array(collisionSchema),
  reviewFlags: z.array(reviewFlagSchema),
  quarantinedCandidates: z.array(quarantinedCandidateSchema),
  discoveryGaps: z.array(nonEmptyString)
}).superRefine((plan, context) => {
  for (const [index, capability] of plan.capabilities.entries()) {
    const expectedStatus = capability.candidateKind === "discovered" ? "implemented" : "planned";
    if (capability.status !== expectedStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities", index, "status"],
        message: `${capability.candidateKind} capabilities must use ${expectedStatus} status`
      });
    }
  }
});

export function parseOrganizedDiscoveryPlan(source: unknown): OrganizedDiscoveryPlan {
  const parsed = organizedDiscoveryPlanSchema.safeParse(source);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid organized discovery plan: ${message}`);
  }
  return parsed.data as OrganizedDiscoveryPlan;
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function areaSegments(sourceArea: string): { segments: string[]; notes: string[] } {
  const rawSegments = sourceArea
    .split(/[\\/>]+/)
    .map((segment) => slugify(segment, "general"))
    .filter(Boolean);
  const segments = (rawSegments.length > 0 ? rawSegments : ["general"]).slice(0, 2);
  const notes: string[] = [];

  if (rawSegments.length > 2) {
    notes.push(`Collapsed deep area hint "${sourceArea}" to "${segments.join("/")}".`);
  }
  if (segments.some((segment) => ambiguousAreaNames.has(segment))) {
    notes.push(`Area hint "${sourceArea}" may describe code structure instead of a product domain.`);
  }

  return { segments, notes };
}

function relationshipMatches(relationship: string, candidateId: string, title: string): boolean {
  const normalized = slugify(relationship, "");
  return normalized.includes(candidateId) || normalized.includes(slugify(title, ""));
}

function suggestDependencies(
  capabilityId: string,
  relationships: string[],
  knownCapabilities: Array<{ capabilityId: string; title: string }>,
  reviewFlags: DiscoveryPlanReviewFlag[]
): DiscoveryDependencySuggestion[] {
  const suggestions: DiscoveryDependencySuggestion[] = [];
  for (const relationship of relationships) {
    const matches = knownCapabilities.filter(
      (known) => known.capabilityId !== capabilityId && relationshipMatches(relationship, known.capabilityId, known.title)
    );
    if (matches.length === 1) {
      suggestions.push({ capabilityId, dependsOn: matches[0].capabilityId, relationship });
    } else if (matches.length > 1) {
      reviewFlags.push({
        candidate: capabilityId,
        message: `Relationship "${relationship}" matches multiple capabilities: ${matches
          .map((match) => match.capabilityId)
          .join(", ")}.`
      });
    }
  }
  return suggestions.filter(
    (suggestion, index, all) => all.findIndex((item) => item.dependsOn === suggestion.dependsOn) === index
  );
}

export function organizeDiscoveredCapabilityMap(
  report: DiscoveryReport,
  options: DiscoveryOrganizationOptions = {}
): OrganizedDiscoveryPlan {
  const existingIds = [...new Set(options.existingCapabilityIds ?? [])].sort();
  const reviewFlags: DiscoveryPlanReviewFlag[] = [];
  const proposed = [
    ...report.candidates.map((candidate) => ({ candidate, candidateKind: "discovered" as const })),
    ...report.retained_proposals.map((candidate) => ({ candidate, candidateKind: "retained-proposal" as const }))
  ].map(({ candidate, candidateKind }) => {
    const grouping = areaSegments(candidate.likely_area);
    const capabilityId = [...grouping.segments, slugify(candidate.title, "untitled-capability")].join("/");
    if (grouping.notes.length > 0) {
      reviewFlags.push(...grouping.notes.map((message) => ({ candidate: candidate.title, message })));
    }
    if (candidate.confidence !== "high") {
      reviewFlags.push({
        candidate: candidate.title,
        message: `Candidate confidence is ${candidate.confidence}: ${candidate.confidence_notes.join(" ")}`
      });
    }
    return {
      candidate,
      candidateKind,
      capabilityId,
      groupingDecision: {
        candidate: candidate.title,
        sourceArea: candidate.likely_area,
        areaSegments: grouping.segments,
        notes: grouping.notes
      }
    };
  });
  const knownCapabilities = [
    ...proposed.map(({ candidate, capabilityId }) => ({ capabilityId, title: candidate.title })),
    ...existingIds.map((capabilityId) => ({ capabilityId, title: capabilityId.split("/").at(-1) ?? capabilityId }))
  ];
  const capabilities = proposed.map(({ candidate, candidateKind, capabilityId, groupingDecision }) => {
    const dependencySuggestions = suggestDependencies(
      capabilityId,
      candidate.likely_relationships,
      knownCapabilities,
      reviewFlags
    );
    const fileName = `${slugify(candidate.title, "untitled-capability")}.capability.yaml`;
    return {
      title: candidate.title,
      capabilityId,
      fileName,
      proposedPath: path.posix.join(".capabilities", ...groupingDecision.areaSegments, fileName),
      areaSegments: groupingDecision.areaSegments,
      groupingDecision,
      dependsOn: dependencySuggestions.map((suggestion) => suggestion.dependsOn).sort(),
      dependencySuggestions,
      implementationReferences: "implementation_references" in candidate ? candidate.implementation_references : [],
      confidence: candidate.confidence,
      candidateKind,
      status: candidateKind === "discovered" ? ("implemented" as const) : ("planned" as const)
    };
  });
  const collisions: DiscoveryPlanCollision[] = [];
  for (const capability of capabilities) {
    const matchingCandidates = capabilities
      .filter((other) => other.capabilityId === capability.capabilityId)
      .map((other) => other.title);
    if (matchingCandidates.length > 1 && !collisions.some((collision) => collision.capabilityId === capability.capabilityId)) {
      collisions.push({
        capabilityId: capability.capabilityId,
        candidates: matchingCandidates,
        reason: "Multiple discovered candidates resolve to the same capability ID."
      });
    }
    if (
      existingIds.includes(capability.capabilityId) &&
      !collisions.some(
        (collision) =>
          collision.capabilityId === capability.capabilityId && collision.reason === "The proposed capability ID already exists."
      )
    ) {
      collisions.push({
        capabilityId: capability.capabilityId,
        candidates: [capability.title],
        reason: "The proposed capability ID already exists."
      });
    }
  }
  const areaNames = [...new Set(capabilities.map((capability) => capability.areaSegments[0]))].sort();
  const areas = areaNames.map((area) => {
    const areaCapabilities = capabilities.filter((capability) => capability.areaSegments[0] === area);
    return {
      area,
      capabilityIds: areaCapabilities.map((capability) => capability.capabilityId).sort(),
      topLevelCapabilityIds: areaCapabilities
        .filter((capability) => capability.areaSegments.length === 1)
        .map((capability) => capability.capabilityId)
        .sort()
    };
  });

  return {
    capabilities,
    areas,
    collisions,
    reviewFlags,
    quarantinedCandidates: report.quarantined_candidates,
    discoveryGaps: report.discovery_gaps
  };
}
