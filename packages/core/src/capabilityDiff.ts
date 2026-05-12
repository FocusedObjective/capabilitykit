import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadCapabilities } from "./loadCapabilities.js";
import { parseCapability } from "./parseCapability.js";
import { buildCapabilityImpactGraph } from "./capabilityImpact.js";
import type { Capability, LoadCapabilitiesResult } from "./types.js";

const execFileAsync = promisify(execFile);

export type CapabilityDiffKind = "added" | "changed" | "removed";

export interface CapabilityFieldDiff {
  field: string;
  added: string[];
  removed: string[];
  changed: boolean;
}

export interface CapabilityDiffEntry {
  capabilityId: string;
  kind: CapabilityDiffKind;
  title: string;
  status?: Capability["status"];
  previousStatus?: Capability["status"];
  path?: string;
  previousPath?: string;
  summary?: string;
  fieldDiffs: CapabilityFieldDiff[];
  directDependents: string[];
  transitiveDependents: string[];
}

export interface CapabilityDiffReport {
  base: string;
  project: string;
  entries: CapabilityDiffEntry[];
  summary: {
    added: number;
    changed: number;
    removed: number;
  };
}

export interface CapabilityDiffFormatOptions {
  verbose?: boolean;
}

interface CapabilitySnapshot {
  capability: Capability;
  relativePath: string;
}

interface Snapshot {
  capabilities: CapabilitySnapshot[];
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

async function git(rootDir: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: rootDir, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return result.stdout;
}

function normalizeGitPath(value: string): string {
  return value.replace(/\\/g, "/");
}

async function loadBaseSnapshot(rootDir: string, base: string): Promise<Snapshot> {
  const files = (await git(rootDir, ["ls-tree", "-r", "--name-only", base, "--", ".capabilities"]))
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter((file) => file.endsWith(".capability.yaml") && !file.includes("/dist/"))
    .sort((a, b) => a.localeCompare(b));

  const capabilities: CapabilitySnapshot[] = [];
  for (const file of files) {
    const source = await git(rootDir, ["show", `${base}:${file}`]);
    const parsed = parseCapability(source, file);
    if (parsed.capability) {
      capabilities.push({
        capability: parsed.capability,
        relativePath: normalizeGitPath(file.replace(/^\.capabilities\//, ""))
      });
    }
  }

  return { capabilities };
}

function currentSnapshot(loaded: LoadCapabilitiesResult): Snapshot {
  return {
    capabilities: loaded.capabilities.map((item) => ({
      capability: item.capability,
      relativePath: item.relativePath
    }))
  };
}

function comparableCapability(capability: Capability, includeReview: boolean): unknown {
  if (includeReview || !capability.agent?.review) {
    return capability;
  }

  const review = capability.agent.review.ignore_findings
    ? { ignore_findings: capability.agent.review.ignore_findings }
    : undefined;

  return {
    ...capability,
    agent: {
      ...capability.agent,
      review
    }
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stringValues(values: unknown[] | undefined): string[] {
  return (values ?? []).map((value) => (typeof value === "string" ? value : stableStringify(value)));
}

function diffArray(field: string, before: unknown[] | undefined, after: unknown[] | undefined): CapabilityFieldDiff | undefined {
  const beforeValues = stringValues(before);
  const afterValues = stringValues(after);
  const added = afterValues.filter((value) => !beforeValues.includes(value));
  const removed = beforeValues.filter((value) => !afterValues.includes(value));
  if (added.length === 0 && removed.length === 0) {
    return undefined;
  }
  return { field, added, removed, changed: false };
}

function diffScalar(field: string, before: unknown, after: unknown): CapabilityFieldDiff | undefined {
  if (stableStringify(before) === stableStringify(after)) {
    return undefined;
  }
  return {
    field,
    added: after === undefined ? [] : [typeof after === "string" ? after : stableStringify(after)],
    removed: before === undefined ? [] : [typeof before === "string" ? before : stableStringify(before)],
    changed: true
  };
}

function capabilityFieldDiffs(before: Capability, after: Capability, includeReview: boolean): CapabilityFieldDiff[] {
  const beforeReview = includeReview ? before.agent?.review : { ignore_findings: before.agent?.review?.ignore_findings };
  const afterReview = includeReview ? after.agent?.review : { ignore_findings: after.agent?.review?.ignore_findings };
  return [
    diffScalar("status", before.status, after.status),
    diffScalar("summary", before.summary, after.summary),
    diffScalar("intent", before.intent, after.intent),
    diffArray("acceptance", before.acceptance, after.acceptance),
    diffArray("dependencies", before.agent?.depends_on, after.agent?.depends_on),
    diffArray("implementation.references", before.agent?.implementation?.references, after.agent?.implementation?.references),
    diffArray("verification.automated", before.agent?.verification?.automated, after.agent?.verification?.automated),
    diffArray("verification.manual", before.agent?.verification?.manual, after.agent?.verification?.manual),
    diffArray("verification.gaps", before.agent?.verification?.gaps, after.agent?.verification?.gaps),
    diffArray("verification.ignore_gaps", before.agent?.verification?.ignore_gaps, after.agent?.verification?.ignore_gaps),
    diffScalar("review", beforeReview, afterReview)
  ].filter((diff): diff is CapabilityFieldDiff => diff !== undefined);
}

function snapshotToLoaded(rootDir: string, snapshot: Snapshot, project: string): LoadCapabilitiesResult {
  return {
    rootDir,
    capabilitiesDir: `${rootDir}/.capabilities`,
    config: {
      schema_version: "0.1",
      project: { name: project }
    },
    capabilities: snapshot.capabilities.map((item) => ({
      capability: item.capability,
      relativePath: item.relativePath,
      filePath: `${rootDir}/.capabilities/${item.relativePath}`
    })),
    errors: []
  };
}

export async function diffCapabilities(
  rootDir = process.cwd(),
  options: { base?: string; capabilityId?: string; includeReview?: boolean } = {}
): Promise<CapabilityDiffReport> {
  const base = options.base ?? "HEAD";
  const includeReview = Boolean(options.includeReview);
  const loaded = await loadCapabilities(rootDir);
  const current = currentSnapshot(loaded);
  const previous = await loadBaseSnapshot(rootDir, base);
  const currentById = new Map(current.capabilities.map((item) => [item.capability.id, item]));
  const previousById = new Map(previous.capabilities.map((item) => [item.capability.id, item]));
  const allIds = uniqueSorted([...currentById.keys(), ...previousById.keys()]).filter(
    (id) => options.capabilityId === undefined || id === options.capabilityId
  );
  const graph = buildCapabilityImpactGraph(snapshotToLoaded(rootDir, current, loaded.config.project.name));
  const entries: CapabilityDiffEntry[] = [];

  for (const id of allIds) {
    const before = previousById.get(id);
    const after = currentById.get(id);

    if (!before && after) {
      entries.push({
        capabilityId: id,
        kind: "added",
        title: after.capability.title,
        status: after.capability.status,
        path: `.capabilities/${after.relativePath}`,
        summary: after.capability.summary,
        fieldDiffs: [],
        directDependents: graph.dependents[id] ?? [],
        transitiveDependents: graph.transitive_dependents[id] ?? []
      });
      continue;
    }

    if (before && !after) {
      entries.push({
        capabilityId: id,
        kind: "removed",
        title: before.capability.title,
        previousStatus: before.capability.status,
        previousPath: `.capabilities/${before.relativePath}`,
        summary: before.capability.summary,
        fieldDiffs: [],
        directDependents: graph.dependents[id] ?? [],
        transitiveDependents: graph.transitive_dependents[id] ?? []
      });
      continue;
    }

    if (!before || !after) {
      continue;
    }

    const beforeComparable = comparableCapability(before.capability, includeReview);
    const afterComparable = comparableCapability(after.capability, includeReview);
    if (stableStringify(beforeComparable) === stableStringify(afterComparable) && before.relativePath === after.relativePath) {
      continue;
    }

    const fieldDiffs = capabilityFieldDiffs(before.capability, after.capability, includeReview);
    if (before.relativePath !== after.relativePath) {
      fieldDiffs.push({
        field: "path",
        added: [`.capabilities/${after.relativePath}`],
        removed: [`.capabilities/${before.relativePath}`],
        changed: true
      });
    }

    entries.push({
      capabilityId: id,
      kind: "changed",
      title: after.capability.title,
      status: after.capability.status,
      previousStatus: before.capability.status,
      path: `.capabilities/${after.relativePath}`,
      previousPath: `.capabilities/${before.relativePath}`,
      summary: after.capability.summary,
      fieldDiffs,
      directDependents: graph.dependents[id] ?? [],
      transitiveDependents: graph.transitive_dependents[id] ?? []
    });
  }

  return {
    base,
    project: loaded.config.project.name,
    entries,
    summary: {
      added: entries.filter((entry) => entry.kind === "added").length,
      changed: entries.filter((entry) => entry.kind === "changed").length,
      removed: entries.filter((entry) => entry.kind === "removed").length
    }
  };
}

function formatFieldDiff(diff: CapabilityFieldDiff): string[] {
  const lines = [`    ${diff.field}`];
  for (const value of diff.added.slice(0, 5)) {
    lines.push(`      + ${value}`);
  }
  for (const value of diff.removed.slice(0, 5)) {
    lines.push(`      - ${value}`);
  }
  if (diff.added.length + diff.removed.length > 10) {
    lines.push("      ...");
  }
  return lines;
}

function countFor(entry: CapabilityDiffEntry, field: string): { added: number; removed: number } {
  const diff = entry.fieldDiffs.find((item) => item.field === field);
  return {
    added: diff?.added.length ?? 0,
    removed: diff?.removed.length ?? 0
  };
}

function changedField(entry: CapabilityDiffEntry, field: string): boolean {
  return entry.fieldDiffs.some((diff) => diff.field === field);
}

function impactSummary(entry: CapabilityDiffEntry): string {
  const parts = [];
  if (entry.directDependents.length > 0) {
    parts.push(`${entry.directDependents.length} direct`);
  }
  if (entry.transitiveDependents.length > entry.directDependents.length) {
    parts.push(`${entry.transitiveDependents.length} transitive`);
  }
  return parts.length > 0 ? parts.join(", ") : "none";
}

function compactSignals(entry: CapabilityDiffEntry): string[] {
  if (entry.kind !== "changed") {
    return [];
  }

  const signals: string[] = [];
  if (changedField(entry, "status")) {
    signals.push("status changed");
  }
  if (changedField(entry, "summary") || changedField(entry, "intent")) {
    signals.push("intent changed");
  }
  const acceptance = countFor(entry, "acceptance");
  if (acceptance.added > 0 || acceptance.removed > 0) {
    signals.push(`acceptance +${acceptance.added}/-${acceptance.removed}`);
  }
  const references = countFor(entry, "implementation.references");
  if (references.added > 0 || references.removed > 0) {
    signals.push(`refs +${references.added}/-${references.removed}`);
  }
  const automated = countFor(entry, "verification.automated");
  const manual = countFor(entry, "verification.manual");
  if (automated.added > 0 || automated.removed > 0 || manual.added > 0 || manual.removed > 0) {
    signals.push(`verification +${automated.added + manual.added}/-${automated.removed + manual.removed}`);
  }
  const gaps = countFor(entry, "verification.gaps");
  const ignoredGaps = countFor(entry, "verification.ignore_gaps");
  if (gaps.added > 0 || gaps.removed > 0 || ignoredGaps.added > 0 || ignoredGaps.removed > 0) {
    signals.push(`verification policy +${gaps.added + ignoredGaps.added}/-${gaps.removed + ignoredGaps.removed}`);
  }
  if (changedField(entry, "review")) {
    signals.push("review policy changed");
  }
  if (changedField(entry, "path")) {
    signals.push("path changed");
  }
  return signals;
}

function parseStableObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function displayValue(field: string, value: string): string {
  const parsed = parseStableObject(value);
  if (field === "verification.automated" && parsed && typeof parsed === "object") {
    const check = parsed as { id?: unknown; command?: unknown; description?: unknown };
    const name = typeof check.id === "string" ? check.id : typeof check.description === "string" ? check.description : "check";
    const command = typeof check.command === "string" ? `: ${check.command}` : "";
    return `${name}${command}`;
  }
  if (field === "verification.ignore_gaps" && parsed && typeof parsed === "object") {
    const ignore = parsed as { code?: unknown; message_contains?: unknown; reason?: unknown };
    const code = typeof ignore.code === "string" ? ignore.code : "*";
    const message = typeof ignore.message_contains === "string" ? ` (${ignore.message_contains})` : "";
    const reason = typeof ignore.reason === "string" ? `: ${ignore.reason}` : "";
    return `${code}${message}${reason}`;
  }
  if (field === "review" && parsed && typeof parsed === "object") {
    const review = parsed as { ignore_findings?: unknown };
    if (Array.isArray(review.ignore_findings)) {
      return `${review.ignore_findings.length} ignored advisory findings`;
    }
    if (Object.keys(parsed).length === 0) {
      return "no review policy";
    }
  }
  return value;
}

function notableChanges(entry: CapabilityDiffEntry): string[] {
  const lines: string[] = [];
  const priority = [
    "status",
    "summary",
    "intent",
    "acceptance",
    "verification.automated",
    "verification.gaps",
    "verification.ignore_gaps",
    "review",
    "implementation.references"
  ];

  for (const field of priority) {
    const diff = entry.fieldDiffs.find((item) => item.field === field);
    if (!diff) {
      continue;
    }
    for (const value of diff.added.slice(0, field === "implementation.references" ? 2 : 3)) {
      lines.push(`+ ${field}: ${displayValue(field, value)}`);
    }
    for (const value of diff.removed.slice(0, field === "implementation.references" ? 2 : 3)) {
      if (field === "review" && displayValue(field, value) === "no review policy") {
        continue;
      }
      lines.push(`- ${field}: ${displayValue(field, value)}`);
    }
    if (lines.length >= 5) {
      break;
    }
  }

  return lines.slice(0, 5);
}

function suggestedCommands(entry: CapabilityDiffEntry): string[] {
  const commands = [`node packages/cli/dist/index.js status ${entry.capabilityId}`];
  const checkDiff = entry.fieldDiffs.find((diff) => diff.field === "verification.automated");
  for (const value of checkDiff?.added ?? []) {
    const parsed = parseStableObject(value);
    if (parsed && typeof parsed === "object") {
      const command = (parsed as { command?: unknown }).command;
      if (typeof command === "string") {
        commands.push(command);
      }
    }
  }
  return Array.from(new Set(commands)).slice(0, 4);
}

function formatConciseCapabilityDiffReport(report: CapabilityDiffReport): string {
  const impacted = new Set(report.entries.flatMap((entry) => [...entry.directDependents, ...entry.transitiveDependents]));
  const lines = [
    `CapabilityKit Diff: ${report.base}..working-tree`,
    "",
    "Summary",
    `  Added: ${report.summary.added}`,
    `  Changed: ${report.summary.changed}`,
    `  Removed: ${report.summary.removed}`,
    `  Impacted dependents: ${impacted.size}`
  ];

  const added = report.entries.filter((entry) => entry.kind === "added");
  if (added.length > 0) {
    lines.push("", "Added");
    for (const entry of added) {
      lines.push(`  + ${entry.capabilityId}`, `    Purpose: ${entry.summary ?? entry.title}`);
      if (entry.status) {
        lines.push(`    Status: ${entry.status}`);
      }
      if (entry.directDependents.length > 0 || entry.transitiveDependents.length > 0) {
        lines.push(`    Impact: ${impactSummary(entry)}`);
      }
    }
  }

  const changed = report.entries.filter((entry) => entry.kind === "changed");
  if (changed.length > 0) {
    lines.push("", "Changed");
    for (const entry of changed) {
      lines.push(`  ~ ${entry.capabilityId}`, `    ${compactSignals(entry).join("; ") || "metadata changed"}`);
      lines.push(`    Impact: ${impactSummary(entry)}`);
      const notable = notableChanges(entry);
      if (notable.length > 0) {
        lines.push("    Notable changes:");
        for (const line of notable) {
          lines.push(`      ${line}`);
        }
      }
      const commands = suggestedCommands(entry);
      if (commands.length > 0) {
        lines.push("    Suggested review:");
        for (const command of commands) {
          lines.push(`      ${command}`);
        }
      }
    }
  }

  const removed = report.entries.filter((entry) => entry.kind === "removed");
  if (removed.length > 0) {
    lines.push("", "Removed");
    for (const entry of removed) {
      lines.push(`  - ${entry.capabilityId}`, `    Was: ${entry.previousStatus ?? "unknown"}`);
      if (entry.summary) {
        lines.push(`    Purpose: ${entry.summary}`);
      }
      lines.push(`    Impact: ${impactSummary(entry)}`);
    }
  }

  if (report.entries.length === 0) {
    lines.push("", "No capability changes detected.");
  } else {
    lines.push("", "Use `capabilitykit diff --verbose` for field-level details.");
  }

  return `${lines.join("\n")}\n`;
}

function formatVerboseCapabilityDiffReport(report: CapabilityDiffReport): string {
  const lines = [
    `CapabilityKit Diff: ${report.base}..working-tree`,
    "",
    `Added: ${report.summary.added}  Changed: ${report.summary.changed}  Removed: ${report.summary.removed}`
  ];

  const section = (title: string, kind: CapabilityDiffKind): void => {
    const entries = report.entries.filter((entry) => entry.kind === kind);
    if (entries.length === 0) {
      return;
    }
    lines.push("", title);
    for (const entry of entries) {
      const marker = kind === "added" ? "+" : kind === "removed" ? "-" : "~";
      lines.push(`  ${marker} ${entry.capabilityId}`);
      lines.push(`    ${entry.title}${entry.status ? ` (${entry.status})` : entry.previousStatus ? ` (${entry.previousStatus})` : ""}`);
      if (entry.summary) {
        lines.push(`    ${entry.summary}`);
      }
      for (const diff of entry.fieldDiffs.slice(0, 6)) {
        lines.push(...formatFieldDiff(diff));
      }
      if (entry.directDependents.length > 0) {
        lines.push(`    Direct dependents: ${entry.directDependents.join(", ")}`);
      }
      if (entry.transitiveDependents.length > entry.directDependents.length) {
        lines.push(`    Transitive dependents: ${entry.transitiveDependents.length}`);
      }
    }
  };

  section("Added", "added");
  section("Changed", "changed");
  section("Removed", "removed");

  if (report.entries.length === 0) {
    lines.push("", "No capability changes detected.");
  }

  return `${lines.join("\n")}\n`;
}

export function formatCapabilityDiffReport(
  report: CapabilityDiffReport,
  options: CapabilityDiffFormatOptions = {}
): string {
  return options.verbose ? formatVerboseCapabilityDiffReport(report) : formatConciseCapabilityDiffReport(report);
}
