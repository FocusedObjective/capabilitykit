import { parseDocument } from "yaml";
import { capabilitySchema } from "./schema.js";
import type { Capability, CapabilityIssue } from "./types.js";

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
  if (!hasExplicitId && defaults?.derivedId) {
    data.id = defaults.derivedId;
  }
  if (!hasExplicitArea && defaults?.derivedArea) {
    data.area = defaults.derivedArea;
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
