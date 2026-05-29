import path from "node:path";

export type DiscoveryConfidence = "high" | "medium" | "low";

export interface DiscoverySourceEvidence {
  path: string;
  kind?: "source" | "test" | "route" | "ui" | "model" | "script" | "config" | "doc" | "unknown";
  notes?: string;
}

export interface DiscoveryCapabilityCandidate {
  title: string;
  summary?: string;
  intent?: string;
  likely_area?: string;
  acceptance?: string[];
  source_evidence: DiscoverySourceEvidence[];
  confidence: DiscoveryConfidence;
  confidence_notes?: string;
  review_gaps?: string[];
  depends_on?: string[];
}

export interface CapabilityDiscoveryReport {
  generated_at?: string;
  project_root?: string;
  inspected_files: string[];
  inspected_areas: string[];
  candidates: DiscoveryCapabilityCandidate[];
  review_gaps?: string[];
}

export interface DiscoveryReportIssue {
  code: string;
  message: string;
  candidate?: string;
}

export interface DiscoveryReportValidationResult {
  valid: boolean;
  issues: DiscoveryReportIssue[];
  gaps: DiscoveryReportIssue[];
}

export interface OrganizedCapabilitySuggestion {
  title: string;
  area: string;
  id: string;
  filePath: string;
  evidence: DiscoverySourceEvidence[];
  depends_on: string[];
  review_gaps: string[];
}

export interface OrganizedCapabilityArea {
  area: string;
  capabilities: OrganizedCapabilitySuggestion[];
}

export interface OrganizedCapabilityMap {
  areas: OrganizedCapabilityArea[];
  capabilities: OrganizedCapabilitySuggestion[];
  dependency_suggestions: Array<{ from: string; to: string; reason: string }>;
  review_gaps: string[];
  summary: string;
}

const DOCUMENTATION_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".php",
  ".cs",
  ".html",
  ".css",
  ".scss",
  ".vue",
  ".svelte"
]);

export function slugifyDiscoverySegment(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "general";
}

function normalizeArea(area: string | undefined): string {
  if (!area?.trim()) {
    return "general";
  }

  return area
    .split(/[\\/]+/)
    .map((segment) => slugifyDiscoverySegment(segment))
    .filter(Boolean)
    .slice(0, 3)
    .join("/") || "general";
}

function evidenceKind(evidence: DiscoverySourceEvidence): string {
  if (evidence.kind && evidence.kind !== "unknown") {
    return evidence.kind;
  }

  const ext = path.extname(evidence.path).toLowerCase();
  if (DOCUMENTATION_EXTENSIONS.has(ext)) return "doc";
  if (SOURCE_EXTENSIONS.has(ext)) return "source";
  if ([".json", ".yaml", ".yml", ".toml"].includes(ext)) return "config";
  return "unknown";
}

function hasConcreteCodeEvidence(candidate: DiscoveryCapabilityCandidate): boolean {
  return candidate.source_evidence.some((evidence) => {
    const kind = evidenceKind(evidence);
    return kind !== "doc" && kind !== "unknown" && kind !== "config";
  });
}

function hasDocumentationOnlyEvidence(candidate: DiscoveryCapabilityCandidate): boolean {
  return candidate.source_evidence.length > 0 && candidate.source_evidence.every((evidence) => evidenceKind(evidence) === "doc");
}

export function validateDiscoveryReport(report: CapabilityDiscoveryReport): DiscoveryReportValidationResult {
  const issues: DiscoveryReportIssue[] = [];
  const gaps: DiscoveryReportIssue[] = [];

  if (!Array.isArray(report.inspected_files) || report.inspected_files.length === 0) {
    gaps.push({ code: "shallow-inspection", message: "Discovery report does not list inspected files." });
  }

  if (!Array.isArray(report.inspected_areas) || report.inspected_areas.length === 0) {
    gaps.push({ code: "shallow-inspection", message: "Discovery report does not summarize inspected project areas." });
  }

  if (!Array.isArray(report.candidates) || report.candidates.length === 0) {
    issues.push({ code: "missing-candidates", message: "Discovery report must include at least one capability candidate." });
  }

  for (const candidate of report.candidates ?? []) {
    const label = candidate.title || "Untitled candidate";
    if (!candidate.title?.trim()) {
      issues.push({ code: "missing-title", message: "Capability candidate is missing a title.", candidate: label });
    }
    if (!candidate.likely_area?.trim()) {
      gaps.push({ code: "missing-area", message: `Candidate "${label}" does not include a likely area.`, candidate: label });
    }
    if (!Array.isArray(candidate.source_evidence) || candidate.source_evidence.length === 0) {
      issues.push({ code: "missing-evidence", message: `Candidate "${label}" does not include source evidence.`, candidate: label });
      continue;
    }
    if (!hasConcreteCodeEvidence(candidate)) {
      gaps.push({ code: "missing-code-evidence", message: `Candidate "${label}" lacks concrete implementation evidence.`, candidate: label });
    }
    if (hasDocumentationOnlyEvidence(candidate)) {
      gaps.push({ code: "documentation-only-evidence", message: `Candidate "${label}" is based only on documentation evidence.`, candidate: label });
    }
    if (candidate.confidence === "low") {
      gaps.push({ code: "low-confidence", message: `Candidate "${label}" is marked low confidence.`, candidate: label });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    gaps
  };
}

export function buildCapabilityDiscoveryPrompt(projectRoot = "."): string {
  return [
    "# CapabilityKit Discovery",
    "",
    `Project root: ${projectRoot}`,
    "",
    "Inspect the installed project's source code and propose candidate CapabilityKit capabilities for what the app currently does.",
    "",
    "## Inspection requirements",
    "",
    "- Inspect source code, tests, routes, handlers, UI flows, data models, scripts, configuration, and documentation where present.",
    "- Treat README files, package metadata, and docs as supporting context only; do not base candidates solely on them.",
    "- Prefer small groups of user-visible behavior over lists of files or internal components.",
    "- Label shallow inspection, missing code evidence, and low-confidence candidates as review gaps.",
    "- Do not create or overwrite `.capability.yaml` files.",
    "",
    "## Output",
    "",
    "Return only JSON with this shape:",
    "",
    "```json",
    JSON.stringify(
      {
        generated_at: "ISO-8601 timestamp",
        project_root: projectRoot,
        inspected_files: ["src/example.ts"],
        inspected_areas: ["routes", "tests"],
        candidates: [
          {
            title: "User-visible capability title",
            likely_area: "product/domain",
            summary: "One-sentence behavior summary.",
            intent: "Why the behavior exists.",
            acceptance: ["Concrete behavior criterion."],
            source_evidence: [{ path: "src/example.ts", kind: "source", notes: "What this file proves." }],
            confidence: "medium",
            confidence_notes: "Why confidence is not higher.",
            review_gaps: ["What a human should verify."],
            depends_on: []
          }
        ],
        review_gaps: []
      },
      null,
      2
    ),
    "```"
  ].join("\n");
}

function stableCandidateId(candidate: DiscoveryCapabilityCandidate, used: Set<string>): string {
  const area = normalizeArea(candidate.likely_area);
  const base = `${area}/${slugifyDiscoverySegment(candidate.title)}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function dependencyReason(from: DiscoveryCapabilityCandidate, to: DiscoveryCapabilityCandidate): string | undefined {
  if (from.depends_on?.includes(to.title)) {
    return `Candidate explicitly listed "${to.title}" as a dependency.`;
  }
  const fromEvidence = new Set(from.source_evidence.map((evidence) => evidence.path));
  const shared = to.source_evidence.find((evidence) => fromEvidence.has(evidence.path));
  if (shared && normalizeArea(from.likely_area) !== normalizeArea(to.likely_area)) {
    return `Both candidates cite ${shared.path}, suggesting a conservative cross-area workflow relationship.`;
  }
  return undefined;
}

export function organizeDiscoveredCapabilityMap(report: CapabilityDiscoveryReport): OrganizedCapabilityMap {
  const validation = validateDiscoveryReport(report);
  const usedIds = new Set<string>();
  const titleToId = new Map<string, string>();
  const capabilities: OrganizedCapabilitySuggestion[] = report.candidates.map((candidate) => {
    const id = stableCandidateId(candidate, usedIds);
    titleToId.set(candidate.title, id);
    const area = normalizeArea(candidate.likely_area);
    const review_gaps = [...(candidate.review_gaps ?? [])];
    if (!candidate.likely_area?.trim()) review_gaps.push("Area was inferred as general and needs human review.");
    if (!hasConcreteCodeEvidence(candidate)) review_gaps.push("Candidate lacks concrete implementation evidence.");
    if (candidate.confidence === "low") review_gaps.push("Candidate was marked low confidence by discovery.");
    return {
      title: candidate.title,
      area,
      id,
      filePath: `.capabilities/${id}.capability.yaml`,
      evidence: candidate.source_evidence,
      depends_on: [] as string[],
      review_gaps
    };
  });

  const byTitle = new Map(report.candidates.map((candidate) => [candidate.title, candidate]));
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
  const dependency_suggestions: OrganizedCapabilityMap["dependency_suggestions"] = [];

  for (const fromCandidate of report.candidates) {
    const fromId = titleToId.get(fromCandidate.title);
    if (!fromId) continue;
    const fromSuggestion = byId.get(fromId);
    for (const toCandidate of report.candidates) {
      if (fromCandidate === toCandidate) continue;
      const toId = titleToId.get(toCandidate.title);
      if (!toId) continue;
      const reason = dependencyReason(fromCandidate, toCandidate);
      if (!reason) continue;
      if (!fromSuggestion?.depends_on.includes(toId)) {
        fromSuggestion?.depends_on.push(toId);
        dependency_suggestions.push({ from: fromId, to: toId, reason });
      }
    }
    for (const dependencyTitle of fromCandidate.depends_on ?? []) {
      const target = byTitle.get(dependencyTitle);
      const toId = target ? titleToId.get(target.title) : undefined;
      if (toId && !fromSuggestion?.depends_on.includes(toId)) {
        fromSuggestion?.depends_on.push(toId);
        dependency_suggestions.push({ from: fromId, to: toId, reason: `Candidate explicitly listed "${dependencyTitle}" as a dependency.` });
      }
    }
  }

  const areaMap = new Map<string, OrganizedCapabilitySuggestion[]>();
  for (const capability of capabilities) {
    areaMap.set(capability.area, [...(areaMap.get(capability.area) ?? []), capability]);
  }
  const areas = [...areaMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, areaCapabilities]) => ({
      area,
      capabilities: areaCapabilities.sort((a, b) => a.id.localeCompare(b.id))
    }));

  const review_gaps = [
    ...(report.review_gaps ?? []),
    ...validation.gaps.map((gap) => gap.message),
    ...capabilities.flatMap((capability) => capability.review_gaps.map((gap) => `${capability.id}: ${gap}`))
  ];

  return {
    areas,
    capabilities: capabilities.sort((a, b) => a.id.localeCompare(b.id)),
    dependency_suggestions,
    review_gaps: [...new Set(review_gaps)],
    summary: `${capabilities.length} discovered capabilities organized into ${areas.length} areas: ${areas.map((area) => area.area).join(", ") || "none"}.`
  };
}
