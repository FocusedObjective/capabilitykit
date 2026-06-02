import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const confidenceSchema = z.enum(["high", "medium", "low"]);

const discoveryCandidateSchema = z.object({
  title: z.string().trim().min(1),
  likely_area: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  inferred_intent: z.string().trim().min(1),
  acceptance_criteria: z.array(z.string().trim().min(1)).min(1),
  implementation_references: z.array(z.string().trim().min(1)).min(1),
  verification_gaps: z.array(z.string().trim().min(1)),
  likely_relationships: z.array(z.string().trim().min(1)),
  inspected_code_paths: z.array(z.string().trim().min(1)).min(1),
  confidence: confidenceSchema,
  confidence_notes: z.array(z.string().trim().min(1)).min(1)
});

const retainedProposalSchema = z.object({
  title: z.string().trim().min(1),
  likely_area: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  inferred_intent: z.string().trim().min(1),
  acceptance_criteria: z.array(z.string().trim().min(1)).min(1),
  verification_gaps: z.array(z.string().trim().min(1)).min(1),
  likely_relationships: z.array(z.string().trim().min(1)),
  confidence: confidenceSchema,
  confidence_notes: z.array(z.string().trim().min(1)).min(1),
  retention_reason: z.string().trim().min(1)
});

const quarantinedCandidateSchema = z.object({
  title: z.string().trim().min(1),
  likely_area: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1),
  source_evidence: z.array(z.string().trim().min(1)).default([]),
  confidence_notes: z.array(z.string().trim().min(1)).min(1)
});

const discoveryReportSchema = z.object({
  inspection_summary: z.object({
    inspected_areas: z.array(z.string().trim().min(1)).min(1),
    inspected_paths: z.array(z.string().trim().min(1)).min(1),
    uninspected_areas: z.array(z.string().trim().min(1)).default([])
  }),
  candidates: z.array(discoveryCandidateSchema),
  retained_proposals: z.array(retainedProposalSchema).default([]),
  quarantined_candidates: z.array(quarantinedCandidateSchema).default([]),
  discovery_gaps: z.array(z.string().trim().min(1)).default([]),
  confidence_notes: z.array(z.string().trim().min(1)).default([])
});

export type DiscoveryReport = z.infer<typeof discoveryReportSchema>;

export interface DiscoveryReportProvenance {
  report_id: string;
  saved_at: string;
  selected_agent_command?: string;
  agent_transcript?: string;
  agent_transcript_path?: string;
}

const discoveryReportProvenanceSchema = z.object({
  report_id: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  saved_at: z.string().datetime(),
  selected_agent_command: z.string().trim().min(1).optional(),
  agent_transcript: z.string().optional(),
  agent_transcript_path: z.string().trim().min(1).optional()
});

const durableDiscoveryReportSchema = discoveryReportSchema.extend({
  provenance: discoveryReportProvenanceSchema
});

export interface DurableDiscoveryReport extends DiscoveryReport {
  provenance: DiscoveryReportProvenance;
}

export interface DiscoveryReportValidationIssue {
  code: string;
  message: string;
  candidate?: string;
  evidence?: string;
}

export interface ValidatedDiscoveryReport {
  report: DiscoveryReport;
  valid: boolean;
  issues: DiscoveryReportValidationIssue[];
}

export interface ValidatedDurableDiscoveryReport {
  report: DurableDiscoveryReport;
  valid: boolean;
  issues: DiscoveryReportValidationIssue[];
}

export interface SaveDiscoveryReportOptions {
  reportId?: string;
  selectedAgentCommand?: string;
  agentTranscript?: string;
  agentTranscriptPath?: string;
}

export interface SaveDiscoveryReportResult {
  reportId: string;
  filePath?: string;
  validation: ValidatedDiscoveryReport;
}

function extractFencedJson(source: string): string | undefined {
  const match = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim();
}

function extractEmbeddedJson(source: string): string | undefined {
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") {
      continue;
    }

    const stack = ["}"];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          inString = false;
        }
        continue;
      }

      if (character === "\"") {
        inString = true;
      } else if (character === "{") {
        stack.push("}");
      } else if (character === "[") {
        stack.push("]");
      } else if (character === "}" || character === "]") {
        if (character !== stack.at(-1)) {
          break;
        }
        stack.pop();
        if (stack.length === 0) {
          return source.slice(start, index + 1).trim();
        }
      }
    }
  }

  return undefined;
}

function parseDiscoveryJson(source: string): unknown {
  const trimmed = source.trim();
  const candidates = [trimmed, extractFencedJson(trimmed), extractEmbeddedJson(trimmed)].filter(
    (candidate): candidate is string => Boolean(candidate)
  );

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Discovery output must be JSON or contain a fenced JSON block.");
}

function evidencePath(evidence: string): string {
  const lineMatch = evidence.match(/^(.*):\d+$/);
  return (lineMatch?.[1] ?? evidence).trim();
}

function isSupportingContextOnly(evidence: string): boolean {
  const normalized = evidencePath(evidence).replace(/\\/g, "/").toLowerCase();
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

export async function validateDiscoveryReport(rootDir: string, source: string): Promise<ValidatedDiscoveryReport> {
  const parsed = discoveryReportSchema.safeParse(parseDiscoveryJson(source));
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid discovery report: ${message}`);
  }

  const report = parsed.data;
  const issues: DiscoveryReportValidationIssue[] = [];

  for (const inspectedPath of report.inspection_summary.inspected_paths) {
    if (!(await pathExists(rootDir, inspectedPath))) {
      issues.push({
        code: "missing-inspected-path",
        message: `Inspected path does not exist: ${inspectedPath}`,
        evidence: inspectedPath
      });
    }
  }

  if (report.inspection_summary.uninspected_areas.length > 0 && report.discovery_gaps.length === 0) {
    issues.push({
      code: "uninspected-area-without-gap",
      message: "Uninspected project areas must be recorded as discovery gaps."
    });
  }

  for (const candidate of report.candidates) {
    const supportingContextReferences = candidate.implementation_references.filter(isSupportingContextOnly);
    const concreteReferences = candidate.implementation_references.length - supportingContextReferences.length;
    if (concreteReferences === 0) {
      issues.push({
        code: "documentation-only-evidence",
        message: `Candidate "${candidate.title}" relies only on documentation or package metadata.`,
        candidate: candidate.title
      });
    } else if (supportingContextReferences.length >= concreteReferences) {
      issues.push({
        code: "supporting-context-primary-evidence",
        message: `Candidate "${candidate.title}" must cite more concrete implementation references than documentation or package metadata references.`,
        candidate: candidate.title
      });
    }

    if (candidate.confidence === "low" && candidate.verification_gaps.length === 0) {
      issues.push({
        code: "low-confidence-without-gap",
        message: `Low-confidence candidate "${candidate.title}" must include a verification gap.`,
        candidate: candidate.title
      });
    }
    if (candidate.inspected_code_paths.length < 2 && candidate.verification_gaps.length === 0) {
      issues.push({
        code: "shallow-inspection-without-gap",
        message: `Shallow inspection for candidate "${candidate.title}" must include a verification gap.`,
        candidate: candidate.title
      });
    }

    for (const evidence of [...candidate.implementation_references, ...candidate.inspected_code_paths]) {
      if (!(await pathExists(rootDir, evidence))) {
        issues.push({
          code: "missing-evidence-path",
          message: `Candidate evidence path does not exist: ${evidence}`,
          candidate: candidate.title,
          evidence
        });
      }
    }
  }

  return {
    report,
    valid: issues.length === 0,
    issues
  };
}

export async function validateDurableDiscoveryReport(
  rootDir: string,
  source: string
): Promise<ValidatedDurableDiscoveryReport> {
  const parsed = durableDiscoveryReportSchema.safeParse(parseDiscoveryJson(source));
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid durable discovery report: ${message}`);
  }
  const validation = await validateDiscoveryReport(rootDir, JSON.stringify(parsed.data));
  return {
    report: parsed.data,
    valid: validation.valid,
    issues: validation.issues
  };
}

function reportId(value?: string): string {
  const id = value?.trim() || `discovery-${randomUUID()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
    throw new Error("Discovery report ID must contain only letters, numbers, dots, underscores, and hyphens.");
  }
  return id;
}

export async function saveDiscoveryReport(
  rootDir: string,
  source: string,
  options: SaveDiscoveryReportOptions = {}
): Promise<SaveDiscoveryReportResult> {
  const validation = await validateDiscoveryReport(rootDir, source);
  const id = reportId(options.reportId);
  if (!validation.valid) {
    return { reportId: id, validation };
  }

  const filePath = path.resolve(rootDir, ".capabilities", "discovery", `${id}.json`);
  try {
    await fs.access(filePath, fsConstants.F_OK);
    throw new Error(`Discovery report already exists: ${path.relative(rootDir, filePath)}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const durableReport: DurableDiscoveryReport = {
    ...validation.report,
    provenance: {
      report_id: id,
      saved_at: new Date().toISOString(),
      ...(options.selectedAgentCommand ? { selected_agent_command: options.selectedAgentCommand } : {}),
      ...(options.agentTranscript ? { agent_transcript: options.agentTranscript } : {}),
      ...(options.agentTranscriptPath ? { agent_transcript_path: options.agentTranscriptPath } : {})
    }
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(durableReport, null, 2)}\n`);
  return { reportId: id, filePath, validation };
}
