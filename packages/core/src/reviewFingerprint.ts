import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { loadCapabilities } from "./loadCapabilities.js";
import type { Capability } from "./types.js";

// Review metadata must not invalidate its own evidence, including self-references.
function reviewInputs(capability: Capability) {
  const { review: _review, ...agent } = capability.agent ?? {};
  return { ...capability, agent };
}

export async function fingerprintReviewInputs(rootDir: string, capability: Capability, capabilities?: Capability[]): Promise<string> {
  const byId = new Map((capabilities ?? (await loadCapabilities(rootDir)).capabilities.map((item) => item.capability))
    .map((item) => [item.id, item]));
  byId.set(capability.id, capability);
  const hash = createHash("sha256");
  const files = new Set<string>();
  const visited = new Set<string>();
  function collect(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const input = byId.get(id);
    hash.update(JSON.stringify(input ? reviewInputs(input) : { missingDependency: id }));
    if (!input) return;
    for (const reference of input.agent?.implementation?.references ?? []) files.add(reference);
    for (const criterion of input.agent?.review?.criteria ?? []) {
      for (const evidence of criterion.evidence) files.add(evidence.replace(/:\d+$/, ""));
    }
    for (const dependency of [...(input.agent?.depends_on ?? [])].sort()) collect(dependency);
  }
  collect(capability.id);
  for (const reference of [...files].sort()) {
    if ([...visited].some((id) => reference.replace(/\\/g, "/") === `.capabilities/${id}.capability.yaml`)) continue;
    hash.update(JSON.stringify(reference));
    const resolved = path.resolve(rootDir, reference);
    const relative = path.relative(rootDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      hash.update("outside-repository");
      continue;
    }
    try {
      const content = await fs.readFile(resolved);
      if (reference.endsWith(".capability.yaml")) {
        const document = parseDocument(content.toString("utf8"));
        if (document.errors.length > 0) throw new Error("Invalid capability YAML");
        document.deleteIn(["agent", "review"]);
        hash.update(JSON.stringify(document.toJSON()));
      } else {
        hash.update(content);
      }
    } catch {
      hash.update("missing-or-unreadable");
    }
  }
  return hash.digest("hex");
}
