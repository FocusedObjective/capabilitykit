import { promises as fs } from "node:fs";
import path from "node:path";
import { loadCapabilities } from "./loadCapabilities.js";
import type { LoadCapabilitiesResult } from "./types.js";

const defaultDiscoveryGoals = [
  "Identify the main user-visible workflows and project functionality.",
  "Propose a navigable first-pass capability map backed by concrete source evidence.",
  "Call out uncertainty and missing verification instead of presenting inferred behavior as fact."
];

export interface DiscoveryAgentTaskOptions {
  goals?: string[];
}

export interface DiscoveryAgentTaskBundle {
  prompt: string;
  goals: string[];
  inventory: string[];
  capabilityIds: string[];
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}`;
}

function bulletList(items: string[], empty = "None."): string {
  if (items.length === 0) {
    return empty;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function numberedList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

async function projectInventory(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .sort((a, b) => a.localeCompare(b));
}

function existingCapabilityMap(loaded: LoadCapabilitiesResult): string {
  if (loaded.capabilities.length === 0) {
    return "None.";
  }

  return loaded.capabilities
    .map(({ capability }) => `- ${capability.id} [${capability.status}]: ${capability.summary}`)
    .join("\n");
}

function projectContext(loaded: LoadCapabilitiesResult): string {
  const include = loaded.config.source?.include ?? [];
  const exclude = loaded.config.source?.exclude ?? [];
  return [
    `Project: ${loaded.config.project.name}`,
    `Workspace root: ${loaded.rootDir}`,
    `Capability source include patterns: ${include.length > 0 ? include.join(", ") : "None configured."}`,
    `Capability source exclude patterns: ${exclude.length > 0 ? exclude.join(", ") : "None configured."}`
  ].join("\n");
}

export async function buildDiscoveryAgentTaskBundle(
  rootDir = process.cwd(),
  options: DiscoveryAgentTaskOptions = {}
): Promise<DiscoveryAgentTaskBundle> {
  const loaded = await loadCapabilities(rootDir);
  const goals = options.goals && options.goals.length > 0 ? options.goals : defaultDiscoveryGoals;
  const inventory = await projectInventory(loaded.rootDir);
  const capabilityIds = loaded.capabilities.map(({ capability }) => capability.id);
  const instructions = [
    "Perform read-only discovery of this project's implemented behavior.",
    "Inspect implementation code directly across the main entrypoints, user workflows, UI components and UI flow code, APIs, routes and handlers, data models and persistence code, tests, scripts, and configuration.",
    "Use README files, documentation, package metadata, and filenames only as supporting context. Confirm behavior in implementation code before proposing it.",
    "Propose capabilities for the main project functionality, not every implementation detail.",
    "Do not create, overwrite, move, or edit capability files during discovery.",
    "Do not change source files during discovery.",
    "Return the structured discovery report below. This phase proposes candidates only; a later explicit generation step decides whether to write capability files."
  ];
  const outputContract = [
    "Return JSON only, using this structure:",
    '{ "inspection_summary": { "inspected_areas": ["..."], "inspected_paths": ["..."], "uninspected_areas": ["..."] }, "candidates": [{ "title": "...", "likely_area": "...", "summary": "...", "inferred_intent": "...", "acceptance_criteria": ["..."], "implementation_references": ["path/to/file.ts:line"], "verification_gaps": ["..."], "likely_relationships": ["..."], "inspected_code_paths": ["path/to/file.ts"], "confidence": "high|medium|low", "confidence_notes": ["..."] }], "retained_proposals": [{ "title": "...", "likely_area": "...", "summary": "...", "inferred_intent": "...", "acceptance_criteria": ["..."], "verification_gaps": ["..."], "likely_relationships": ["..."], "confidence": "high|medium|low", "confidence_notes": ["..."], "retention_reason": "..." }], "quarantined_candidates": [{ "title": "...", "likely_area": "...", "reason": "...", "source_evidence": ["..."], "confidence_notes": ["..."] }], "discovery_gaps": ["..."], "confidence_notes": ["..."] }',
    "",
    "Every proposed candidate must cite concrete source evidence through `agent.implementation.references`.",
    "Include verification gaps whenever behavior is inferred or not covered by tests.",
    "Quarantine plausible candidates that lack enough code evidence instead of presenting them as supported candidates.",
    "Use `retained_proposals` only for absent behavior the user explicitly wants to preserve as a planned draft.",
    "Status policy for later generation: code-backed `candidates` become `implemented`, explicitly retained absent behavior becomes `planned`, and discovery output never claims `verified`.",
    "Record shallow inspection, missing code evidence, untested inferred behavior, runtime-only behavior, external services, and other uncertainty in `discovery_gaps`.",
    "Do not use documentation-only evidence as sufficient support for a candidate."
  ].join("\n");

  const prompt = [
    "# CapabilityKit Project Discovery Task",
    "",
    "Mode: discovery",
    "",
    section("Instructions", numberedList(instructions)),
    section("Discovery Goals", bulletList(goals)),
    section("Project Context", projectContext(loaded)),
    section("Project Inventory", bulletList(inventory)),
    section("Existing Capability Map", existingCapabilityMap(loaded)),
    section("Output Contract", outputContract)
  ].join("\n\n");

  return {
    prompt,
    goals,
    inventory,
    capabilityIds
  };
}
