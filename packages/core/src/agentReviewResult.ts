import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import { loadCapabilities } from "./loadCapabilities.js";
import type { AgentReviewCriterion, Capability } from "./types.js";

const reviewStatusSchema = z.enum(["covered", "partial", "uncovered", "uncertain"]);

const reviewResultSchema = z.object({
  intent_summary: z.string().trim().min(1),
  criteria: z.array(
    z.object({
      criterion: z.string().trim().min(1),
      status: reviewStatusSchema,
      evidence: z.array(z.string().trim().min(1)).default([]),
      notes: z.string().trim().optional().default("")
    })
  ),
  remaining_gaps: z.array(z.string().trim().min(1)).default([]),
  done: z.boolean()
});

export type ParsedAgentReviewResult = z.infer<typeof reviewResultSchema>;

export interface AgentReviewValidationIssue {
  code: string;
  message: string;
  criterion?: string;
  evidence?: string;
}

export interface ValidatedAgentReviewResult {
  review: ParsedAgentReviewResult;
  valid: boolean;
  issues: AgentReviewValidationIssue[];
  depth: "partial" | "verified";
}

export interface SaveAgentReviewResult {
  capabilityId: string;
  filePath: string;
  validation: ValidatedAgentReviewResult;
}

function extractFencedJson(source: string): string | undefined {
  const match = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim();
}

function parseReviewJson(source: string): unknown {
  const trimmed = source.trim();
  const candidates = [trimmed, extractFencedJson(trimmed)].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Review output must be JSON or contain a fenced JSON block.");
}

function evidencePath(evidence: string): string {
  const lineMatch = evidence.match(/^(.*):\d+$/);
  return (lineMatch?.[1] ?? evidence).trim();
}

async function pathExists(rootDir: string, evidence: string): Promise<boolean> {
  const candidate = path.resolve(rootDir, evidencePath(evidence));
  const relative = path.relative(rootDir, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }

  try {
    await fs.access(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function computeDepth(review: ParsedAgentReviewResult, issues: AgentReviewValidationIssue[]): "partial" | "verified" {
  const allCovered = review.criteria.every((criterion) => criterion.status === "covered");
  return review.done && allCovered && review.remaining_gaps.length === 0 && issues.length === 0 ? "verified" : "partial";
}

export async function validateAgentReviewResult(
  rootDir: string,
  capability: Capability,
  source: string
): Promise<ValidatedAgentReviewResult> {
  const parsed = reviewResultSchema.safeParse(parseReviewJson(source));
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid agent review result: ${message}`);
  }

  const review = parsed.data;
  const issues: AgentReviewValidationIssue[] = [];
  const expected = capability.acceptance;

  if (review.criteria.length !== expected.length) {
    issues.push({
      code: "criteria-count-mismatch",
      message: `Expected ${expected.length} criteria but review included ${review.criteria.length}.`
    });
  }

  for (const criterion of expected) {
    const match = review.criteria.find((item) => item.criterion === criterion);
    if (!match) {
      issues.push({
        code: "missing-criterion",
        message: `Review is missing acceptance criterion: ${criterion}`,
        criterion
      });
      continue;
    }
  }

  for (const criterion of review.criteria) {
    if (!expected.includes(criterion.criterion)) {
      issues.push({
        code: "unknown-criterion",
        message: `Review includes an unknown criterion: ${criterion.criterion}`,
        criterion: criterion.criterion
      });
    }

    if ((criterion.status === "covered" || criterion.status === "partial") && criterion.evidence.length === 0) {
      issues.push({
        code: "missing-evidence",
        message: `Criterion marked ${criterion.status} must include file-path evidence.`,
        criterion: criterion.criterion
      });
    }

    for (const evidence of criterion.evidence) {
      if (!(await pathExists(rootDir, evidence))) {
        issues.push({
          code: "missing-evidence-path",
          message: `Evidence path does not exist: ${evidence}`,
          criterion: criterion.criterion,
          evidence
        });
      }
    }
  }

  if (review.done && (review.remaining_gaps.length > 0 || review.criteria.some((criterion) => criterion.status !== "covered"))) {
    issues.push({
      code: "invalid-done",
      message: "`done` can be true only when every criterion is covered and no remaining gaps are reported."
    });
  }

  return {
    review,
    valid: issues.length === 0,
    issues,
    depth: computeDepth(review, issues)
  };
}

function reviewEvidence(criteria: AgentReviewCriterion[]): string[] {
  return Array.from(new Set(criteria.flatMap((criterion) => criterion.evidence)));
}

export async function saveAgentReviewResult(
  rootDir: string,
  capabilityId: string,
  source: string
): Promise<SaveAgentReviewResult> {
  const loaded = await loadCapabilities(rootDir);
  const match = loaded.capabilities.find((item) => item.capability.id === capabilityId);
  if (!match) {
    throw new Error(`Capability not found: ${capabilityId}`);
  }

  const validation = await validateAgentReviewResult(loaded.rootDir, match.capability, source);
  if (!validation.valid) {
    return {
      capabilityId,
      filePath: match.filePath,
      validation
    };
  }

  const document = parseDocument(await fs.readFile(match.filePath, "utf8"));
  document.setIn(["agent", "review"], {
    depth: validation.depth,
    intent_summary: validation.review.intent_summary,
    done: validation.review.done,
    criteria: validation.review.criteria,
    evidence: reviewEvidence(validation.review.criteria),
    gaps: validation.review.remaining_gaps
  });

  await fs.writeFile(match.filePath, document.toString());

  return {
    capabilityId,
    filePath: match.filePath,
    validation
  };
}
