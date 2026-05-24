import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { deriveCapabilityIdentity, parseCapability } from "./parseCapability.js";
import { projectConfigSchema } from "./schema.js";
import type { CapabilityIssue, LoadCapabilitiesResult, ProjectConfig } from "./types.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }
      return [fullPath];
    })
  );
  return results.flat();
}

function normalizeRelative(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isExcluded(relativePath: string, excludes: string[]): boolean {
  return excludes.some((pattern) => {
    const clean = pattern.replace(/^\.\//, "");
    if (clean.endsWith("/**")) {
      return relativePath.startsWith(clean.slice(0, -3));
    }
    if (clean.endsWith("/**/*")) {
      return relativePath.startsWith(clean.slice(0, -5));
    }
    if (clean.endsWith("/**")) {
      return relativePath.startsWith(clean.slice(0, -2));
    }
    return relativePath === clean || relativePath.startsWith(`${clean.replace(/\*\*$/, "")}`);
  });
}

function matchesInclude(relativePath: string, includes: string[]): boolean {
  return includes.some((pattern) => {
    if (pattern === "**/*.capability.yaml") {
      return relativePath.endsWith(".capability.yaml");
    }
    return relativePath === pattern;
  });
}

async function loadConfig(rootDir: string): Promise<{ config?: ProjectConfig; errors: CapabilityIssue[] }> {
  const configPath = path.join(rootDir, ".capabilities", "capabilitykit.yaml");
  if (!(await pathExists(configPath))) {
    return {
      errors: [
        {
          code: "missing-config",
          message: "Missing .capabilities/capabilitykit.yaml",
          filePath: configPath
        }
      ]
    };
  }

  const source = await fs.readFile(configPath, "utf8");
  const document = parseDocument(source, { prettyErrors: true });
  if (document.errors.length > 0) {
    return {
      errors: document.errors.map((error) => ({
        code: "yaml-parse-error",
        message: error.message,
        filePath: configPath
      }))
    };
  }

  const result = projectConfigSchema.safeParse(document.toJSON());
  if (!result.success) {
    return {
      errors: result.error.issues.map((issue) => ({
        code: "config-schema-error",
        message: `${issue.path.join(".") || "root"}: ${issue.message}`,
        filePath: configPath
      }))
    };
  }

  return { config: result.data, errors: [] };
}

export async function loadCapabilities(rootDir = process.cwd()): Promise<LoadCapabilitiesResult> {
  const resolvedRoot = path.resolve(rootDir);
  const capabilitiesDir = path.join(resolvedRoot, ".capabilities");
  const configResult = await loadConfig(resolvedRoot);

  if (!configResult.config) {
    return {
      rootDir: resolvedRoot,
      capabilitiesDir,
      config: projectConfigSchema.parse({
        schema_version: "0.1",
        project: { name: path.basename(resolvedRoot) }
      }),
      capabilities: [],
      errors: configResult.errors
    };
  }

  const files = (await walk(capabilitiesDir))
    .map((filePath) => ({
      filePath,
      relativePath: normalizeRelative(path.relative(capabilitiesDir, filePath))
    }))
    .filter(({ relativePath }) => matchesInclude(relativePath, configResult.config?.source?.include ?? []))
    .filter(({ relativePath }) => !isExcluded(relativePath, configResult.config?.source?.exclude ?? []))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const parsed = await Promise.all(
    files.map(async ({ filePath, relativePath }) => {
      const source = await fs.readFile(filePath, "utf8");
      const { derivedId, derivedArea } = deriveCapabilityIdentity(relativePath);
      const result = parseCapability(source, filePath, { derivedId, derivedArea });
      return {
        filePath,
        relativePath,
        derivedId,
        derivedArea,
        result
      };
    })
  );

  return {
    rootDir: resolvedRoot,
    capabilitiesDir,
    config: configResult.config,
    capabilities: parsed
      .filter((item) => item.result.capability)
      .map((item) => ({
        capability: item.result.capability!,
        filePath: item.filePath,
        relativePath: item.relativePath,
        derivedId: item.derivedId,
        derivedArea: item.derivedArea,
        hasExplicitId: item.result.hasExplicitId,
        hasExplicitArea: item.result.hasExplicitArea
      })),
    errors: [...configResult.errors, ...parsed.flatMap((item) => item.result.errors)]
  };
}
