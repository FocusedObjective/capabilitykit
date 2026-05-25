import { promises as fs } from "node:fs";
import YAML from "yaml";
import { loadCapabilities } from "./loadCapabilities.js";
import { agentMetadataCommentLines } from "./agentMetadataComments.js";
import { setAgentSectionComment } from "./agentSectionComment.js";
import type { Capability } from "./types.js";

export interface FormatCapabilitiesResult {
  checked: number;
  changed: number;
  files: string[];
}

function canonicalCapability(
  capability: Capability,
  options: { includeId?: boolean; includeArea?: boolean }
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    title: capability.title,
    status: capability.status,
    summary: capability.summary,
    intent: capability.intent,
    acceptance: capability.acceptance
  };
  if (options.includeId) {
    result.id = capability.id;
  }
  if (options.includeArea) {
    result.area = capability.area;
  }

  if (capability.guidance && capability.guidance.length > 0) {
    result.guidance = capability.guidance;
  }
  if (capability.planning) {
    result.planning = pruneEmpty(capability.planning);
  }
  if (capability.agent) {
    result.agent = pruneEmpty(capability.agent);
  }
  if (capability.replacement) {
    result.replacement = capability.replacement;
  }

  return result;
}

function pruneEmpty(value: unknown): unknown {
  if (Array.isArray(value)) {
    const pruned = value.map(pruneEmpty).filter((entry) => entry !== undefined);
    return pruned.length > 0 ? pruned : undefined;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, pruneEmpty(entry)] as const)
      .filter(([, entry]) => entry !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  return value;
}

export async function formatCapabilities(rootDir: string, options: { write?: boolean } = {}): Promise<FormatCapabilitiesResult> {
  const loaded = await loadCapabilities(rootDir);
  if (loaded.errors.length > 0) {
    throw new Error(`Cannot format capabilities until validation errors are fixed (${loaded.errors.length} issue(s)).`);
  }

  let changed = 0;
  const files: string[] = [];

  for (const entry of loaded.capabilities) {
    const source = await fs.readFile(entry.filePath, "utf8");
    const includeId = Boolean(entry.hasExplicitId && entry.capability.id !== entry.derivedId);
    const includeArea = Boolean(entry.hasExplicitArea && entry.capability.area !== entry.derivedArea);
    const document = YAML.parseDocument(YAML.stringify(canonicalCapability(entry.capability, { includeId, includeArea })));
    if (entry.capability.agent) {
      setAgentSectionComment(document, agentMetadataCommentLines(entry.capability.id));
    }
    const formatted = document.toString();
    if (formatted !== source) {
      changed += 1;
      files.push(entry.filePath);
      if (options.write) {
        await fs.writeFile(entry.filePath, formatted);
      }
    }
  }

  return {
    checked: loaded.capabilities.length,
    changed,
    files
  };
}
