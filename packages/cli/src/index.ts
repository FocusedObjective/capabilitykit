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
  formatSyncReviewEvidenceReport
  ,
  formatCapabilities
} from "@capabilitykit/core";
import { installCapabilityKitSkill } from "./skillInstall.js";

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
      `  Review command: capabilitykit agent-review ${candidate.capabilityId} --command ${command} --handoff stdin`
    );
  }

  return `${lines.join("\n")}\n`;
}

function graphSvg(loaded: Awaited<ReturnType<typeof loadCapabilities>>, gapsById: Map<string, number>): string {
  const nodes = loaded.capabilities.map((item) => item.capability);
  const dependentsById = new Map<string, string[]>();
  for (const node of nodes) dependentsById.set(node.id, []);
  for (const node of nodes) {
    for (const dep of node.agent?.depends_on ?? []) {
      dependentsById.set(dep, [...(dependentsById.get(dep) ?? []), node.id]);
    }
  }

  const width = 1440;
  const height = 980;
  const areas = [...new Set(nodes.map((node) => node.area))].sort();
  const sorted = [...nodes].sort(
    (a, b) => (dependentsById.get(b.id)?.length ?? 0) - (dependentsById.get(a.id)?.length ?? 0) || a.id.localeCompare(b.id)
  );
  const graphNodes = sorted.map((node, i) => {
    const gaps = gapsById.get(node.id) ?? 0;
    const impact = dependentsById.get(node.id)?.length ?? 0;
    const areaIndex = Math.max(areas.indexOf(node.area), 0);
    const columnCount = Math.max(areas.length, 1);
    const row = Math.floor(i / columnCount);
    return {
      id: node.id,
      title: node.title,
      label: node.title.length > 28 ? `${node.title.slice(0, 26)}...` : node.title,
      area: node.area,
      status: node.status,
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
  const graphData = JSON.stringify({ nodes: graphNodes, links: graphLinks }).replaceAll("</", "<\\/");

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
  meta.textContent = node.area;
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
    node.vx += (width / 2 - node.x) * 0.0009 * alpha;
    node.vy += (height / 2 + 18 - node.y) * 0.0009 * alpha;
  }
  for (const link of links) {
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
attachSlider(zoomKnob, 0.72, 1.38, zoomLevel, (value) => {
  zoomLevel = value;
  applyZoom();
});
attachSlider(forceKnob, 0.9, 1.7, forceScale, (value) => {
  forceScale = value;
  applyForceControl();
  restartSimulation(0.85);
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
  detailStatus.textContent = node.id + " | " + node.status + " | " + node.area;
  detailImpact.textContent = "Direct dependents: " + node.impact + " | verification gaps: " + node.gaps;
  for (const item of nodeEls) {
    const connected = item.node.id === node.id || linked.has(item.node.id + "->" + node.id);
    item.el.classList.toggle("dimmed", !connected);
  }
  for (const link of linkEls) {
    const active = link.source.id === node.id || link.target.id === node.id;
    link.el.classList.toggle("active", active);
    link.el.classList.toggle("dimmed", !active);
  }
}
function clearHighlight() {
  details.setAttribute("opacity", "0");
  for (const item of nodeEls) item.el.classList.remove("dimmed");
  for (const link of linkEls) link.el.classList.remove("active", "dimmed");
}
restartSimulation(1);
  ]]></script>
</svg>\n`;
}

program
  .name("capabilitykit")
  .description("Capabilities as code for AI-native software teams")
  .version("0.1.0");

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
  .command("status")
  .description("Show a developer-friendly capability health summary")
  .argument("[capability-id]", "optional capability id")
  .option("--json", "print the status report as JSON")
  .action(async (capabilityId: string | undefined, options: { json?: boolean }) => {
    const report = await summarizeCapabilityStatus(process.cwd(), capabilityId);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(formatCapabilityStatusReport(report));
  });

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
  .option("--command <command>", "agent-review executable to show in suggested commands", "codex")
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
  .description("Validate or save structured agent review output for a capability")
  .argument("<capability-id>", "capability id")
  .requiredOption("--input <path>", "path to the agent review JSON output")
  .option("--save", "save valid review output to the capability agent.review field")
  .option("--json", "print validation result as JSON")
  .action(async (capabilityId: string, options: { input: string; save?: boolean; json?: boolean }) => {
    const inputPath = path.resolve(process.cwd(), options.input);
    const source = await fs.readFile(inputPath, "utf8");

    if (options.save) {
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
