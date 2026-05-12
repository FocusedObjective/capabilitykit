import { promises as fs } from "node:fs";
import path from "node:path";
import { loadCapabilities } from "./loadCapabilities.js";

export type AcceptanceCoverageStatus = "covered" | "uncovered" | "uncertain";

export interface CoverageEvidence {
  reference: string;
  line?: number;
  excerpt: string;
}

export interface AcceptanceCriterionCoverage {
  criterion: string;
  status: AcceptanceCoverageStatus;
  evidence: CoverageEvidence[];
  rationale: string;
}

export interface ImplementationReferenceCoverage {
  reference: string;
  exists: boolean;
  readable: boolean;
  error?: string;
}

export interface ImplementationCoverageReport {
  capabilityId: string;
  title: string;
  references: ImplementationReferenceCoverage[];
  criteria: AcceptanceCriterionCoverage[];
  missingReferences: string[];
}

interface LoadedReference {
  reference: string;
  exists: boolean;
  readable: boolean;
  content?: string;
  error?: string;
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "by",
  "explains",
  "explain",
  "includes",
  "include",
  "information",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "or",
  "the",
  "to",
  "with"
]);

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function criterionTerms(criterion: string): string[] {
  const rawTerms =
    criterion
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((term) => (term.length > 2 || term === "id" || term === "ids") && !stopWords.has(term)) ?? [];
  const terms = rawTerms.flatMap((term) => {
    const expanded = [term];
    if (term === "ids") {
      expanded.push("id");
    }
    if (term.endsWith("ies") && term.length > 4) {
      expanded.push(`${term.slice(0, -3)}y`);
    }
    if (term.endsWith("s") && term.length > 3) {
      expanded.push(term.slice(0, -1));
    }
    if (term === "depends") {
      expanded.push("dependency");
    }
    return expanded;
  });
  return Array.from(new Set(terms));
}

function headingTerms(line: string): string[] {
  const match = line.match(/^#{1,6}\s+(.+)$/);
  if (!match) {
    return [];
  }
  return criterionTerms(match[1] ?? "");
}

function lineEvidence(reference: LoadedReference, criterion: string): CoverageEvidence[] {
  if (!reference.content) {
    return [];
  }

  const normalizedCriterion = normalizeText(criterion);
  const terms = criterionTerms(criterion);
  const lines = reference.content.split(/\r?\n/);
  const evidence: CoverageEvidence[] = [];

  for (const [index, line] of lines.entries()) {
    const normalizedLine = normalizeText(line);
    const matchingTerms = terms.filter((term) => normalizedLine.includes(term));
    const matchingHeadingTerms = headingTerms(line).filter((term) => terms.includes(term));
    const isExact = normalizedLine.includes(normalizedCriterion);
    const needsYamlSchemaEvidence = /\b(yaml|schema)\b/i.test(criterion);
    const hasYamlSchemaSignal = /\b(yaml|schema)\b/i.test(line) || /error\.filePath/.test(line);
    const isAreaEvidence =
      /\bareas?\b/i.test(criterion) &&
      /^\s*area:\s*/i.test(line) &&
      matchingTerms.some((term) => term !== "area" && term !== "areas" && term !== "capability");
    const hasObjectKeyEvidence =
      /[_-]/.test(line) && terms.length > 1 && matchingTerms.length >= Math.min(2, terms.length);
    const hasUsefulOverlap =
      terms.length > 0 &&
      matchingTerms.length >= Math.min(3, terms.length) &&
      (!needsYamlSchemaEvidence || hasYamlSchemaSignal);
    const isUsefulHeading =
      matchingHeadingTerms.length > 0 &&
      matchingHeadingTerms.length >= Math.min(2, terms.length) &&
      (/\b(explain|explains|include|includes)\b/i.test(criterion) || reference.reference.toLowerCase().endsWith(".md"));

    if (isExact || hasUsefulOverlap || hasObjectKeyEvidence || isUsefulHeading || isAreaEvidence) {
      evidence.push({
        reference: reference.reference,
        line: index + 1,
        excerpt: line.trim()
      });
    }
  }

  return evidence.slice(0, 5);
}

async function loadReference(rootDir: string, reference: string): Promise<LoadedReference> {
  const resolved = path.resolve(rootDir, reference);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return { reference, exists: false, readable: false, error: "Reference is not a file." };
    }
    return {
      reference,
      exists: true,
      readable: true,
      content: await fs.readFile(resolved, "utf8")
    };
  } catch (error) {
    return {
      reference,
      exists: false,
      readable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function assessCriterion(criterion: string, references: LoadedReference[]): AcceptanceCriterionCoverage {
  const readableReferences = references.filter((reference) => reference.readable);
  const evidence = readableReferences.flatMap((reference) => lineEvidence(reference, criterion));

  if (readableReferences.length === 0) {
    return {
      criterion,
      status: "uncovered",
      evidence: [],
      rationale: "No readable implementation references were available."
    };
  }

  if (evidence.length === 0) {
    return {
      criterion,
      status: "uncovered",
      evidence: [],
      rationale: "No deterministic evidence was found in referenced implementation files."
    };
  }

  const normalizedCriterion = normalizeText(criterion);
  const hasExactEvidence = evidence.some((item) => normalizeText(item.excerpt).includes(normalizedCriterion));

  if (hasExactEvidence) {
    return {
      criterion,
      status: "covered",
      evidence,
      rationale: "The criterion text appears directly in referenced implementation evidence."
    };
  }

  return {
    criterion,
    status: "uncertain",
    evidence,
    rationale: "Relevant text was found, but deterministic matching cannot prove semantic coverage."
  };
}

export async function assessImplementationCoverage(
  rootDir: string,
  capabilityId: string
): Promise<ImplementationCoverageReport> {
  const loaded = await loadCapabilities(rootDir);
  const match = loaded.capabilities.find((item) => item.capability.id === capabilityId);

  if (!match) {
    throw new Error(`Capability not found: ${capabilityId}`);
  }

  const references = await Promise.all(
    (match.capability.agent?.implementation?.references ?? []).map((reference) => loadReference(loaded.rootDir, reference))
  );

  return {
    capabilityId: match.capability.id,
    title: match.capability.title,
    references: references.map((reference) => ({
      reference: reference.reference,
      exists: reference.exists,
      readable: reference.readable,
      error: reference.error
    })),
    criteria: match.capability.acceptance.map((criterion) => assessCriterion(criterion, references)),
    missingReferences: references.filter((reference) => !reference.readable).map((reference) => reference.reference)
  };
}

export function formatImplementationCoverageReport(report: ImplementationCoverageReport): string {
  const lines = [
    `# Implementation Coverage: ${report.title} (${report.capabilityId})`,
    "",
    "## References",
    ""
  ];

  if (report.references.length === 0) {
    lines.push("- none");
  } else {
    for (const reference of report.references) {
      const status = reference.readable ? "readable" : "missing or unreadable";
      lines.push(`- ${reference.reference}: ${status}${reference.error ? ` (${reference.error})` : ""}`);
    }
  }

  lines.push("", "## Acceptance Criteria", "");

  for (const [index, criterion] of report.criteria.entries()) {
    lines.push(`${index + 1}. ${criterion.status}: ${criterion.criterion}`);
    lines.push(`   Rationale: ${criterion.rationale}`);
    if (criterion.evidence.length === 0) {
      lines.push("   Evidence: none");
    } else {
      lines.push("   Evidence:");
      for (const evidence of criterion.evidence) {
        const location = evidence.line ? `${evidence.reference}:${evidence.line}` : evidence.reference;
        lines.push(`   - ${location}: ${evidence.excerpt}`);
      }
    }
  }

  return lines.join("\n");
}
