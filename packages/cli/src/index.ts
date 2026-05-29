#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import YAML from "yaml";
import {
  analyzeCapabilityImpact,
  adviseImplementationCoverage,
  assessImplementationCoverage,
  buildAgentReviewPrompt,
  buildAgentTaskBundle,
  compileCapabilities,
  diffCapabilities,
  formatCapabilityImpactReport,
  formatCapabilityDiffReport,
  formatCapabilityStatusReport,
  formatAssessmentAdviceReport,
  formatImplementationCoverageReport,
  loadCapabilities,
  runExternalAgentCommand,
  saveAgentReviewResult,
  summarizeCapabilityStatus,
  syncReviewEvidence,
  validateAgentReviewResult,
  validateLoadedCapabilities,
  writeCompiledCapabilities,
  formatSyncReviewEvidenceReport,
  formatCapabilities
} from "@capabilitykit/core";
import type { Capability, LoadCapabilitiesResult, VerificationGap } from "@capabilitykit/core";
import { installCapabilityKitSkill } from "./skillInstall.js";
import { filterStatusReportByRelease, formatStoryMapStatusReport, formatStoryMapViewerHtml } from "./statusOutput.js";

const program = new Command();

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeNewFile(filePath: string, contents: string, force = false): Promise<void> {
  if (!force && (await exists(filePath))) {
    throw new Error(`${path.relative(process.cwd(), filePath)} already exists. Pass --force to overwrite.`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

function capabilityTemplate(name: string): string {
  return YAML.stringify({
    title: name,
    status: "planned",
    summary: `Describe the ${name} capability.`,
    intent: "Explain why this capability matters to users, maintainers, and AI coding agents.",
    acceptance: [`${name} has clear acceptance criteria.`],
    guidance: ["Keep implementation and tests aligned with this capability."]
  });
}

function printValidationReport(result: ReturnType<typeof validateLoadedCapabilities>): void {
  console.log("CapabilityKit validation");
  console.log("");
  console.log(`${result.errors.length === 0 ? "OK" : "!!"} ${result.parsedCount} capabilities parsed`);
  console.log(`${result.errors.length === 0 ? "OK" : "!!"} ${result.uniqueIdCount} unique IDs`);

  if (result.errors.length > 0) {
    console.log("");
    console.log("Errors:");
    for (const error of result.errors) {
      console.log(`  - ${error.message}${error.filePath ? ` (${path.relative(process.cwd(), error.filePath)})` : ""}`);
    }
  }

  if (result.verificationGaps.length > 0) {
    console.log("");
    console.log("Verification gaps:");
    for (const gap of result.verificationGaps) {
      console.log(`  - ${gap.message}`);
    }
  }

  console.log("");
  console.log(
    `Result: ${result.valid ? "valid" : "invalid"}${
      result.verificationGaps.length > 0 ? ` with ${result.verificationGaps.length} verification gaps` : ""
    }`
  );
}

function printReviewResult(result: Awaited<ReturnType<typeof validateAgentReviewResult>>): void {
  console.log("CapabilityKit review result");
  console.log("");
  console.log(`${result.valid ? "OK" : "!!"} ${result.review.criteria.length} criteria reviewed`);
  console.log(`Depth: ${result.depth}`);
  console.log(`Done: ${result.review.done ? "yes" : "no"}`);

  if (result.review.remaining_gaps.length > 0) {
    console.log("");
    console.log("Remaining gaps:");
    for (const gap of result.review.remaining_gaps) {
      console.log(`  - ${gap}`);
    }
  }

  if (result.issues.length > 0) {
    console.log("");
    console.log("Issues:");
    for (const issue of result.issues) {
      console.log(`  - ${issue.message}`);
    }
  }
}

function parseAgentTaskMode(value: string): "implement" | "review" {
  if (value === "implement" || value === "review") {
    return value;
  }
  throw new Error(`Invalid agent task mode "${value}". Expected "implement" or "review".`);
}

function parseAgentHandoff(value: string): "stdin" | "argument" | "prompt-file" {
  if (value === "stdin" || value === "argument" || value === "prompt-file") {
    return value;
  }
  throw new Error(`Invalid agent handoff "${value}". Expected "stdin", "argument", or "prompt-file".`);
}

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

type AdviceReport = Awaited<ReturnType<typeof adviseImplementationCoverage>>;

function noisyScore(capability: AdviceReport["capabilities"][number]): number {
  return capability.criteria.reduce((score, criterion) => {
    if (criterion.status === "assessor-limitation") {
      return score + 4;
    }
    if (criterion.status === "weak-evidence") {
      return score + 2;
    }
    if (criterion.status === "implementation-gap") {
      return score + 1;
    }
    return score;
  }, 0);
}

function noisyCandidates(report: AdviceReport, limit: number): Array<AdviceReport["capabilities"][number] & { score: number }> {
  return report.capabilities
    .map((capability) => ({ ...capability, score: noisyScore(capability) }))
    .filter((capability) => capability.score > 0)
    .sort((a, b) => b.score - a.score || a.capabilityId.localeCompare(b.capabilityId))
    .slice(0, limit);
}

function formatReviewNoisy(report: AdviceReport, limit: number, command: string): string {
  const candidates = noisyCandidates(report, limit);
  const lines = ["CapabilityKit noisy review candidates", "", `Candidates: ${candidates.length}`];

  for (const candidate of candidates) {
    const weak = candidate.criteria.filter((criterion) => criterion.status === "weak-evidence").length;
    const limitations = candidate.criteria.filter((criterion) => criterion.status === "assessor-limitation").length;
    const gaps = candidate.criteria.filter((criterion) => criterion.status === "implementation-gap").length;
    lines.push(
      "",
      `${candidate.capabilityId}`,
      `  Score: ${candidate.score}`,
      `  Weak evidence: ${weak}`,
      `  Assessor limitations: ${limitations}`,
      `  Implementation gaps: ${gaps}`,
      `  Review command: capabilitykit review ${candidate.capabilityId} --agent ${command} --handoff stdin`
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatReviewRecommendations(report: AdviceReport, limit: number, command: string): string {
  const candidates = noisyCandidates(report, limit);
  const lines = [
    "CapabilityKit recommended verification targets",
    "",
    `Candidates: ${candidates.length}`,
    "These are useful candidates for semantic review because deterministic evidence is weak, incomplete, or limited."
  ];

  for (const candidate of candidates) {
    const weak = candidate.criteria.filter((criterion) => criterion.status === "weak-evidence").length;
    const limitations = candidate.criteria.filter((criterion) => criterion.status === "assessor-limitation").length;
    const gaps = candidate.criteria.filter((criterion) => criterion.status === "implementation-gap").length;
    lines.push(
      "",
      `${candidate.capabilityId}`,
      `  Score: ${candidate.score}`,
      `  Weak evidence: ${weak}`,
      `  Assessor limitations: ${limitations}`,
      `  Implementation gaps: ${gaps}`,
      `  Deterministic: capabilitykit verify ${candidate.capabilityId}`,
      `  Semantic: capabilitykit verify ${candidate.capabilityId} --agent ${command} --handoff stdin`
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatNextActions(
  validation: ReturnType<typeof validateLoadedCapabilities>,
  status: Awaited<ReturnType<typeof summarizeCapabilityStatus>>,
  advice: AdviceReport,
  limit: number
): string {
  const lines = ["CapabilityKit next actions", ""];

  if (!validation.valid) {
    lines.push("1. Fix validation errors", "   Run: capabilitykit validate", "");
  }

  if (validation.verificationGaps.length > 0) {
    lines.push(
      `${lines.filter((line) => /^\d+\./.test(line)).length + 1}. Review verification gaps`,
      `   ${validation.verificationGaps.length} gap(s) found.`,
      "   Run: capabilitykit status",
      ""
    );
  }

  const actionable = status.capabilities
    .filter((capability) => capability.health === "action" || capability.health === "review")
    .slice(0, limit);
  if (actionable.length > 0) {
    lines.push(`${lines.filter((line) => /^\d+\./.test(line)).length + 1}. Address capability health issues`);
    for (const capability of actionable) {
      lines.push(`   - ${capability.capabilityId}: ${capability.nextAction}`);
    }
    lines.push("");
  }

  const candidates = noisyCandidates(advice, limit);
  if (candidates.length > 0) {
    lines.push(`${lines.filter((line) => /^\d+\./.test(line)).length + 1}. Consider semantic verification`);
    for (const candidate of candidates) {
      lines.push(`   - ${candidate.capabilityId}: capabilitykit verify ${candidate.capabilityId} --agent codex --handoff stdin`);
    }
    lines.push("");
  }

  if (lines.length === 2) {
    lines.push("No immediate capability actions found.", "", "Run: capabilitykit check");
  } else {
    lines.push("Daily health command:", "  capabilitykit check", "Apply formatting and compiled output updates:", "  capabilitykit check --fix");
  }

  return `${lines.join("\n")}\n`;
}

type GraphCapability = Capability & {
  path: string;
  scopes: string[];
  scope: string;
  scopeLabel: string;
  dependencies: string[];
  dependents: string[];
  verificationGaps: VerificationGap[];
};

interface GraphNode {
  id: string;
  title: string;
  label: string;
  area: string;
  scopes: string[];
  scope: string;
  scopeLabel: string;
  status: Capability["status"];
  summary: string;
  intent: string;
  acceptance: string[];
  guidance: string[];
  path: string;
  dependencies: string[];
  dependents: string[];
  implementationReferences: string[];
  automatedChecks: Array<{ id?: string; description: string; command?: string }>;
  manualChecks: string[];
  verificationGaps: VerificationGap[];
  review?: NonNullable<NonNullable<Capability["agent"]>["review"]>;
  storyMap?: {
    release: string;
    backbone: string;
    step: string;
    name: string;
    label: string;
  };
  impact: number;
  gaps: number;
  r: number;
  x: number;
  y: number;
}

interface GraphLink {
  source: string;
  target: string;
}

interface GraphViewModel {
  width: number;
  height: number;
  scopes: string[];
  storyMaps: string[];
  hasUnassignedStoryMap: boolean;
  nodes: GraphNode[];
  links: GraphLink[];
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildGraphViewModel(loaded: LoadCapabilitiesResult, gapsById: Map<string, number>): GraphViewModel {
  const validation = validateLoadedCapabilities(loaded);
  const gapsByCapability = validation.verificationGaps.reduce((map, gap) => {
    if (!gap.capabilityId) {
      return map;
    }
    map.set(gap.capabilityId, [...(map.get(gap.capabilityId) ?? []), gap]);
    return map;
  }, new Map<string, VerificationGap[]>());
  const nodes: GraphCapability[] = loaded.capabilities.map((item) => {
    const hierarchy = item.relativePath.replace(/\.capability\.yaml$/, "").split("/");
    const scopes = hierarchy.slice(0, -1).map((_, index) => hierarchy.slice(0, index + 1).join("/"));
    const scope = scopes.at(-1) ?? item.capability.area;
    return {
      ...item.capability,
      path: `.capabilities/${item.relativePath}`,
      scopes,
      scope,
      scopeLabel: scope.length > 28 ? `${scope.slice(0, 26)}...` : scope,
      dependencies: item.capability.agent?.depends_on ?? [],
      dependents: [],
      verificationGaps: gapsByCapability.get(item.capability.id) ?? []
    };
  });
  const dependentsById = new Map<string, string[]>();
  for (const node of nodes) dependentsById.set(node.id, []);
  for (const node of nodes) {
    for (const dep of node.agent?.depends_on ?? []) {
      dependentsById.set(dep, [...(dependentsById.get(dep) ?? []), node.id]);
    }
  }
  for (const node of nodes) {
    node.dependents = dependentsById.get(node.id) ?? [];
  }

  const width = 1440;
  const height = 980;
  const areas = [...new Set(nodes.map((node) => node.area))].sort();
  const scopes = [...new Set(nodes.flatMap((node) => node.scopes))].sort((a, b) => a.localeCompare(b));
  const sorted = [...nodes].sort(
    (a, b) => (dependentsById.get(b.id)?.length ?? 0) - (dependentsById.get(a.id)?.length ?? 0) || a.id.localeCompare(b.id)
  );
  const graphNodes = sorted.map((node, i) => {
    const gaps = gapsById.get(node.id) ?? 0;
    const impact = dependentsById.get(node.id)?.length ?? 0;
    const areaIndex = Math.max(areas.indexOf(node.area), 0);
    const columnCount = Math.max(areas.length, 1);
    const row = Math.floor(i / columnCount);
    const storyMap = node.planning?.story_map
      ? {
          release: node.planning.story_map.release,
          backbone: node.planning.story_map.backbone,
          step: node.planning.story_map.step,
          name: node.planning.story_map.release,
          label: `${node.planning.story_map.release} / ${node.planning.story_map.backbone} / ${node.planning.story_map.step}`
        }
      : undefined;
    return {
      id: node.id,
      title: node.title,
      label: node.title.length > 28 ? `${node.title.slice(0, 26)}...` : node.title,
      area: node.area,
      scopes: node.scopes,
      scope: node.scope,
      scopeLabel: node.scopeLabel,
      status: node.status,
      summary: node.summary,
      intent: node.intent,
      acceptance: node.acceptance,
      guidance: node.guidance ?? [],
      path: node.path,
      dependencies: node.dependencies,
      dependents: node.dependents,
      implementationReferences: node.agent?.implementation?.references ?? [],
      automatedChecks: node.agent?.verification?.automated ?? [],
      manualChecks: node.agent?.verification?.manual ?? [],
      verificationGaps: node.verificationGaps,
      review: node.agent?.review,
      storyMap,
      impact,
      gaps,
      r: 38 + Math.min(impact, 8) * 5 + Math.min(gaps, 3) * 3,
      x: 170 + areaIndex * ((width - 340) / Math.max(columnCount - 1, 1)) + (row % 2) * 24,
      y: 170 + row * 118
    };
  });
  const graphLinks = sorted.flatMap((node) =>
    (node.agent?.depends_on ?? []).map((dep) => ({
      source: dep,
      target: node.id
    }))
  );

  return {
    width,
    height,
    scopes,
    storyMaps: [...new Set(graphNodes.map((node) => node.storyMap?.name).filter((name): name is string => Boolean(name)))].sort((a, b) =>
      a.localeCompare(b)
    ),
    hasUnassignedStoryMap: graphNodes.some((node) => !node.storyMap),
    nodes: graphNodes,
    links: graphLinks
  };
}

function graphSvg(loaded: LoadCapabilitiesResult, gapsById: Map<string, number>): string {
  const model = buildGraphViewModel(loaded, gapsById);
  const { width, height } = model;
  const graphData = JSON.stringify({ nodes: model.nodes, links: model.links }).replaceAll("</", "<\\/");
  const scopeOptions = [
    '<option value="">All folders</option>',
    ...model.scopes.map((scope) => `<option value="${escapeAttribute(scope)}">${escapeAttribute(scope)}</option>`)
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Capability dependency graph</title>
  <desc id="desc">Generated by capabilitykit graph. Nodes animate into a collision-free force layout and can be dragged.</desc>
  <defs>
    <radialGradient id="backdrop" cx="50%" cy="38%" r="72%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="58%" stop-color="#f6f8fb" />
      <stop offset="100%" stop-color="#eef2f7" />
    </radialGradient>
    <linearGradient id="link-gradient" x1="0" x2="1">
      <stop offset="0%" stop-color="#74c0fc" />
      <stop offset="100%" stop-color="#a78bfa" />
    </linearGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.12" />
    </filter>
    <filter id="soft-glow" x="-35%" y="-35%" width="170%" height="170%">
      <feGaussianBlur stdDeviation="5" result="blur" />
      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
    <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
      <path d="M0.8,0.8 L6.6,3.5 L0.8,6.2 z" fill="#7c8da5" />
    </marker>
  </defs>
  <style>
    svg { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; }
    .chrome-title { font-size: 31px; font-weight: 740; fill: #111827; letter-spacing: 0; }
    .chrome-subtitle { font-size: 14px; font-weight: 560; fill: #64748b; }
    .legend text { font-size: 12px; font-weight: 620; fill: #475569; }
    .legend circle { stroke-width: 4; fill: #ffffff; }
    .control-label { font-size: 11px; font-weight: 650; fill: #475569; text-transform: uppercase; }
    .control-value { font-size: 11px; font-weight: 560; fill: #64748b; }
    .slider-track { stroke: #cbd5e1; stroke-width: 8; stroke-linecap: round; }
    .slider-fill { stroke: #7dd3fc; stroke-width: 8; stroke-linecap: round; }
    .slider-knob { fill: #ffffff; stroke: #0ea5e9; stroke-width: 3; filter: url(#shadow); cursor: ew-resize; }
    .scope-select-wrap { color: #475569; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .scope-select-wrap label { display: block; margin-bottom: 7px; font-size: 11px; font-weight: 650; text-transform: uppercase; }
    .scope-select-wrap select { width: 202px; height: 34px; border: 1px solid #cbd5e1; border-radius: 7px; background: rgba(255,255,255,0.9); color: #0f172a; font: 600 12px Inter, ui-sans-serif, system-ui, sans-serif; padding: 0 10px; box-shadow: 0 8px 20px rgba(15,23,42,0.08); }
    .link { fill: none; stroke: url(#link-gradient); stroke-width: 1.9; stroke-opacity: 0.46; marker-end: url(#arrow); transition: stroke-opacity 160ms ease, stroke-width 160ms ease; }
    .link.active { stroke-opacity: 0.9; stroke-width: 3; filter: url(#soft-glow); }
    .node { cursor: grab; filter: url(#shadow); transition: opacity 160ms ease; }
    .node:active { cursor: grabbing; }
    .node.dimmed, .link.dimmed { opacity: 0.18; }
    .node-halo { fill: transparent; stroke-width: 10; stroke-opacity: 0.14; }
    .node-ring { fill: #ffffff; stroke-width: 4.5; }
    .node-core { fill: #ffffff; stroke: rgba(15, 23, 42, 0.08); stroke-width: 1; }
    .node text { text-anchor: middle; pointer-events: none; }
    .node .label { font-size: 12px; font-weight: 720; fill: #0f172a; }
    .node .meta { font-size: 10px; font-weight: 590; fill: #64748b; text-transform: uppercase; }
    .implemented .node-ring, .implemented.legend-dot { stroke: #10b981; }
    .implemented .node-halo { stroke: #10b981; }
    .review .node-ring, .review.legend-dot { stroke: #3b82f6; stroke-dasharray: 8 6; }
    .review .node-halo { stroke: #3b82f6; }
    .gap .node-ring, .gap.legend-dot { stroke: #f43f5e; }
    .gap .node-halo { stroke: #f43f5e; }
    .planned .node-ring, .planned.legend-dot { stroke: #f59e0b; stroke-dasharray: 6 6; }
    .planned .node-halo { stroke: #f59e0b; }
    .detail-card { fill: rgba(255,255,255,0.92); stroke: rgba(148,163,184,0.6); filter: url(#shadow); }
    .detail-title { font-size: 15px; font-weight: 720; fill: #111827; }
    .detail-line { font-size: 12px; font-weight: 560; fill: #475569; }
    .drag-note { font-size: 12px; font-weight: 590; fill: #64748b; }
  </style>
  <rect width="${width}" height="${height}" fill="url(#backdrop)" />
  <g transform="translate(52 46)">
    <text class="chrome-title">Capability dependency graph</text>
    <text class="chrome-subtitle" y="30">Animated force layout. Drag nodes to inspect dependency paths.</text>
  </g>
  <g class="legend" transform="translate(1040 44)">
    <circle class="implemented legend-dot" cx="0" cy="0" r="9" /><text x="18" y="4">Implemented</text>
    <circle class="review legend-dot" cx="0" cy="28" r="9" /><text x="18" y="32">In progress</text>
    <circle class="gap legend-dot" cx="150" cy="0" r="9" /><text x="168" y="4">Verification gap</text>
    <circle class="planned legend-dot" cx="150" cy="28" r="9" /><text x="168" y="32">Planned</text>
  </g>
  <g id="controls" transform="translate(1040 102)">
    <g class="slider" data-control="zoom" transform="translate(0 0)">
      <text class="control-label" x="0" y="0">Zoom</text>
      <text id="zoom-value" class="control-value" x="202" y="0" text-anchor="end">100%</text>
      <line class="slider-track" x1="0" y1="24" x2="202" y2="24" />
      <line id="zoom-fill" class="slider-fill" x1="0" y1="24" x2="86" y2="24" />
      <circle id="zoom-knob" class="slider-knob" cx="86" cy="24" r="10" />
    </g>
    <g class="slider" data-control="force" transform="translate(0 58)">
      <text class="control-label" x="0" y="0">Spacing</text>
      <text id="force-value" class="control-value" x="202" y="0" text-anchor="end">125%</text>
      <line class="slider-track" x1="0" y1="24" x2="202" y2="24" />
      <line id="force-fill" class="slider-fill" x1="0" y1="24" x2="101" y2="24" />
      <circle id="force-knob" class="slider-knob" cx="101" cy="24" r="10" />
    </g>
    <foreignObject x="0" y="120" width="220" height="68">
      <div xmlns="http://www.w3.org/1999/xhtml" class="scope-select-wrap">
        <label for="scope-filter">Scope</label>
        <select id="scope-filter" aria-label="Filter graph by capability folder">${scopeOptions}</select>
      </div>
    </foreignObject>
  </g>
  <g id="graph">
    <g id="links"></g>
    <g id="nodes"></g>
  </g>
  <g id="details" opacity="0" transform="translate(52 790)">
    <rect class="detail-card" width="520" height="106" rx="16" />
    <text id="detail-title" class="detail-title" x="24" y="34">Capability</text>
    <text id="detail-status" class="detail-line" x="24" y="60">Status</text>
    <text id="detail-impact" class="detail-line" x="24" y="82">Impact</text>
  </g>
  <text class="drag-note" x="52" y="950">Open this SVG directly in a browser for animation and dragging.</text>
  <script><![CDATA[
const graph = ${graphData};
const width = ${width};
const height = ${height};
const padding = 74;
const graphLayer = document.getElementById("graph");
const linksLayer = document.getElementById("links");
const nodesLayer = document.getElementById("nodes");
const details = document.getElementById("details");
const detailTitle = document.getElementById("detail-title");
const detailStatus = document.getElementById("detail-status");
const detailImpact = document.getElementById("detail-impact");
const zoomValue = document.getElementById("zoom-value");
const zoomFill = document.getElementById("zoom-fill");
const zoomKnob = document.getElementById("zoom-knob");
const forceValue = document.getElementById("force-value");
const forceFill = document.getElementById("force-fill");
const forceKnob = document.getElementById("force-knob");
const scopeFilter = document.getElementById("scope-filter");
const byId = new Map(graph.nodes.map((node) => [node.id, node]));
const links = graph.links
  .map((link) => ({ source: byId.get(link.source), target: byId.get(link.target) }))
  .filter((link) => link.source && link.target);
const linked = new Set();
for (const link of links) {
  linked.add(link.source.id + "->" + link.target.id);
  linked.add(link.target.id + "->" + link.source.id);
}
const statusClass = (node) => node.gaps > 0 ? "gap" : node.status === "planned" ? "planned" : node.status === "in-progress" ? "review" : "implemented";
function el(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
const linkEls = links.map((link) => {
  const path = el("path", { class: "link" });
  linksLayer.appendChild(path);
  return { ...link, el: path };
});
const nodeEls = graph.nodes.map((node) => {
  node.vx = 0;
  node.vy = 0;
  const group = el("g", { class: "node " + statusClass(node), tabindex: "0" });
  group.appendChild(el("circle", { class: "node-halo", r: node.r + 8 }));
  group.appendChild(el("circle", { class: "node-ring", r: node.r }));
  group.appendChild(el("circle", { class: "node-core", r: Math.max(node.r - 10, 20) }));
  const label = el("text", { class: "label", y: "-3" });
  const words = node.label.split(" ");
  if (words.length > 2) {
    const first = el("tspan", { x: 0, dy: "-3" });
    first.textContent = words.slice(0, Math.ceil(words.length / 2)).join(" ");
    const second = el("tspan", { x: 0, dy: "14" });
    second.textContent = words.slice(Math.ceil(words.length / 2)).join(" ");
    label.append(first, second);
  } else {
    label.textContent = node.label;
  }
  const meta = el("text", { class: "meta", y: node.r - 12 });
  meta.textContent = node.scopeLabel;
  group.append(label, meta);
  group.addEventListener("pointerdown", (event) => startDrag(event, node, group));
  group.addEventListener("pointerenter", () => highlight(node));
  group.addEventListener("pointerleave", clearHighlight);
  group.addEventListener("focus", () => highlight(node));
  group.addEventListener("blur", clearHighlight);
  nodesLayer.appendChild(group);
  return { node, el: group };
});
let alpha = 1;
let dragging = null;
let frameId = 0;
let zoomLevel = 1;
let forceScale = 1.25;
let selectedScope = "";
function scopeVisible(node) {
  return !selectedScope || node.scopes.includes(selectedScope);
}
function sliderX(value, min, max) {
  return ((value - min) / (max - min)) * 202;
}
function applyZoom() {
  const tx = width / 2 - (width / 2) * zoomLevel;
  const ty = height / 2 - (height / 2) * zoomLevel;
  graphLayer.setAttribute("transform", "translate(" + tx.toFixed(1) + " " + ty.toFixed(1) + ") scale(" + zoomLevel.toFixed(3) + ")");
  zoomValue.textContent = Math.round(zoomLevel * 100) + "%";
  const x = sliderX(zoomLevel, 0.72, 1.38);
  zoomFill.setAttribute("x2", x.toFixed(1));
  zoomKnob.setAttribute("cx", x.toFixed(1));
}
function applyForceControl() {
  forceValue.textContent = Math.round(forceScale * 100) + "%";
  const x = sliderX(forceScale, 0.9, 1.7);
  forceFill.setAttribute("x2", x.toFixed(1));
  forceKnob.setAttribute("cx", x.toFixed(1));
}
function attachSlider(knob, min, max, current, onChange) {
  const trackStart = 0;
  const trackWidth = 202;
  knob.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    knob.setPointerCapture(event.pointerId);
    const slider = knob.closest(".slider");
    const matrix = slider.getScreenCTM().inverse();
    const update = (moveEvent) => {
      const point = document.documentElement.createSVGPoint();
      point.x = moveEvent.clientX;
      point.y = moveEvent.clientY;
      const local = point.matrixTransform(matrix);
      const clamped = Math.max(trackStart, Math.min(trackWidth, local.x));
      const value = min + (clamped / trackWidth) * (max - min);
      onChange(value);
    };
    const stop = () => {
      knob.removeEventListener("pointermove", update);
      knob.removeEventListener("pointerup", stop);
      knob.removeEventListener("pointercancel", stop);
    };
    update(event);
    knob.addEventListener("pointermove", update);
    knob.addEventListener("pointerup", stop);
    knob.addEventListener("pointercancel", stop);
  });
  onChange(current);
}
function forceTick() {
  for (const node of graph.nodes) {
    if (!scopeVisible(node)) continue;
    node.vx += (width / 2 - node.x) * 0.0009 * alpha;
    node.vy += (height / 2 + 18 - node.y) * 0.0009 * alpha;
  }
  for (const link of links) {
    if (!scopeVisible(link.source) || !scopeVisible(link.target)) continue;
    const dx = link.target.x - link.source.x;
    const dy = link.target.y - link.source.y;
    const distance = Math.hypot(dx, dy) || 1;
    const targetDistance = (210 + Math.max(link.source.r, link.target.r) * 0.55) * forceScale;
    const strength = (distance - targetDistance) * 0.012 * alpha;
    const fx = (dx / distance) * strength;
    const fy = (dy / distance) * strength;
    if (!link.source.fixed) {
      link.source.vx += fx;
      link.source.vy += fy;
    }
    if (!link.target.fixed) {
      link.target.vx -= fx;
      link.target.vy -= fy;
    }
  }
  for (let i = 0; i < graph.nodes.length; i++) {
    for (let j = i + 1; j < graph.nodes.length; j++) {
      const a = graph.nodes[i];
      const b = graph.nodes[j];
      if (!scopeVisible(a) || !scopeVisible(b)) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 1;
      const minDistance = (a.r + b.r + 46) * forceScale;
      const repulsion = Math.min((15000 * forceScale) / (distance * distance), 2.4) * alpha;
      const nx = dx / distance;
      const ny = dy / distance;
      if (!a.fixed) {
        a.vx -= nx * repulsion;
        a.vy -= ny * repulsion;
      }
      if (!b.fixed) {
        b.vx += nx * repulsion;
        b.vy += ny * repulsion;
      }
      if (distance < minDistance) {
        const push = ((minDistance - distance) / distance) * 0.55;
        if (!a.fixed) {
          a.x -= dx * push;
          a.y -= dy * push;
        }
        if (!b.fixed) {
          b.x += dx * push;
          b.y += dy * push;
        }
      }
    }
  }
  for (const node of graph.nodes) {
    if (!scopeVisible(node)) continue;
    if (!node.fixed) {
      node.vx *= 0.78;
      node.vy *= 0.78;
      node.x += node.vx;
      node.y += node.vy;
    }
    node.x = Math.max(padding + node.r, Math.min(width - padding - node.r, node.x));
    node.y = Math.max(118 + node.r, Math.min(height - padding - node.r, node.y));
  }
  alpha = dragging ? Math.max(alpha * 0.96, 0.34) : alpha * 0.972;
}
function render() {
  for (const link of linkEls) {
    if (!scopeVisible(link.source) || !scopeVisible(link.target)) continue;
    const dx = link.target.x - link.source.x;
    const dy = link.target.y - link.source.y;
    const distance = Math.hypot(dx, dy) || 1;
    const sx = link.source.x + (dx / distance) * (link.source.r + 7);
    const sy = link.source.y + (dy / distance) * (link.source.r + 7);
    const tx = link.target.x - (dx / distance) * (link.target.r + 11);
    const ty = link.target.y - (dy / distance) * (link.target.r + 11);
    const curve = Math.min(90, distance * 0.18);
    const mx = (sx + tx) / 2 - (dy / distance) * curve;
    const my = (sy + ty) / 2 + (dx / distance) * curve;
    link.el.setAttribute("d", "M" + sx.toFixed(1) + "," + sy.toFixed(1) + " Q" + mx.toFixed(1) + "," + my.toFixed(1) + " " + tx.toFixed(1) + "," + ty.toFixed(1));
  }
  for (const item of nodeEls) {
    item.el.setAttribute("transform", "translate(" + item.node.x.toFixed(1) + " " + item.node.y.toFixed(1) + ")");
  }
}
function animate() {
  for (let i = 0; i < 4; i++) forceTick();
  render();
  const maxVelocity = graph.nodes.reduce((max, node) => Math.max(max, Math.abs(node.vx) + Math.abs(node.vy)), 0);
  if (!dragging && alpha < 0.016 && maxVelocity < 0.05) {
    for (const node of graph.nodes) {
      node.vx = 0;
      node.vy = 0;
    }
    alpha = 0;
    frameId = 0;
    render();
    return;
  }
  frameId = requestAnimationFrame(animate);
}
function restartSimulation(nextAlpha = 0.7) {
  alpha = Math.max(alpha, nextAlpha);
  if (!frameId) frameId = requestAnimationFrame(animate);
}
function applyScopeFilter() {
  details.setAttribute("opacity", "0");
  for (const item of nodeEls) {
    item.el.style.display = scopeVisible(item.node) ? "" : "none";
    item.el.classList.remove("dimmed");
  }
  for (const link of linkEls) {
    const visible = scopeVisible(link.source) && scopeVisible(link.target);
    link.el.style.display = visible ? "" : "none";
    link.el.classList.remove("active", "dimmed");
  }
  restartSimulation(1);
  render();
}
attachSlider(zoomKnob, 0.72, 1.38, zoomLevel, (value) => {
  zoomLevel = value;
  applyZoom();
});
attachSlider(forceKnob, 0.9, 1.7, forceScale, (value) => {
  forceScale = value;
  applyForceControl();
  restartSimulation(0.85);
});
scopeFilter.addEventListener("change", () => {
  selectedScope = scopeFilter.value;
  applyScopeFilter();
});
function svgPoint(event) {
  const svg = event.currentTarget.ownerSVGElement || document.documentElement;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(graphLayer.getScreenCTM().inverse());
}
function startDrag(event, node, group) {
  event.preventDefault();
  group.setPointerCapture(event.pointerId);
  dragging = node;
  node.fixed = true;
  restartSimulation(0.75);
  const move = (moveEvent) => {
    const point = svgPoint(moveEvent);
    node.x = point.x;
    node.y = point.y;
    node.vx = 0;
    node.vy = 0;
    render();
  };
  const up = () => {
    node.fixed = false;
    dragging = null;
    group.removeEventListener("pointermove", move);
    group.removeEventListener("pointerup", up);
    group.removeEventListener("pointercancel", up);
  };
  group.addEventListener("pointermove", move);
  group.addEventListener("pointerup", up);
  group.addEventListener("pointercancel", up);
}
function highlight(node) {
  if (!scopeVisible(node)) return;
  const cardWidth = 520;
  const cardHeight = 106;
  const visualX = width / 2 + (node.x - width / 2) * zoomLevel;
  const visualY = height / 2 + (node.y - height / 2) * zoomLevel;
  const visualR = node.r * zoomLevel;
  const x = Math.max(28, Math.min(width - cardWidth - 28, visualX + visualR + 22));
  const preferredY = visualY + visualR + 18;
  const fallbackY = visualY - visualR - cardHeight - 18;
  const y = preferredY + cardHeight < height - 34 ? preferredY : Math.max(104, fallbackY);
  details.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")");
  details.setAttribute("opacity", "1");
  detailTitle.textContent = node.title;
  detailStatus.textContent = node.id + " | " + node.status + " | " + node.scope;
  detailImpact.textContent = "Direct dependents: " + node.impact + " | verification gaps: " + node.gaps;
  for (const item of nodeEls) {
    const connected = scopeVisible(item.node) && (item.node.id === node.id || linked.has(item.node.id + "->" + node.id));
    item.el.classList.toggle("dimmed", !connected);
  }
  for (const link of linkEls) {
    const active = scopeVisible(link.source) && scopeVisible(link.target) && (link.source.id === node.id || link.target.id === node.id);
    link.el.classList.toggle("active", active);
    link.el.classList.toggle("dimmed", !active);
  }
}
function clearHighlight() {
  details.setAttribute("opacity", "0");
  for (const item of nodeEls) item.el.classList.remove("dimmed");
  for (const link of linkEls) link.el.classList.remove("active", "dimmed");
}
applyScopeFilter();
restartSimulation(1);
  ]]></script>
</svg>\n`;
}

function graphViewerHtml(loaded: LoadCapabilitiesResult, gapsById: Map<string, number>): string {
  const model = buildGraphViewModel(loaded, gapsById);
  const graphData = JSON.stringify({
    nodes: model.nodes,
    links: model.links,
    scopes: model.scopes,
    storyMaps: model.storyMaps,
    hasUnassignedStoryMap: model.hasUnassignedStoryMap
  }).replaceAll("</", "<\\/");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Capability dependency viewer</title>
    <style>
      :root {
        --bg: #f6f8fb;
        --panel: #ffffff;
        --ink: #111827;
        --muted: #64748b;
        --line: #d8e0ea;
        --green: #10b981;
        --blue: #3b82f6;
        --rose: #f43f5e;
        --amber: #f59e0b;
        --link: #78a8ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: radial-gradient(circle at 35% 0%, #ffffff 0%, var(--bg) 62%, #eef2f7 100%);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .app {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 420px;
        min-height: 100vh;
      }
      .main {
        min-width: 0;
        padding: 28px 30px 24px;
      }
      .topbar {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 18px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
        letter-spacing: 0;
      }
      .subtitle {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 14px;
        font-weight: 560;
      }
      .controls {
        display: flex;
        align-items: end;
        gap: 12px;
        flex-wrap: wrap;
      }
      label {
        display: grid;
        gap: 6px;
        color: #475569;
        font-size: 11px;
        font-weight: 750;
        text-transform: uppercase;
      }
      select, input[type="range"] {
        accent-color: #0ea5e9;
      }
      select {
        width: 230px;
        height: 34px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: rgba(255,255,255,0.92);
        color: var(--ink);
        font: 650 12px Inter, ui-sans-serif, system-ui, sans-serif;
        padding: 0 10px;
      }
      .range-label {
        min-width: 150px;
      }
      .range-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .range-row span {
        min-width: 42px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 650;
        text-align: right;
      }
      .graph-shell {
        position: relative;
        height: calc(100vh - 118px);
        min-height: 620px;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(255,255,255,0.54);
        box-shadow: 0 18px 52px rgba(15, 23, 42, 0.08);
      }
      svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .legend {
        position: absolute;
        left: 18px;
        bottom: 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px 16px;
        padding: 10px 12px;
        border: 1px solid rgba(148, 163, 184, 0.38);
        border-radius: 8px;
        background: rgba(255,255,255,0.9);
        color: #475569;
        font-size: 12px;
        font-weight: 650;
        backdrop-filter: blur(6px);
      }
      .legend span { display: inline-flex; align-items: center; gap: 6px; }
      .dot {
        width: 12px;
        height: 12px;
        border: 3px solid var(--green);
        border-radius: 999px;
        background: white;
      }
      .dot.review { border-color: var(--blue); border-style: dashed; }
      .dot.gap { border-color: var(--rose); }
      .dot.planned { border-color: var(--amber); border-style: dashed; }
      .link {
        fill: none;
        stroke: var(--link);
        stroke-width: 2;
        stroke-opacity: 0.42;
        marker-end: url(#arrow);
        transition: opacity 140ms ease, stroke-width 140ms ease;
      }
      .link.active { stroke-width: 3.2; stroke-opacity: 0.92; }
      .link.dimmed { opacity: 0.13; }
      .link.story-map-muted { opacity: 0.12; }
      .node { cursor: pointer; filter: drop-shadow(0 12px 18px rgba(15,23,42,0.12)); }
      .node.dimmed { opacity: 0.2; }
      .node.story-map-muted { opacity: 0.2; }
      .node-halo { fill: transparent; stroke-width: 10; stroke-opacity: 0.15; }
      .node-ring { fill: #fff; stroke-width: 4.6; }
      .node-core { fill: #fff; stroke: rgba(15,23,42,0.08); stroke-width: 1; }
      .implemented .node-ring, .implemented .node-halo { stroke: var(--green); }
      .review .node-ring, .review .node-halo { stroke: var(--blue); stroke-dasharray: 8 6; }
      .gap .node-ring, .gap .node-halo { stroke: var(--rose); }
      .planned .node-ring, .planned .node-halo { stroke: var(--amber); stroke-dasharray: 6 6; }
      .node.selected .node-ring { stroke-width: 7; }
      .node text { text-anchor: middle; pointer-events: none; }
      .label { font-size: 12px; font-weight: 760; fill: #0f172a; }
      .meta { font-size: 9.5px; font-weight: 650; fill: var(--muted); text-transform: uppercase; }
      aside {
        min-width: 0;
        border-left: 1px solid var(--line);
        background: rgba(255,255,255,0.92);
        overflow: auto;
      }
      .panel {
        padding: 26px 24px 34px;
      }
      .panel h2 {
        margin: 0;
        font-size: 23px;
        line-height: 1.2;
        letter-spacing: 0;
      }
      .panel .id {
        margin: 7px 0 0;
        color: var(--muted);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin: 16px 0 20px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 25px;
        padding: 4px 8px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 750;
      }
      .badge.gap { border-color: rgba(244,63,94,0.35); color: #be123c; background: #fff1f2; }
      .section {
        padding: 18px 0;
        border-top: 1px solid var(--line);
      }
      .section.acceptance {
        margin: 18px -12px 0;
        padding: 16px 12px;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        background: #eff6ff;
      }
      .section h3 {
        margin: 0 0 9px;
        color: #334155;
        font-size: 12px;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      .section p {
        margin: 0;
        color: #475569;
        font-size: 13px;
        line-height: 1.55;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      li {
        margin: 6px 0;
        color: #475569;
        font-size: 13px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }
      .acceptance-list {
        display: grid;
        gap: 8px;
      }
      .acceptance-item {
        display: grid;
        grid-template-columns: 23px minmax(0, 1fr);
        gap: 9px;
        align-items: start;
        padding: 10px 11px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        background: rgba(255,255,255,0.78);
        color: #334155;
        font-size: 13px;
        line-height: 1.45;
      }
      .acceptance-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 23px;
        height: 23px;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 850;
        line-height: 1;
      }
      .acceptance-item.covered {
        border-color: rgba(16,185,129,0.36);
        background: #ecfdf5;
      }
      .acceptance-item.covered .acceptance-icon {
        background: #10b981;
        color: #ffffff;
      }
      .acceptance-item.gap {
        border-color: rgba(244,63,94,0.36);
        background: #fff1f2;
      }
      .acceptance-item.gap .acceptance-icon {
        background: #f43f5e;
        color: #ffffff;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .empty {
        color: #94a3b8;
        font-size: 13px;
      }
      .criterion {
        margin: 8px 0;
        padding: 9px 10px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: #f8fafc;
      }
      .criterion strong {
        display: inline-flex;
        margin-bottom: 5px;
        font-size: 11px;
        text-transform: uppercase;
      }
      .review-evidence {
        margin-top: 18px;
        border-top: 1px solid var(--line);
        color: #475569;
      }
      .review-evidence summary {
        cursor: pointer;
        padding: 14px 0;
        color: #334155;
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }
      .review-evidence[open] summary {
        padding-bottom: 8px;
      }
      @media (max-width: 980px) {
        .app { grid-template-columns: 1fr; }
        aside { border-left: 0; border-top: 1px solid var(--line); }
        .graph-shell { height: 620px; }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <main class="main">
        <div class="topbar">
          <div>
            <h1>Capability dependency viewer</h1>
            <p class="subtitle">Click a capability to inspect intent, references, verification, review status, and relationships.</p>
          </div>
          <div class="controls">
            <label>Scope
              <select id="scope-filter" aria-label="Filter graph by capability folder"></select>
            </label>
            <label>Story Map
              <select id="story-map-filter" aria-label="Filter graph by story map"></select>
            </label>
            <label class="range-label">Zoom
              <span class="range-row"><input id="zoom" type="range" min="72" max="138" value="100" /><span id="zoom-value">100%</span></span>
            </label>
            <label class="range-label">Spacing
              <span class="range-row"><input id="spacing" type="range" min="90" max="170" value="125" /><span id="spacing-value">125%</span></span>
            </label>
          </div>
        </div>
        <div class="graph-shell">
          <svg id="graph-svg" viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="Capability dependency graph">
            <defs>
              <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0.8,0.8 L6.6,3.5 L0.8,6.2 z" fill="#7c8da5"></path>
              </marker>
            </defs>
            <g id="viewport"><g id="links"></g><g id="nodes"></g></g>
          </svg>
          <div class="legend">
            <span><i class="dot"></i>Implemented</span>
            <span><i class="dot review"></i>In progress</span>
            <span><i class="dot gap"></i>Verification gap</span>
            <span><i class="dot planned"></i>Planned</span>
          </div>
        </div>
      </main>
      <aside><div id="panel" class="panel"></div></aside>
    </div>
    <script>
const graph = ${graphData};
const width = ${model.width};
const height = ${model.height};
const padding = 74;
let selectedScope = "";
let selectedStoryMap = "";
let selectedNode = graph.nodes[0];
let zoomLevel = 1;
let forceScale = 1.25;
let alpha = 1;
let dragging = null;
let frameId = 0;
const viewport = document.getElementById("viewport");
const linksLayer = document.getElementById("links");
const nodesLayer = document.getElementById("nodes");
const panel = document.getElementById("panel");
const scopeFilter = document.getElementById("scope-filter");
const storyMapFilter = document.getElementById("story-map-filter");
const zoom = document.getElementById("zoom");
const spacing = document.getElementById("spacing");
const zoomValue = document.getElementById("zoom-value");
const spacingValue = document.getElementById("spacing-value");
const byId = new Map(graph.nodes.map((node) => [node.id, node]));
const links = graph.links.map((link) => ({ source: byId.get(link.source), target: byId.get(link.target) })).filter((link) => link.source && link.target);
const linked = new Set();
for (const link of links) {
  linked.add(link.source.id + "->" + link.target.id);
  linked.add(link.target.id + "->" + link.source.id);
}
scopeFilter.append(new Option("All folders", ""));
for (const scope of graph.scopes) scopeFilter.append(new Option(scope, scope));
storyMapFilter.append(new Option("All story maps", ""));
for (const storyMap of graph.storyMaps) storyMapFilter.append(new Option(storyMap, storyMap));
if (graph.hasUnassignedStoryMap) storyMapFilter.append(new Option("Unassigned", "__unassigned"));
function visible(node) {
  return !selectedScope || node.scopes.includes(selectedScope);
}
function storyMapMatches(node) {
  return (
    !selectedStoryMap ||
    (selectedStoryMap === "__unassigned" ? !node.storyMap : node.storyMap?.name === selectedStoryMap)
  );
}
function emphasized(node) {
  return visible(node) && storyMapMatches(node);
}
function statusClass(node) { return node.gaps > 0 ? "gap" : node.status === "planned" ? "planned" : node.status === "in-progress" ? "review" : "implemented"; }
function el(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function htmlEl(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function list(values, formatter = (value) => value) {
  if (!values || values.length === 0) return htmlEl("div", "empty", "None");
  const ul = document.createElement("ul");
  for (const value of values) {
    const li = document.createElement("li");
    const formatted = formatter(value);
    if (formatted instanceof Node) li.append(formatted);
    else li.textContent = String(formatted);
    ul.append(li);
  }
  return ul;
}
function section(title, body, className = "") {
  const wrapper = htmlEl("section", className ? "section " + className : "section");
  wrapper.append(htmlEl("h3", "", title), body);
  return wrapper;
}
function reviewKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function reviewForAcceptance(node, acceptance) {
  const key = reviewKey(acceptance);
  return (node.review?.criteria ?? []).find((criterion) => reviewKey(criterion.criterion) === key);
}
function acceptanceList(node) {
  if (!node.acceptance || node.acceptance.length === 0) return htmlEl("div", "empty", "None");
  const wrapper = htmlEl("div", "acceptance-list");
  for (const acceptance of node.acceptance) {
    const review = reviewForAcceptance(node, acceptance);
    const covered = review?.status === "covered";
    const item = htmlEl("div", covered ? "acceptance-item covered" : "acceptance-item gap");
    const icon = htmlEl("span", "acceptance-icon", covered ? "\\u2713" : "\\u00d7");
    icon.setAttribute("aria-label", covered ? "Covered" : "Not covered");
    item.append(icon, htmlEl("span", "", acceptance));
    wrapper.append(item);
  }
  return wrapper;
}
function reviewEvidence(node) {
  if (!node.review?.criteria || node.review.criteria.length === 0) return null;
  const details = htmlEl("details", "review-evidence");
  details.append(htmlEl("summary", "", "Review Evidence"));
  details.append(list(node.review.criteria, (criterion) => {
    const wrapper = htmlEl("div", "criterion");
    wrapper.append(htmlEl("strong", "", criterion.status), document.createTextNode(criterion.criterion));
    if (criterion.evidence?.length) {
      wrapper.append(list(criterion.evidence, (evidence) => {
        const code = document.createElement("code");
        code.textContent = evidence;
        return code;
      }));
    }
    return wrapper;
  }));
  return details;
}
const linkEls = links.map((link) => {
  const path = el("path", { class: "link" });
  linksLayer.append(path);
  return { ...link, el: path };
});
const nodeEls = graph.nodes.map((node) => {
  node.vx = 0; node.vy = 0;
  const group = el("g", { class: "node " + statusClass(node), tabindex: "0" });
  group.append(el("circle", { class: "node-halo", r: node.r + 8 }));
  group.append(el("circle", { class: "node-ring", r: node.r }));
  group.append(el("circle", { class: "node-core", r: Math.max(node.r - 10, 20) }));
  const label = el("text", { class: "label", y: "-3" });
  const words = node.label.split(" ");
  if (words.length > 2) {
    const first = el("tspan", { x: 0, dy: "-3" });
    first.textContent = words.slice(0, Math.ceil(words.length / 2)).join(" ");
    const second = el("tspan", { x: 0, dy: "14" });
    second.textContent = words.slice(Math.ceil(words.length / 2)).join(" ");
    label.append(first, second);
  } else {
    label.textContent = node.label;
  }
  const meta = el("text", { class: "meta", y: node.r - 12 });
  meta.textContent = node.scopeLabel;
  group.append(label, meta);
  group.addEventListener("click", () => selectNode(node));
  group.addEventListener("pointerdown", (event) => startDrag(event, node, group));
  group.addEventListener("pointerenter", () => highlight(node));
  group.addEventListener("pointerleave", clearHighlight);
  nodesLayer.append(group);
  return { node, el: group };
});
function selectNode(node) {
  selectedNode = node;
  for (const item of nodeEls) item.el.classList.toggle("selected", item.node.id === node.id);
  renderPanel(node);
  highlight(node);
}
function renderPanel(node) {
  panel.replaceChildren();
  panel.append(htmlEl("h2", "", node.title), htmlEl("p", "id", node.id));
  const badges = htmlEl("div", "badges");
  badges.append(htmlEl("span", "badge", node.status), htmlEl("span", "badge", node.scope), htmlEl("span", node.gaps > 0 ? "badge gap" : "badge", node.gaps + " gaps"), htmlEl("span", "badge", node.impact + " direct dependents"));
  if (node.storyMap?.label) badges.append(htmlEl("span", "badge", node.storyMap.label));
  if (node.review?.depth) badges.append(htmlEl("span", "badge", "review: " + node.review.depth));
  panel.append(badges);
  panel.append(section("Summary", htmlEl("p", "", node.summary)));
  panel.append(section("Intent", htmlEl("p", "", node.intent)));
  panel.append(section("Acceptance", acceptanceList(node), "acceptance"));
  panel.append(section("Implementation References", list(node.implementationReferences, (value) => {
    const code = document.createElement("code");
    code.textContent = value;
    return code;
  })));
  panel.append(section("Verification", list([
    ...node.automatedChecks.map((check) => "Automated: " + (check.id ? check.id + " - " : "") + check.description + (check.command ? " (" + check.command + ")" : "")),
    ...node.manualChecks.map((check) => "Manual: " + check)
  ])));
  panel.append(section("Verification Gaps", list(node.verificationGaps, (gap) => gap.message)));
  const evidence = reviewEvidence(node);
  if (evidence) panel.append(evidence);
  panel.append(section("Dependencies", list(node.dependencies)));
  panel.append(section("Direct Dependents", list(node.dependents)));
  panel.append(section("Path", (() => { const code = document.createElement("code"); code.textContent = node.path; return code; })()));
}
function applyZoom() {
  const tx = width / 2 - (width / 2) * zoomLevel;
  const ty = height / 2 - (height / 2) * zoomLevel;
  viewport.setAttribute("transform", "translate(" + tx.toFixed(1) + " " + ty.toFixed(1) + ") scale(" + zoomLevel.toFixed(3) + ")");
  zoomValue.textContent = Math.round(zoomLevel * 100) + "%";
}
function forceTick() {
  for (const node of graph.nodes) {
    if (!visible(node)) continue;
    node.vx += (width / 2 - node.x) * 0.0009 * alpha;
    node.vy += (height / 2 + 18 - node.y) * 0.0009 * alpha;
  }
  for (const link of links) {
    if (!visible(link.source) || !visible(link.target)) continue;
    const dx = link.target.x - link.source.x;
    const dy = link.target.y - link.source.y;
    const distance = Math.hypot(dx, dy) || 1;
    const targetDistance = (210 + Math.max(link.source.r, link.target.r) * 0.55) * forceScale;
    const strength = (distance - targetDistance) * 0.012 * alpha;
    const fx = (dx / distance) * strength;
    const fy = (dy / distance) * strength;
    if (!link.source.fixed) { link.source.vx += fx; link.source.vy += fy; }
    if (!link.target.fixed) { link.target.vx -= fx; link.target.vy -= fy; }
  }
  for (let i = 0; i < graph.nodes.length; i++) {
    for (let j = i + 1; j < graph.nodes.length; j++) {
      const a = graph.nodes[i], b = graph.nodes[j];
      if (!visible(a) || !visible(b)) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 1;
      const minDistance = (a.r + b.r + 46) * forceScale;
      const repulsion = Math.min((15000 * forceScale) / (distance * distance), 2.4) * alpha;
      const nx = dx / distance, ny = dy / distance;
      if (!a.fixed) { a.vx -= nx * repulsion; a.vy -= ny * repulsion; }
      if (!b.fixed) { b.vx += nx * repulsion; b.vy += ny * repulsion; }
      if (distance < minDistance) {
        const push = ((minDistance - distance) / distance) * 0.55;
        if (!a.fixed) { a.x -= dx * push; a.y -= dy * push; }
        if (!b.fixed) { b.x += dx * push; b.y += dy * push; }
      }
    }
  }
  for (const node of graph.nodes) {
    if (!visible(node)) continue;
    if (!node.fixed) { node.vx *= 0.78; node.vy *= 0.78; node.x += node.vx; node.y += node.vy; }
    node.x = Math.max(padding + node.r, Math.min(width - padding - node.r, node.x));
    node.y = Math.max(118 + node.r, Math.min(height - padding - node.r, node.y));
  }
  alpha = dragging ? Math.max(alpha * 0.96, 0.34) : alpha * 0.972;
}
function render() {
  for (const link of linkEls) {
    if (!visible(link.source) || !visible(link.target)) continue;
    const dx = link.target.x - link.source.x, dy = link.target.y - link.source.y;
    const distance = Math.hypot(dx, dy) || 1;
    const sx = link.source.x + (dx / distance) * (link.source.r + 7);
    const sy = link.source.y + (dy / distance) * (link.source.r + 7);
    const tx = link.target.x - (dx / distance) * (link.target.r + 11);
    const ty = link.target.y - (dy / distance) * (link.target.r + 11);
    const curve = Math.min(90, distance * 0.18);
    const mx = (sx + tx) / 2 - (dy / distance) * curve;
    const my = (sy + ty) / 2 + (dx / distance) * curve;
    link.el.setAttribute("d", "M" + sx.toFixed(1) + "," + sy.toFixed(1) + " Q" + mx.toFixed(1) + "," + my.toFixed(1) + " " + tx.toFixed(1) + "," + ty.toFixed(1));
  }
  for (const item of nodeEls) item.el.setAttribute("transform", "translate(" + item.node.x.toFixed(1) + " " + item.node.y.toFixed(1) + ")");
}
function animate() {
  for (let i = 0; i < 4; i++) forceTick();
  render();
  const maxVelocity = graph.nodes.reduce((max, node) => Math.max(max, Math.abs(node.vx) + Math.abs(node.vy)), 0);
  if (!dragging && alpha < 0.016 && maxVelocity < 0.05) { frameId = 0; return; }
  frameId = requestAnimationFrame(animate);
}
function restart(nextAlpha = 0.7) {
  alpha = Math.max(alpha, nextAlpha);
  if (!frameId) frameId = requestAnimationFrame(animate);
}
function applyFilter() {
  for (const item of nodeEls) {
    item.el.style.display = visible(item.node) ? "" : "none";
    item.el.classList.toggle("story-map-muted", visible(item.node) && !storyMapMatches(item.node));
  }
  for (const link of linkEls) {
    const linkVisible = visible(link.source) && visible(link.target);
    link.el.style.display = linkVisible ? "" : "none";
    link.el.classList.toggle("story-map-muted", linkVisible && (!storyMapMatches(link.source) || !storyMapMatches(link.target)));
  }
  const current = visible(selectedNode) ? selectedNode : graph.nodes.find(visible) ?? graph.nodes[0];
  selectNode(current);
  restart(1);
  render();
}
function svgPoint(event) {
  const svg = event.currentTarget.ownerSVGElement || document.documentElement;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(viewport.getScreenCTM().inverse());
}
function startDrag(event, node, group) {
  event.preventDefault();
  group.setPointerCapture(event.pointerId);
  dragging = node;
  node.fixed = true;
  restart(0.75);
  const move = (moveEvent) => {
    const point = svgPoint(moveEvent);
    node.x = point.x; node.y = point.y; node.vx = 0; node.vy = 0;
    render();
  };
  const up = () => {
    node.fixed = false; dragging = null;
    group.removeEventListener("pointermove", move);
    group.removeEventListener("pointerup", up);
    group.removeEventListener("pointercancel", up);
  };
  group.addEventListener("pointermove", move);
  group.addEventListener("pointerup", up);
  group.addEventListener("pointercancel", up);
}
function highlight(node) {
  if (!visible(node)) return;
  for (const item of nodeEls) {
    const connected = visible(item.node) && (item.node.id === node.id || linked.has(item.node.id + "->" + node.id));
    item.el.classList.toggle("dimmed", !connected);
  }
  for (const link of linkEls) {
    const active = visible(link.source) && visible(link.target) && (link.source.id === node.id || link.target.id === node.id);
    link.el.classList.toggle("active", active);
    link.el.classList.toggle("dimmed", !active);
  }
}
function clearHighlight() {
  for (const item of nodeEls) item.el.classList.remove("dimmed");
  for (const link of linkEls) link.el.classList.remove("active", "dimmed");
}
scopeFilter.addEventListener("change", () => { selectedScope = scopeFilter.value; applyFilter(); });
storyMapFilter.addEventListener("change", () => { selectedStoryMap = storyMapFilter.value; applyFilter(); });
zoom.addEventListener("input", () => { zoomLevel = Number(zoom.value) / 100; applyZoom(); });
spacing.addEventListener("input", () => { forceScale = Number(spacing.value) / 100; spacingValue.textContent = spacing.value + "%"; restart(0.85); });
applyZoom();
applyFilter();
    </script>
  </body>
</html>
`;
}

program
  .name("capabilitykit")
  .description("Capabilities as code for AI-native software teams")
  .version("0.1.0")
  .addHelpText(
    "after",
    `
Common workflows:
  capabilitykit check                 Run the cheap daily health check
  capabilitykit check --fix           Format capabilities and refresh compiled output
  capabilitykit next                  Show the next most useful maintenance actions
  capabilitykit verify <id>           Save deterministic implementation review evidence
  capabilitykit verify <id> --agent codex
                                      Run an opt-in semantic review with an external agent

Command groups:
  Setup:        init, create, skill
  Daily:        check, next, format, validate, compile, status
  Review:       verify, assess, advise, review, sync-review, review-noisy
  Agent:        agent-task, agent-run, agent-review, review-result
  Visualize:    graph, graph-viewer, story-map-viewer
`
  );

program
  .command("init")
  .description("Create a starter .capabilities folder")
  .option("--force", "overwrite existing files")
  .action(async (options: { force?: boolean }) => {
    const root = process.cwd();
    const configPath = path.join(root, ".capabilities", "capabilitykit.yaml");
    const examplePath = path.join(root, ".capabilities", "example.capability.yaml");

    const config = YAML.stringify({
      schema_version: "0.1",
      project: {
        name: path.basename(root),
        description: "Capabilities as code for this repository."
      },
      source: {
        include: ["**/*.capability.yaml"],
        exclude: ["dist/**"]
      },
      validation: {
        require_acceptance: true,
        require_verification: true,
        allow_verification_gaps: true,
        require_implementation_references_for_status: ["implemented", "verified"]
      },
      output: {
        path: ".capabilities/dist/capabilities.json"
      }
    });

    await writeNewFile(configPath, config, options.force);
    await writeNewFile(examplePath, capabilityTemplate("Example capability"), options.force);

    console.log("Created .capabilities/");
    console.log("Created .capabilities/capabilitykit.yaml");
    console.log("Created .capabilities/example.capability.yaml");
    console.log("");
    console.log("Next steps:");
    console.log('  capabilitykit create "User login"');
    console.log("  capabilitykit validate");
    console.log("  capabilitykit compile");
  });

program
  .command("create")
  .description("Create a capability YAML file")
  .argument("<name>", "capability name")
  .option("--area <area>", "capability area", "general")
  .option("--force", "overwrite existing files")
  .action(async (name: string, options: { area: string; force?: boolean }) => {
    const filePath = path.join(process.cwd(), ".capabilities", slugify(options.area), `${slugify(name)}.capability.yaml`);
    await writeNewFile(filePath, capabilityTemplate(name), options.force);
    console.log(`Created ${path.relative(process.cwd(), filePath)}`);
  });

program
  .command("skill")
  .description("Create or update CapabilityKit skill files and agent entrypoints")
  .option(
    "--skill-path <path>",
    "path agents should read for the full CapabilityKit guide",
    "node_modules/@capabilitykit/cli/SKILL.md"
  )
  .action(async (options: { skillPath: string }) => {
    const result = await installCapabilityKitSkill(process.cwd(), { packageSkillPath: options.skillPath });
    console.log("Installed CapabilityKit skill:");
    for (const filePath of result.written) {
      console.log(`  - ${filePath}`);
    }
    console.log("");
    console.log("Try:");
    console.log("  /capabilitykit review .capabilities/core/validation/verify-implementation-references.capability.yaml");
    console.log("  Ask Codex: review this capability against its agent.implementation.references");
  });

program
  .command("format")
  .description("Format capability files into canonical section order and refresh agent section comments")
  .option("--check", "check formatting without writing changes")
  .action(async (options: { check?: boolean }) => {
    const result = await formatCapabilities(process.cwd(), { write: !options.check });
    if (options.check) {
      if (result.changed === 0) {
        console.log(`All ${result.checked} capability files are formatted.`);
        return;
      }
      console.log(`${result.changed} of ${result.checked} capability files need formatting.`);
      for (const filePath of result.files) {
        console.log(`  - ${path.relative(process.cwd(), filePath)}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(`Formatted ${result.changed} of ${result.checked} capability files.`);
  });

program
  .command("check")
  .description("Run the cheap daily capability health check")
  .option("--fix", "format capabilities and refresh compiled output")
  .option("--json", "print the check result as JSON")
  .action(async (options: { fix?: boolean; json?: boolean }) => {
    const formatResult = await formatCapabilities(process.cwd(), { write: options.fix });
    const loaded = await loadCapabilities(process.cwd());
    const validation = validateLoadedCapabilities(loaded);
    const compiled = options.fix ? (await writeCompiledCapabilities(process.cwd())).compiled : await compileCapabilities(process.cwd());
    const status = await summarizeCapabilityStatus(process.cwd());
    const formatted = options.fix || formatResult.changed === 0;
    const ok = formatted && validation.valid && compiled.validation.valid;

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ok,
            formatted,
            format: formatResult,
            validation,
            compiled: {
              capabilities: compiled.capabilities.length,
              verification_summary: compiled.verification_summary
            },
            status: status.summary,
            fixed: Boolean(options.fix)
          },
          null,
          2
        )
      );
      process.exitCode = ok ? 0 : 1;
      return;
    }

    console.log("CapabilityKit check");
    console.log("");
    if (options.fix) {
      console.log(`Formatted ${formatResult.changed} of ${formatResult.checked} capability files.`);
      console.log(`Compiled ${compiled.capabilities.length} capabilities.`);
    } else if (formatResult.changed === 0) {
      console.log(`OK ${formatResult.checked} capability files are formatted.`);
    } else {
      console.log(`!! ${formatResult.changed} of ${formatResult.checked} capability files need formatting.`);
      for (const filePath of formatResult.files) {
        console.log(`  - ${path.relative(process.cwd(), filePath)}`);
      }
      console.log("Run: capabilitykit check --fix");
    }
    console.log(`${validation.valid ? "OK" : "!!"} validation ${validation.valid ? "passed" : "failed"}`);
    console.log(`OK compiled ${compiled.capabilities.length} capabilities in memory`);
    console.log(
      `Status: ${status.summary.ok} ok, ${status.summary.review} needs review, ${status.summary.action} needs action, ${status.summary.planned} planned`
    );
    if (validation.verificationGaps.length > 0) {
      console.log(`Verification gaps: ${validation.verificationGaps.length}`);
    }
    console.log("");
    console.log(`Result: ${ok ? "ok" : "needs attention"}`);
    if (!ok || status.summary.review > 0 || status.summary.action > 0) {
      console.log("Next: capabilitykit next");
    }
    process.exitCode = ok ? 0 : 1;
  });

program
  .command("next")
  .description("Show the next most useful capability maintenance actions")
  .option("--limit <count>", "maximum actions or candidates to list", "5")
  .option("--json", "print the underlying status, advice, and validation reports as JSON")
  .action(async (options: { limit: string; json?: boolean }) => {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Invalid limit "${options.limit}". Expected a positive integer.`);
    }

    const loaded = await loadCapabilities(process.cwd());
    const validation = validateLoadedCapabilities(loaded);
    const status = await summarizeCapabilityStatus(process.cwd());
    const advice = await adviseImplementationCoverage(process.cwd());

    if (options.json) {
      console.log(JSON.stringify({ validation, status, advice }, null, 2));
      return;
    }

    console.log(formatNextActions(validation, status, advice, limit));
  });

program
  .command("verify")
  .description("Verify implementation evidence with deterministic review by default")
  .argument("[capability-id]", "optional capability id; required when using --agent")
  .option("--agent <command>", "external coding agent executable for opt-in semantic review")
  .option("--arg <value>", "argument to pass to the external agent command; repeat for multiple args", collectOption, [])
  .option("--handoff <strategy>", "agent handoff strategy: stdin, argument, or prompt-file", "stdin")
  .option("--prompt-file <path>", "prompt file path for prompt-file handoff")
  .option("--transcript <path>", "write stdout, stderr, exit code, and handoff details to a transcript file")
  .option("--output-prompt <path>", "write the generated agent review prompt to a file")
  .option("--no-references", "omit implementation reference file contents from the agent prompt")
  .option("--recommended", "list high-value semantic review candidates instead of reviewing one capability")
  .option("--stale", "alias for --recommended; list capabilities most likely to need fresh semantic review")
  .option("--limit <count>", "maximum recommended candidates to list", "5")
  .option("--no-save", "print or validate review output without writing agent.review")
  .option("--dry-run", "prepare review output without running an agent or writing files")
  .option("--json", "print the verification result as JSON")
  .action(
    async (
      capabilityId: string | undefined,
      options: {
        agent?: string;
        arg: string[];
        handoff: string;
        promptFile?: string;
        transcript?: string;
        outputPrompt?: string;
        references: boolean;
        recommended?: boolean;
        stale?: boolean;
        limit: string;
        save: boolean;
        dryRun?: boolean;
        json?: boolean;
      }
    ) => {
      if (options.recommended || options.stale) {
        const limit = Number.parseInt(options.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error(`Invalid limit "${options.limit}". Expected a positive integer.`);
        }
        const report = await adviseImplementationCoverage(process.cwd());
        const candidates = noisyCandidates(report, limit);
        if (options.json) {
          console.log(JSON.stringify(candidates, null, 2));
          return;
        }
        console.log(formatReviewRecommendations(report, limit, options.agent ?? "codex"));
        return;
      }

      const save = options.save !== false && !options.dryRun;
      if (!options.agent) {
        const result = await syncReviewEvidence(process.cwd(), capabilityId, { dryRun: !save });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatSyncReviewEvidenceReport(result));
        }
        return;
      }

      if (!capabilityId) {
        console.error("Capability id is required when using --agent.");
        process.exitCode = 1;
        return;
      }

      if (!options.json) {
        console.log(`Semantic verification uses external agent "${options.agent}" and may take more time or tokens.`);
      }

      const review = await buildAgentReviewPrompt(process.cwd(), capabilityId, {
        includeReferences: options.references
      });

      if (options.outputPrompt) {
        const outputPath = path.resolve(process.cwd(), options.outputPrompt);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, review.prompt);
        console.log(`Review prompt: ${path.relative(process.cwd(), outputPath)}`);
      }

      const result = await runExternalAgentCommand({
        command: options.agent,
        args: options.arg,
        cwd: process.cwd(),
        input: review.prompt,
        handoff: parseAgentHandoff(options.handoff),
        promptFilePath: options.promptFile,
        transcriptPath: options.transcript,
        dryRun: options.dryRun
      });

      console.log(`Command: ${[result.command, ...result.args].join(" ")}`);
      console.log(`Handoff: ${result.handoff}`);
      if (result.promptFilePath) {
        console.log(`Prompt file: ${path.relative(process.cwd(), result.promptFilePath)}`);
      }
      if (result.dryRun) {
        console.log("Result: dry run");
      } else {
        console.log(`Exit code: ${result.exitCode ?? "unknown"}`);
      }
      if (result.transcriptPath) {
        console.log(`Transcript: ${path.relative(process.cwd(), result.transcriptPath)}`);
      }
      if (review.missingReferences.length > 0) {
        console.log(`Missing references: ${review.missingReferences.join(", ")}`);
      }
      if (result.stderr.trim()) {
        console.error("");
        console.error(result.stderr.trimEnd());
      }

      if (result.dryRun) {
        if (result.stdout.trim()) {
          console.log("");
          console.log(result.stdout.trimEnd());
        }
        return;
      }

      if (result.exitCode !== 0) {
        if (result.stdout.trim()) {
          console.log("");
          console.log(result.stdout.trimEnd());
        }
        process.exitCode = result.exitCode ?? 1;
        return;
      }

      if (save) {
        const saved = await saveAgentReviewResult(process.cwd(), capabilityId, result.stdout);
        if (options.json) {
          console.log(JSON.stringify(saved, null, 2));
        } else {
          printReviewResult(saved.validation);
          if (saved.validation.valid) {
            console.log(`Saved review evidence to ${path.relative(process.cwd(), saved.filePath)}`);
          }
        }
        process.exitCode = saved.validation.valid ? 0 : 1;
        return;
      }

      const loaded = await loadCapabilities(process.cwd());
      const match = loaded.capabilities.find((item) => item.capability.id === capabilityId);
      if (!match) {
        console.error(`Capability not found: ${capabilityId}`);
        process.exitCode = 1;
        return;
      }

      const validation = await validateAgentReviewResult(process.cwd(), match.capability, result.stdout);
      if (options.json) {
        console.log(JSON.stringify(validation, null, 2));
      } else {
        printReviewResult(validation);
      }
      process.exitCode = validation.valid ? 0 : 1;
    }
  );

program
  .command("status")
  .description("Show a developer-friendly capability health summary")
  .argument("[capability-id]", "optional capability id")
  .option("--json", "print the status report as JSON")
  .option("--story-map", "group status output by story-map release, backbone, and step")
  .option("--release <release>", "limit status output to one story-map release")
  .option("--recommend-order", "include story-map slice ordering and delivery strategy recommendations")
  .option("--show-coverage", "include story-map coverage signals in story-map status output")
  .action(
    async (
      capabilityId: string | undefined,
      options: { json?: boolean; storyMap?: boolean; release?: string; recommendOrder?: boolean; showCoverage?: boolean }
    ) => {
      let report = await summarizeCapabilityStatus(process.cwd(), capabilityId);
      if (options.release) {
        report = filterStatusReportByRelease(report, options.release);
      }
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      if (options.storyMap) {
        console.log(formatStoryMapStatusReport(report, { recommendOrder: options.recommendOrder, showCoverage: options.showCoverage }));
        return;
      }

      console.log(formatCapabilityStatusReport(report));
    }
  );

program
  .command("validate")
  .description("Validate capability files")
  .action(async () => {
    const loaded = await loadCapabilities(process.cwd());
    const result = validateLoadedCapabilities(loaded);
    printValidationReport(result);
    process.exitCode = result.valid ? 0 : 1;
  });

program
  .command("compile")
  .description("Compile capabilities to normalized JSON")
  .action(async () => {
    const { outputPath, compiled } = await writeCompiledCapabilities(process.cwd());
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
    console.log(`Compiled ${compiled.capabilities.length} capabilities with ${compiled.verification_summary.gaps} verification gaps`);
    process.exitCode = compiled.validation.valid ? 0 : 1;
  });

program
  .command("graph")
  .description("Update dependency outputs and generate an SVG capability graph")
  .option("--output <path>", "output SVG path", ".capabilities/dependency-graph.svg")
  .option("--no-update", "skip compile before graph generation")
  .action(async (options: { output: string; update: boolean }) => {
    if (options.update) {
      await writeCompiledCapabilities(process.cwd());
    }
    const loaded = await loadCapabilities(process.cwd());
    const validation = validateLoadedCapabilities(loaded);
    const gapsById = validation.verificationGaps.reduce((map, gap) => {
      if (!gap.capabilityId) return map;
      map.set(gap.capabilityId, (map.get(gap.capabilityId) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
    const svg = graphSvg(loaded, gapsById);
    const outputPath = path.resolve(process.cwd(), options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, svg, "utf8");
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
    console.log(`Generated graph for ${loaded.capabilities.length} capabilities`);
    process.exitCode = validation.valid ? 0 : 1;
  });

program
  .command("graph-viewer")
  .description("Update dependency outputs and generate an HTML capability graph viewer")
  .option("--output <path>", "output HTML viewer path", ".capabilities/dependency-viewer.html")
  .option("--svg-output <path>", "output SVG graph path", ".capabilities/dependency-graph.svg")
  .option("--no-update", "skip compile before graph viewer generation")
  .action(async (options: { output: string; svgOutput: string; update: boolean }) => {
    if (options.update) {
      await writeCompiledCapabilities(process.cwd());
    }
    const loaded = await loadCapabilities(process.cwd());
    const validation = validateLoadedCapabilities(loaded);
    const gapsById = validation.verificationGaps.reduce((map, gap) => {
      if (!gap.capabilityId) return map;
      map.set(gap.capabilityId, (map.get(gap.capabilityId) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
    const svg = graphSvg(loaded, gapsById);
    const html = graphViewerHtml(loaded, gapsById);

    const svgOutputPath = path.resolve(process.cwd(), options.svgOutput);
    await fs.mkdir(path.dirname(svgOutputPath), { recursive: true });
    await fs.writeFile(svgOutputPath, svg, "utf8");

    const outputPath = path.resolve(process.cwd(), options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, html, "utf8");

    console.log(`Wrote ${path.relative(process.cwd(), svgOutputPath)}`);
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
    console.log(`Generated graph viewer for ${loaded.capabilities.length} capabilities`);
    process.exitCode = validation.valid ? 0 : 1;
  });

program
  .command("story-map-viewer")
  .description("Update capability outputs and generate an HTML story-map viewer")
  .option("--output <path>", "output HTML story-map viewer path", ".capabilities/story-map-viewer.html")
  .option("--no-update", "skip compile before story-map viewer generation")
  .action(async (options: { output: string; update: boolean }) => {
    if (options.update) {
      await writeCompiledCapabilities(process.cwd());
    }
    const report = await summarizeCapabilityStatus(process.cwd());
    const html = formatStoryMapViewerHtml(report);
    const outputPath = path.resolve(process.cwd(), options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, html, "utf8");
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
    console.log(`Generated story-map viewer for ${report.capabilities.length} capabilities`);
  });

program
  .command("inspect")
  .description("Inspect a capability and its relationships")
  .argument("<capability-id>", "capability id")
  .action(async (capabilityId: string) => {
    const loaded = await loadCapabilities(process.cwd());
    const match = loaded.capabilities.find((item) => item.capability.id === capabilityId);
    if (!match) {
      console.error(`Capability not found: ${capabilityId}`);
      process.exitCode = 1;
      return;
    }

    const result = validateLoadedCapabilities(loaded);
    const dependents = loaded.capabilities
      .filter((item) => item.capability.agent?.depends_on?.includes(capabilityId))
      .map((item) => item.capability.id);
    const gaps = result.verificationGaps.filter((gap) => gap.capabilityId === capabilityId);

    console.log(`${match.capability.title} (${match.capability.id})`);
    console.log(`Status: ${match.capability.status}`);
    console.log(`Area: ${match.capability.area}`);
    console.log(`Path: .capabilities/${match.relativePath}`);
    console.log("");
    console.log(match.capability.summary);
    console.log("");
    console.log("Dependencies:");
    for (const dependency of match.capability.agent?.depends_on ?? []) {
      console.log(`  - ${dependency}`);
    }
    if ((match.capability.agent?.depends_on ?? []).length === 0) {
      console.log("  - none");
    }
    console.log("Dependents:");
    for (const dependent of dependents) {
      console.log(`  - ${dependent}`);
    }
    if (dependents.length === 0) {
      console.log("  - none");
    }
    console.log("Verification gaps:");
    for (const gap of gaps) {
      console.log(`  - ${gap.message}`);
    }
    if (gaps.length === 0) {
      console.log("  - none");
    }
  });

program
  .command("impact")
  .description("Analyze downstream capability impact")
  .argument("<capability-id>", "capability id")
  .option("--json", "print the impact report as JSON")
  .action(async (capabilityId: string, options: { json?: boolean }) => {
    const report = await analyzeCapabilityImpact(process.cwd(), capabilityId);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(formatCapabilityImpactReport(report));
  });

program
  .command("diff")
  .description("Compare capability changes against a Git base")
  .argument("[capability-id]", "optional capability id")
  .option("--base <ref>", "git ref to compare against", "HEAD")
  .option("--include-review", "include saved agent.review evidence changes")
  .option("--verbose", "print field-level capability diffs")
  .option("--json", "print the diff report as JSON")
  .action(
    async (
      capabilityId: string | undefined,
      options: { base: string; includeReview?: boolean; verbose?: boolean; json?: boolean }
    ) => {
      const report = await diffCapabilities(process.cwd(), {
        base: options.base,
        capabilityId,
        includeReview: options.includeReview
      });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(formatCapabilityDiffReport(report, { verbose: options.verbose }));
    }
  );

program
  .command("assess")
  .description("Assess implementation coverage for a capability")
  .argument("<capability-id>", "capability id")
  .option("--json", "print the coverage report as JSON")
  .action(async (capabilityId: string, options: { json?: boolean }) => {
    const report = await assessImplementationCoverage(process.cwd(), capabilityId);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(formatImplementationCoverageReport(report));
  });

program
  .command("advise")
  .description("Assess capability coverage and recommend next actions")
  .argument("[capability-id]", "optional capability id")
  .option("--json", "print the advisory report as JSON")
  .action(async (capabilityId: string | undefined, options: { json?: boolean }) => {
    const report = await adviseImplementationCoverage(process.cwd(), capabilityId);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(formatAssessmentAdviceReport(report));
  });

program
  .command("review-noisy")
  .description("List high-value capabilities for Codex or human semantic review")
  .option("--limit <count>", "maximum candidates to list", "5")
  .option("--command <command>", "agent executable to show in suggested review commands", "codex")
  .option("--json", "print candidates as JSON")
  .action(async (options: { limit: string; command: string; json?: boolean }) => {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Invalid limit "${options.limit}". Expected a positive integer.`);
    }

    const report = await adviseImplementationCoverage(process.cwd());
    const candidates = noisyCandidates(report, limit);
    if (options.json) {
      console.log(JSON.stringify(candidates, null, 2));
      return;
    }

    console.log(formatReviewNoisy(report, limit, options.command));
  });

program
  .command("agent-task")
  .description("Generate a prompt bundle for an external coding agent")
  .argument("<capability-id>", "capability id")
  .option("--mode <mode>", "task mode: implement or review", "implement")
  .option("--no-references", "omit implementation reference file contents")
  .option("--output <path>", "write the prompt bundle to a file instead of stdout")
  .action(
    async (
      capabilityId: string,
      options: { mode: string; references: boolean; output?: string }
    ) => {
      const bundle = await buildAgentTaskBundle(process.cwd(), capabilityId, {
        mode: parseAgentTaskMode(options.mode),
        includeReferences: options.references
      });

      if (options.output) {
        const outputPath = path.resolve(process.cwd(), options.output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, bundle.prompt);
        console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
        if (bundle.missingReferences.length > 0) {
          console.log(`Missing references: ${bundle.missingReferences.join(", ")}`);
        }
        return;
      }

      console.log(bundle.prompt);
      if (bundle.missingReferences.length > 0) {
        console.error(`Missing references: ${bundle.missingReferences.join(", ")}`);
      }
    }
  );

program
  .command("agent-run")
  .description("Run an external coding-agent command with a generated capability task bundle")
  .argument("<capability-id>", "capability id")
  .requiredOption("--command <command>", "external agent executable to run")
  .option("--arg <value>", "argument to pass to the external agent command; repeat for multiple args", collectOption, [])
  .option("--mode <mode>", "task mode: implement or review", "implement")
  .option("--handoff <strategy>", "bundle handoff strategy: stdin, argument, or prompt-file", "stdin")
  .option("--prompt-file <path>", "prompt file path for prompt-file handoff")
  .option("--transcript <path>", "write stdout, stderr, exit code, and handoff details to a transcript file")
  .option("--no-references", "omit implementation reference file contents")
  .option("--dry-run", "detect the command and prepare handoff files without running the external agent")
  .action(
    async (
      capabilityId: string,
      options: {
        command: string;
        arg: string[];
        mode: string;
        handoff: string;
        promptFile?: string;
        transcript?: string;
        references: boolean;
        dryRun?: boolean;
      }
    ) => {
      const bundle = await buildAgentTaskBundle(process.cwd(), capabilityId, {
        mode: parseAgentTaskMode(options.mode),
        includeReferences: options.references
      });

      const result = await runExternalAgentCommand({
        command: options.command,
        args: options.arg,
        cwd: process.cwd(),
        input: bundle.prompt,
        handoff: parseAgentHandoff(options.handoff),
        promptFilePath: options.promptFile,
        transcriptPath: options.transcript,
        dryRun: options.dryRun
      });

      console.log(`Command: ${[result.command, ...result.args].join(" ")}`);
      console.log(`Handoff: ${result.handoff}`);
      if (result.promptFilePath) {
        console.log(`Prompt file: ${path.relative(process.cwd(), result.promptFilePath)}`);
      }
      if (result.dryRun) {
        console.log("Result: dry run");
      } else {
        console.log(`Exit code: ${result.exitCode ?? "unknown"}`);
      }
      if (result.transcriptPath) {
        console.log(`Transcript: ${path.relative(process.cwd(), result.transcriptPath)}`);
      }
      if (result.stdout.trim()) {
        console.log("");
        console.log(result.stdout.trimEnd());
      }
      if (result.stderr.trim()) {
        console.error("");
        console.error(result.stderr.trimEnd());
      }

      if (!result.dryRun && result.exitCode !== 0) {
        process.exitCode = result.exitCode ?? 1;
      }
    }
  );

program
  .command("review")
  .description("Review capability implementation evidence and save agent.review by default")
  .argument("[capability-id]", "optional capability id; required when using --agent")
  .option("--agent <command>", "external coding agent executable to run instead of deterministic review")
  .option("--arg <value>", "argument to pass to the external agent command; repeat for multiple args", collectOption, [])
  .option("--handoff <strategy>", "agent handoff strategy: stdin, argument, or prompt-file", "stdin")
  .option("--prompt-file <path>", "prompt file path for prompt-file handoff")
  .option("--transcript <path>", "write stdout, stderr, exit code, and handoff details to a transcript file")
  .option("--output-prompt <path>", "write the generated agent review prompt to a file")
  .option("--no-references", "omit implementation reference file contents from the agent prompt")
  .option("--deterministic-only", "use deterministic implementation evidence even when --agent is configured")
  .option("--no-save", "print or validate review output without writing agent.review")
  .option("--dry-run", "prepare review output without running an agent or writing files")
  .option("--json", "print the review result as JSON")
  .action(
    async (
      capabilityId: string | undefined,
      options: {
        agent?: string;
        arg: string[];
        handoff: string;
        promptFile?: string;
        transcript?: string;
        outputPrompt?: string;
        references: boolean;
        deterministicOnly?: boolean;
        save: boolean;
        dryRun?: boolean;
        json?: boolean;
      }
    ) => {
      const save = options.save !== false && !options.dryRun;
      const useAgent = Boolean(options.agent) && !options.deterministicOnly;

      if (!useAgent) {
        const result = await syncReviewEvidence(process.cwd(), capabilityId, { dryRun: !save });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatSyncReviewEvidenceReport(result));
        }
        return;
      }

      if (!capabilityId) {
        console.error("Capability id is required when using --agent.");
        process.exitCode = 1;
        return;
      }

      const review = await buildAgentReviewPrompt(process.cwd(), capabilityId, {
        includeReferences: options.references
      });

      if (options.outputPrompt) {
        const outputPath = path.resolve(process.cwd(), options.outputPrompt);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, review.prompt);
        console.log(`Review prompt: ${path.relative(process.cwd(), outputPath)}`);
      }

      const result = await runExternalAgentCommand({
        command: options.agent!,
        args: options.arg,
        cwd: process.cwd(),
        input: review.prompt,
        handoff: parseAgentHandoff(options.handoff),
        promptFilePath: options.promptFile,
        transcriptPath: options.transcript,
        dryRun: options.dryRun
      });

      console.log(`Command: ${[result.command, ...result.args].join(" ")}`);
      console.log(`Handoff: ${result.handoff}`);
      if (result.promptFilePath) {
        console.log(`Prompt file: ${path.relative(process.cwd(), result.promptFilePath)}`);
      }
      if (result.dryRun) {
        console.log("Result: dry run");
      } else {
        console.log(`Exit code: ${result.exitCode ?? "unknown"}`);
      }
      if (result.transcriptPath) {
        console.log(`Transcript: ${path.relative(process.cwd(), result.transcriptPath)}`);
      }
      if (review.missingReferences.length > 0) {
        console.log(`Missing references: ${review.missingReferences.join(", ")}`);
      }
      if (result.stderr.trim()) {
        console.error("");
        console.error(result.stderr.trimEnd());
      }

      if (result.dryRun) {
        if (result.stdout.trim()) {
          console.log("");
          console.log(result.stdout.trimEnd());
        }
        return;
      }

      if (result.exitCode !== 0) {
        if (result.stdout.trim()) {
          console.log("");
          console.log(result.stdout.trimEnd());
        }
        process.exitCode = result.exitCode ?? 1;
        return;
      }

      if (save) {
        const saved = await saveAgentReviewResult(process.cwd(), capabilityId, result.stdout);
        if (options.json) {
          console.log(JSON.stringify(saved, null, 2));
        } else {
          printReviewResult(saved.validation);
          if (saved.validation.valid) {
            console.log(`Saved review evidence to ${path.relative(process.cwd(), saved.filePath)}`);
          }
        }
        process.exitCode = saved.validation.valid ? 0 : 1;
        return;
      }

      const loaded = await loadCapabilities(process.cwd());
      const match = loaded.capabilities.find((item) => item.capability.id === capabilityId);
      if (!match) {
        console.error(`Capability not found: ${capabilityId}`);
        process.exitCode = 1;
        return;
      }

      const validation = await validateAgentReviewResult(process.cwd(), match.capability, result.stdout);
      if (options.json) {
        console.log(JSON.stringify(validation, null, 2));
      } else {
        printReviewResult(validation);
      }
      process.exitCode = validation.valid ? 0 : 1;
    }
  );

program
  .command("agent-review")
  .description("Ask an external agent to review a capability against implementation evidence")
  .argument("<capability-id>", "capability id")
  .requiredOption("--command <command>", "external agent executable to run")
  .option("--arg <value>", "argument to pass to the external agent command; repeat for multiple args", collectOption, [])
  .option("--handoff <strategy>", "bundle handoff strategy: stdin, argument, or prompt-file", "stdin")
  .option("--prompt-file <path>", "prompt file path for prompt-file handoff")
  .option("--transcript <path>", "write stdout, stderr, exit code, and handoff details to a transcript file")
  .option("--output-prompt <path>", "write the generated review prompt to a file")
  .option("--no-references", "omit implementation reference file contents")
  .option("--dry-run", "detect the command and prepare handoff files without running the external agent")
  .action(
    async (
      capabilityId: string,
      options: {
        command: string;
        arg: string[];
        handoff: string;
        promptFile?: string;
        transcript?: string;
        outputPrompt?: string;
        references: boolean;
        dryRun?: boolean;
      }
    ) => {
      const review = await buildAgentReviewPrompt(process.cwd(), capabilityId, {
        includeReferences: options.references
      });

      if (options.outputPrompt) {
        const outputPath = path.resolve(process.cwd(), options.outputPrompt);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, review.prompt);
        console.log(`Review prompt: ${path.relative(process.cwd(), outputPath)}`);
      }

      const result = await runExternalAgentCommand({
        command: options.command,
        args: options.arg,
        cwd: process.cwd(),
        input: review.prompt,
        handoff: parseAgentHandoff(options.handoff),
        promptFilePath: options.promptFile,
        transcriptPath: options.transcript,
        dryRun: options.dryRun
      });

      console.log(`Command: ${[result.command, ...result.args].join(" ")}`);
      console.log(`Handoff: ${result.handoff}`);
      if (result.promptFilePath) {
        console.log(`Prompt file: ${path.relative(process.cwd(), result.promptFilePath)}`);
      }
      if (result.dryRun) {
        console.log("Result: dry run");
      } else {
        console.log(`Exit code: ${result.exitCode ?? "unknown"}`);
      }
      if (result.transcriptPath) {
        console.log(`Transcript: ${path.relative(process.cwd(), result.transcriptPath)}`);
      }
      if (review.missingReferences.length > 0) {
        console.log(`Missing references: ${review.missingReferences.join(", ")}`);
      }
      if (result.stdout.trim()) {
        console.log("");
        console.log(result.stdout.trimEnd());
      }
      if (result.stderr.trim()) {
        console.error("");
        console.error(result.stderr.trimEnd());
      }

      if (!result.dryRun && result.exitCode !== 0) {
        process.exitCode = result.exitCode ?? 1;
      }
    }
  );

program
  .command("review-result")
  .description("Save or validate structured agent review output for a capability")
  .argument("<capability-id>", "capability id")
  .requiredOption("--input <path>", "path to the agent review JSON output")
  .option("--save", "deprecated; valid review output is saved by default")
  .option("--no-save", "validate review output without writing agent.review")
  .option("--json", "print validation result as JSON")
  .action(async (capabilityId: string, options: { input: string; save?: boolean; json?: boolean }) => {
    const inputPath = path.resolve(process.cwd(), options.input);
    const source = await fs.readFile(inputPath, "utf8");

    if (options.save !== false) {
      const result = await saveAgentReviewResult(process.cwd(), capabilityId, source);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printReviewResult(result.validation);
        if (result.validation.valid) {
          console.log(`Saved review evidence to ${path.relative(process.cwd(), result.filePath)}`);
        }
      }
      process.exitCode = result.validation.valid ? 0 : 1;
      return;
    }

    const loaded = await loadCapabilities(process.cwd());
    const match = loaded.capabilities.find((item) => item.capability.id === capabilityId);
    if (!match) {
      console.error(`Capability not found: ${capabilityId}`);
      process.exitCode = 1;
      return;
    }

    const validation = await validateAgentReviewResult(process.cwd(), match.capability, source);
    if (options.json) {
      console.log(JSON.stringify(validation, null, 2));
    } else {
      printReviewResult(validation);
    }
    process.exitCode = validation.valid ? 0 : 1;
  });

program
  .command("sync-review")
  .description("Update agent.review from current implementation evidence without changing capability status")
  .argument("[capability-id]", "optional capability id")
  .option("--dry-run", "show what would be updated without writing files")
  .option("--json", "print the sync result as JSON")
  .action(async (capabilityId: string | undefined, options: { dryRun?: boolean; json?: boolean }) => {
    const result = await syncReviewEvidence(process.cwd(), capabilityId, { dryRun: options.dryRun });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatSyncReviewEvidenceReport(result));
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
