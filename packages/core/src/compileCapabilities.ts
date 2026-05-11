import { promises as fs } from "node:fs";
import path from "node:path";
import { loadCapabilities } from "./loadCapabilities.js";
import { validateLoadedCapabilities } from "./validateCapabilities.js";
import type { CompiledCapabilities } from "./types.js";

export async function compileCapabilities(rootDir = process.cwd()): Promise<CompiledCapabilities> {
  const loaded = await loadCapabilities(rootDir);
  const validation = validateLoadedCapabilities(loaded);

  const capabilities = loaded.capabilities.map(({ capability, relativePath }) => ({
    ...capability,
    path: `.capabilities/${relativePath}`,
    hierarchy: relativePath.replace(/\.capability\.yaml$/, "").split("/")
  }));

  return {
    project: loaded.config.project,
    generated_at: new Date().toISOString(),
    capabilities,
    dependency_graph: Object.fromEntries(capabilities.map((capability) => [capability.id, capability.agent?.depends_on ?? []])),
    verification_summary: {
      automated_checks: capabilities.reduce((total, capability) => total + (capability.agent?.verification?.automated?.length ?? 0), 0),
      manual_checks: capabilities.reduce((total, capability) => total + (capability.agent?.verification?.manual?.length ?? 0), 0),
      gaps: validation.verificationGaps.length
    },
    validation
  };
}

export async function writeCompiledCapabilities(rootDir = process.cwd()): Promise<{ outputPath: string; compiled: CompiledCapabilities }> {
  const compiled = await compileCapabilities(rootDir);
  const outputPath = path.resolve(rootDir, ".capabilities", "dist", "capabilities.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(compiled, null, 2)}\n`);
  return { outputPath, compiled };
}
