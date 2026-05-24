import { parseDocument } from "yaml";
import { capabilitySchema } from "./schema.js";
import type { Capability, CapabilityIssue } from "./types.js";

export function deriveCapabilityIdentity(filePath: string): { derivedId: string; derivedArea: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const relativePath = normalized.includes(".capabilities/")
    ? normalized.slice(normalized.lastIndexOf(".capabilities/") + ".capabilities/".length)
    : normalized.replace(/^\.\//, "");
  const withoutSuffix = relativePath.replace(/\.capability\.yaml$/, "");
  const parts = withoutSuffix.split("/").filter(Boolean);
  return {
    derivedId: withoutSuffix,
    derivedArea: parts[0] ?? "general"
  };
}

export interface ParseCapabilityResult {
  capability?: Capability;
  errors: CapabilityIssue[];
  hasExplicitId?: boolean;
  hasExplicitArea?: boolean;
}

export function parseCapability(
  source: string,
  filePath: string,
  defaults?: { derivedId?: string; derivedArea?: string }
): ParseCapabilityResult {
  const document = parseDocument(source, { prettyErrors: true });
  const errors: CapabilityIssue[] = document.errors.map((error) => ({
    code: "yaml-parse-error",
    message: error.message,
    filePath
  }));

  if (errors.length > 0) {
    return { errors };
  }

  const data = document.toJSON() as Record<string, unknown>;
  const hasExplicitId = typeof data === "object" && data !== null && Object.hasOwn(data, "id");
  const hasExplicitArea = typeof data === "object" && data !== null && Object.hasOwn(data, "area");
  const derived = defaults ?? deriveCapabilityIdentity(filePath);
  if (typeof data === "object" && data !== null && !hasExplicitId && derived.derivedId) {
    data.id = derived.derivedId;
  }
  if (typeof data === "object" && data !== null && !hasExplicitArea && derived.derivedArea) {
    data.area = derived.derivedArea;
  }
  const result = capabilitySchema.safeParse(data);

  if (!result.success) {
    return {
      errors: result.error.issues.map((issue) => ({
        code: "schema-error",
        message: `${issue.path.join(".") || "root"}: ${issue.message}`,
        filePath
      }))
    };
  }

  return { capability: result.data, errors: [], hasExplicitId, hasExplicitArea };
}
