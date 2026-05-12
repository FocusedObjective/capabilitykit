import type {
  Capability,
  CapabilityIssue,
  LoadCapabilitiesResult,
  ParsedCapability,
  ValidationResult,
  VerificationGap
} from "./types.js";
import fs from "node:fs";
import path from "node:path";

const placeholderPattern = /\b(TODO|TBD|FIXME|placeholder)\b/i;

function hasVerification(capability: Capability): boolean {
  return Boolean(
    (capability.agent?.verification?.automated?.length ?? 0) > 0 ||
      (capability.agent?.verification?.manual?.length ?? 0) > 0
  );
}

function hasImplementationReferences(capability: Capability): boolean {
  return (capability.agent?.implementation?.references?.length ?? 0) > 0;
}

function implementationReferenceExists(rootDir: string, reference: string): boolean {
  return fs.existsSync(path.resolve(rootDir, reference));
}

function addGap(gaps: VerificationGap[], capability: ParsedCapability, code: string, message: string): void {
  gaps.push({
    code,
    message,
    capabilityId: capability.capability.id,
    filePath: capability.filePath
  });
}

function ignoresGap(capability: Capability, gap: VerificationGap): boolean {
  return (capability.agent?.verification?.ignore_gaps ?? []).some((ignore) => {
    const codeMatches = ignore.code === "*" || ignore.code === gap.code;
    const messageMatches = ignore.message_contains === undefined || gap.message.includes(ignore.message_contains);
    return codeMatches && messageMatches;
  });
}

function containsPlaceholder(value: unknown): boolean {
  if (typeof value === "string") {
    return placeholderPattern.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsPlaceholder);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(containsPlaceholder);
  }
  return false;
}

export function validateLoadedCapabilities(loaded: LoadCapabilitiesResult): ValidationResult {
  const errors: CapabilityIssue[] = [...loaded.errors];
  const verificationGaps: VerificationGap[] = [];
  const ids = new Map<string, ParsedCapability[]>();

  for (const capability of loaded.capabilities) {
    const existing = ids.get(capability.capability.id) ?? [];
    existing.push(capability);
    ids.set(capability.capability.id, existing);
  }

  for (const [id, matches] of ids.entries()) {
    if (matches.length > 1) {
      for (const match of matches) {
        errors.push({
          code: "duplicate-id",
          message: `Duplicate capability id "${id}"`,
          capabilityId: id,
          filePath: match.filePath
        });
      }
    }
  }

  for (const parsed of loaded.capabilities) {
    const capability = parsed.capability;

    for (const dependency of capability.agent?.depends_on ?? []) {
      if (!ids.has(dependency)) {
        errors.push({
          code: "broken-dependency",
          message: `${capability.id} depends on missing capability "${dependency}"`,
          capabilityId: capability.id,
          filePath: parsed.filePath
        });
      }
    }

    if (!hasVerification(capability)) {
      addGap(
        verificationGaps,
        parsed,
        "missing-verification",
        `${capability.id} has no automated or manual verification checks`
      );
    }

    if ((capability.agent?.verification?.automated?.length ?? 0) === 0) {
      addGap(verificationGaps, parsed, "missing-automated-checks", `${capability.id} has no automated checks`);
    }

    if ((capability.agent?.verification?.manual?.length ?? 0) === 0) {
      addGap(verificationGaps, parsed, "missing-manual-review", `${capability.id} has no manual review guidance`);
    }

    for (const declaredGap of capability.agent?.verification?.gaps ?? []) {
      addGap(verificationGaps, parsed, "declared-gap", `${capability.id}: ${declaredGap}`);
    }

    const requiresImplementation =
      loaded.config.validation?.require_implementation_references_for_status?.includes(capability.status) ?? false;

    if (requiresImplementation && !hasImplementationReferences(capability)) {
      addGap(
        verificationGaps,
        parsed,
        "missing-implementation-references",
        `${capability.id} is ${capability.status} but has no implementation references`
      );
    }

    if (requiresImplementation) {
      for (const reference of capability.agent?.implementation?.references ?? []) {
        if (!implementationReferenceExists(loaded.rootDir, reference)) {
          addGap(
            verificationGaps,
            parsed,
            "missing-implementation-reference-target",
            `${capability.id} references missing implementation path "${reference}"`
          );
        }
      }
    }

    if (capability.status === "verified" && !hasVerification(capability)) {
      errors.push({
        code: "verified-without-verification",
        message: `${capability.id} is verified but has no verification checks`,
        capabilityId: capability.id,
        filePath: parsed.filePath
      });
    }

    if (capability.status === "deprecated" && !capability.replacement) {
      addGap(verificationGaps, parsed, "missing-replacement-guidance", `${capability.id} is deprecated without replacement guidance`);
    }

    if (containsPlaceholder(capability)) {
      addGap(verificationGaps, parsed, "placeholder-content", `${capability.id} contains TODO, TBD, FIXME, or placeholder text`);
    }
  }

  const capabilitiesById = new Map(loaded.capabilities.map((parsed) => [parsed.capability.id, parsed.capability]));
  const activeVerificationGaps = verificationGaps.filter((gap) => {
    if (!gap.capabilityId) {
      return true;
    }
    const capability = capabilitiesById.get(gap.capabilityId);
    return capability ? !ignoresGap(capability, gap) : true;
  });

  return {
    valid: errors.length === 0,
    parsedCount: loaded.capabilities.length,
    uniqueIdCount: ids.size,
    errors,
    verificationGaps: activeVerificationGaps
  };
}
