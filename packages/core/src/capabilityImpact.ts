import { loadCapabilities } from "./loadCapabilities.js";
import { validateLoadedCapabilities } from "./validateCapabilities.js";
import type {
  CapabilityImpactGraph,
  CapabilityImpactReport,
  LoadCapabilitiesResult,
  VerificationCheck,
  VerificationGap
} from "./types.js";

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function buildCapabilityImpactGraph(loaded: LoadCapabilitiesResult): CapabilityImpactGraph {
  const ids = loaded.capabilities.map((item) => item.capability.id).sort((a, b) => a.localeCompare(b));
  const dependencies: Record<string, string[]> = {};
  const dependents: Record<string, string[]> = {};

  for (const id of ids) {
    dependencies[id] = [];
    dependents[id] = [];
  }

  for (const item of loaded.capabilities) {
    const dependencyIds = item.capability.agent?.depends_on ?? [];
    dependencies[item.capability.id] = uniqueSorted(dependencyIds);
    for (const dependency of dependencyIds) {
      dependents[dependency] = uniqueSorted([...(dependents[dependency] ?? []), item.capability.id]);
    }
  }

  const transitive_dependents: Record<string, string[]> = {};
  for (const id of Object.keys(dependents).sort((a, b) => a.localeCompare(b))) {
    const visited = new Set<string>();
    const queue = [...(dependents[id] ?? [])];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      queue.push(...(dependents[current] ?? []));
    }
    transitive_dependents[id] = uniqueSorted(visited);
  }

  return {
    dependencies,
    dependents,
    transitive_dependents
  };
}

function uniqueChecks(checks: VerificationCheck[]): VerificationCheck[] {
  const seen = new Set<string>();
  const result: VerificationCheck[] = [];
  for (const check of checks) {
    const key = check.command ?? `${check.id ?? ""}\n${check.description}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(check);
    }
  }
  return result;
}

export async function analyzeCapabilityImpact(
  rootDir = process.cwd(),
  capabilityId: string
): Promise<CapabilityImpactReport> {
  const loaded = await loadCapabilities(rootDir);
  const graph = buildCapabilityImpactGraph(loaded);
  const validation = validateLoadedCapabilities(loaded);
  const capabilities = new Map(loaded.capabilities.map((item) => [item.capability.id, item.capability]));

  if (!capabilities.has(capabilityId)) {
    throw new Error(`Capability not found: ${capabilityId}`);
  }

  const directDependents = graph.dependents[capabilityId] ?? [];
  const transitiveDependents = graph.transitive_dependents[capabilityId] ?? [];
  const impacted = uniqueSorted([capabilityId, ...directDependents, ...transitiveDependents]);
  const impactedCapabilities = impacted.map((id) => capabilities.get(id)).filter((capability) => capability !== undefined);

  const automated = uniqueChecks(impactedCapabilities.flatMap((capability) => capability.agent?.verification?.automated ?? []));
  const manual = uniqueSorted(impactedCapabilities.flatMap((capability) => capability.agent?.verification?.manual ?? []));
  const impactedSet = new Set(impacted);
  const gaps = validation.verificationGaps.filter((gap) => gap.capabilityId && impactedSet.has(gap.capabilityId));

  return {
    capability_id: capabilityId,
    dependencies: graph.dependencies[capabilityId] ?? [],
    direct_dependents: directDependents,
    transitive_dependents: transitiveDependents,
    impacted_capabilities: impacted,
    verification: {
      automated,
      manual,
      gaps
    }
  };
}

export function formatCapabilityImpactReport(report: CapabilityImpactReport): string {
  const lines: string[] = [];
  const section = (title: string, values: string[]): void => {
    lines.push("");
    lines.push(`${title}:`);
    if (values.length === 0) {
      lines.push("  - none");
      return;
    }
    for (const value of values) {
      lines.push(`  - ${value}`);
    }
  };

  lines.push(`Capability impact: ${report.capability_id}`);
  section("Dependencies", report.dependencies);
  section("Direct dependents", report.direct_dependents);
  section("Transitive dependents", report.transitive_dependents);
  section("Impacted capabilities", report.impacted_capabilities);
  section(
    "Suggested automated checks",
    report.verification.automated.map((check) => (check.command ? `${check.command} (${check.description})` : check.description))
  );
  section("Manual review", report.verification.manual);
  section(
    "Verification gaps",
    report.verification.gaps.map((gap) => gap.message)
  );

  return lines.join("\n");
}
