import type { Capability } from "./types.js";

export type CapabilityReviewHealth = "ok" | "review" | "action";

export interface CapabilityReviewHealthSummary {
  health: CapabilityReviewHealth;
  findings: string[];
}

const incompleteDepths = new Set(["none", "referenced", "partial", "unknown"]);

export function summarizeSavedReviewHealth(capability: Capability): CapabilityReviewHealthSummary {
  const review = capability.agent?.review;
  if (!review) {
    return { health: "ok", findings: [] };
  }

  const findings: string[] = [];

  if (review.done === false) {
    findings.push("review is not done");
  }

  if (review.depth && incompleteDepths.has(review.depth)) {
    findings.push(`review depth is ${review.depth}`);
  }

  for (const gap of review.gaps ?? []) {
    findings.push(gap);
  }

  for (const criterion of review.criteria ?? []) {
    if (criterion.status !== "covered") {
      findings.push(`${criterion.status}: ${criterion.criterion}`);
    }
  }

  if (findings.length === 0) {
    return { health: "ok", findings };
  }

  const hasActionFinding =
    (review.gaps?.length ?? 0) > 0 || (review.criteria ?? []).some((criterion) => criterion.status === "partial" || criterion.status === "uncovered");

  return {
    health: hasActionFinding ? "action" : "review",
    findings
  };
}
