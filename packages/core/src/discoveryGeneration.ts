import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { deriveCapabilityIdentity, parseCapability } from "./parseCapability.js";
import { validateDurableDiscoveryReport } from "./discoveryReport.js";
import { parseOrganizedDiscoveryPlan } from "./discoveryOrganization.js";
import type { DurableDiscoveryReport } from "./discoveryReport.js";
import type { DiscoveryPlanCollision, OrganizedDiscoveryPlan } from "./discoveryOrganization.js";

export interface GenerateDraftCapabilitiesOptions {
  apply?: boolean;
  force?: boolean;
}

export interface GeneratedDraftCapability {
  capabilityId: string;
  filePath: string;
  source: string;
}

export interface DiscoveryGenerationAudit {
  report_id: string;
  generated_at: string;
  plan: OrganizedDiscoveryPlan;
}

export interface GenerateDraftCapabilitiesResult {
  applied: boolean;
  files: GeneratedDraftCapability[];
  collisions: DiscoveryPlanCollision[];
  reportPath: string;
  auditPath: string;
}

function evidencePath(reference: string): string {
  return (reference.match(/^(.*):\d+$/)?.[1] ?? reference).trim();
}

function isSupportingContextOnly(reference: string): boolean {
  const normalized = evidencePath(reference).replace(/\\/g, "/").toLowerCase();
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

function discoveredReview(candidate: DurableDiscoveryReport["candidates"][number]): Record<string, unknown> {
  const evidenceByCriterion = new Map(candidate.acceptance_evidence.map((item) => [item.criterion, item]));
  const criteria = candidate.acceptance_criteria.map((criterion) => {
    const evidence = evidenceByCriterion.get(criterion);
    return {
      criterion,
      status: evidence && evidence.evidence.length > 0 ? "covered" : "partial",
      ...(evidence && evidence.evidence.length > 0 ? { evidence: evidence.evidence } : {}),
      notes:
        evidence?.notes ??
        "Generated from discovery evidence; review the criterion against implementation before marking verified."
    };
  });
  return {
    depth: "referenced",
    source: "coding-agent",
    gaps: [
      "Generated from reverse-engineering discovery; review source evidence before treating this as verified behavior.",
      ...candidate.verification_gaps
    ],
    evidence: candidate.implementation_references,
    intent_summary: candidate.summary,
    criteria,
    done: false
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function draftSource(
  report: DurableDiscoveryReport,
  plan: OrganizedDiscoveryPlan,
  capabilityId: string
): string {
  const organized = plan.capabilities.find((capability) => capability.capabilityId === capabilityId);
  if (!organized) {
    throw new Error(`Generation plan is missing capability "${capabilityId}".`);
  }
  const candidates =
    organized.candidateKind === "discovered"
      ? report.candidates.filter((candidate) => candidate.title === organized.title)
      : report.retained_proposals.filter((candidate) => candidate.title === organized.title);
  if (candidates.length !== 1) {
    throw new Error(`Expected one discovery candidate for "${organized.title}", found ${candidates.length}.`);
  }
  const candidate = candidates[0];
  if (
    organized.candidateKind === "discovered" &&
    "implementation_references" in candidate &&
    candidate.implementation_references.every(isSupportingContextOnly)
  ) {
    throw new Error(`Candidate "${candidate.title}" does not include concrete implementation references.`);
  }

  const implementationReferences =
    "implementation_references" in candidate ? candidate.implementation_references : undefined;
  return YAML.stringify({
    title: candidate.title,
    status: organized.status,
    summary: candidate.summary,
    intent: candidate.inferred_intent,
    acceptance: candidate.acceptance_criteria,
    agent: {
      depends_on: organized.dependsOn,
      ...(implementationReferences
        ? {
            implementation: {
              references: implementationReferences,
              inferred_from: [
                `.capabilities/discovery/${report.provenance.report_id}.json`,
                `.capabilities/discovery/${report.provenance.report_id}.generation-plan.json`
              ]
            }
          }
        : {}),
      verification: {
        gaps: candidate.verification_gaps
      },
      ...(organized.candidateKind === "discovered" && "implementation_references" in candidate
        ? { review: discoveredReview(candidate) }
        : {})
    }
  });
}

function duplicatePlanCollisions(plan: OrganizedDiscoveryPlan): DiscoveryPlanCollision[] {
  return plan.collisions.filter((collision) => collision.candidates.length > 1);
}

export async function generateDraftCapabilities(
  rootDir: string,
  report: DurableDiscoveryReport,
  plan: OrganizedDiscoveryPlan,
  options: GenerateDraftCapabilitiesOptions = {}
): Promise<GenerateDraftCapabilitiesResult> {
  const resolvedRoot = path.resolve(rootDir);
  const reportValidation = await validateDurableDiscoveryReport(resolvedRoot, JSON.stringify(report));
  if (!reportValidation.valid) {
    throw new Error(`Invalid durable discovery report: ${reportValidation.issues.map((issue) => issue.message).join("; ")}`);
  }
  report = reportValidation.report;
  plan = parseOrganizedDiscoveryPlan(plan);
  const reportPath = path.join(resolvedRoot, ".capabilities", "discovery", `${report.provenance.report_id}.json`);
  const auditPath = path.join(
    resolvedRoot,
    ".capabilities",
    "discovery",
    `${report.provenance.report_id}.generation-plan.json`
  );
  const capabilitiesRoot = path.join(resolvedRoot, ".capabilities");
  const files = plan.capabilities.map((capability) => {
    const filePath = path.resolve(resolvedRoot, capability.proposedPath);
    const relative = path.relative(capabilitiesRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !filePath.endsWith(".capability.yaml")) {
      throw new Error(`Proposed capability path must remain under .capabilities: ${capability.proposedPath}`);
    }
    const derived = deriveCapabilityIdentity(filePath);
    if (derived.derivedId !== capability.capabilityId) {
      throw new Error(
        `Proposed capability ID "${capability.capabilityId}" does not match path-derived ID "${derived.derivedId}".`
      );
    }
    const source = draftSource(report, plan, capability.capabilityId);
    const parsed = parseCapability(source, filePath);
    if (!parsed.capability || parsed.errors.length > 0) {
      throw new Error(`Generated capability "${capability.capabilityId}" is invalid.`);
    }
    return { capabilityId: capability.capabilityId, filePath, source };
  });
  const fileCollisions = (
    await Promise.all(
      files.map(async (file) =>
        (await exists(file.filePath))
          ? {
              capabilityId: file.capabilityId,
              candidates: [file.capabilityId],
              reason: "The proposed capability file already exists."
            }
          : undefined
      )
    )
  ).filter((collision): collision is DiscoveryPlanCollision => Boolean(collision));
  const collisions = [...plan.collisions, ...fileCollisions];

  if (duplicatePlanCollisions(plan).length > 0) {
    return { applied: false, files, collisions, reportPath, auditPath };
  }
  if (!options.force && (collisions.length > 0 || (await exists(auditPath)))) {
    return { applied: false, files, collisions, reportPath, auditPath };
  }
  if (!options.apply) {
    return { applied: false, files, collisions, reportPath, auditPath };
  }

  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  if (await exists(reportPath)) {
    const savedReportValidation = await validateDurableDiscoveryReport(resolvedRoot, await fs.readFile(reportPath, "utf8"));
    if (!savedReportValidation.valid || JSON.stringify(savedReportValidation.report) !== JSON.stringify(report)) {
      throw new Error(`Saved discovery report does not match selected report: ${path.relative(resolvedRoot, reportPath)}`);
    }
  } else {
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  await fs.writeFile(
    auditPath,
    `${JSON.stringify({ report_id: report.provenance.report_id, generated_at: new Date().toISOString(), plan }, null, 2)}\n`
  );
  await Promise.all(
    files.map(async (file) => {
      await fs.mkdir(path.dirname(file.filePath), { recursive: true });
      await fs.writeFile(file.filePath, file.source);
    })
  );
  return { applied: true, files, collisions, reportPath, auditPath };
}
