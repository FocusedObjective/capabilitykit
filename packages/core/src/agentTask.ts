import { promises as fs } from "node:fs";
import path from "node:path";
import { loadCapabilities } from "./loadCapabilities.js";
import type { Capability, VerificationCheck } from "./types.js";

export type AgentTaskMode = "implement" | "review";

export interface AgentTaskOptions {
  mode?: AgentTaskMode;
  includeReferences?: boolean;
}

export interface AgentTaskBundle {
  capabilityId: string;
  mode: AgentTaskMode;
  prompt: string;
  missingReferences: string[];
}

interface ReferenceContent {
  reference: string;
  exists: boolean;
  content?: string;
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}`;
}

function bulletList(items: string[] | undefined, empty = "None."): string {
  if (!items || items.length === 0) {
    return empty;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function numberedList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function verificationChecks(checks: VerificationCheck[] | undefined): string {
  if (!checks || checks.length === 0) {
    return "None.";
  }
  return checks
    .map((check) => {
      const id = check.id ? ` (${check.id})` : "";
      const command = check.command ? `\n   Command: \`${check.command}\`` : "";
      return `- ${check.description}${id}${command}`;
    })
    .join("\n");
}

function taskInstructions(mode: AgentTaskMode): string {
  if (mode === "implement") {
    return [
      "Implement the capability described below.",
      "Use the acceptance criteria as the contract for done.",
      "Update code, tests, and capability files when behavior changes.",
      "Run the listed verification checks when practical.",
      "In your final response, summarize changed files, verification results, and any remaining gaps."
    ].join("\n");
  }

  return [
    "Review whether the current implementation satisfies the capability described below.",
    "First summarize the capability intent in your own words.",
    "For each acceptance criterion, mark it as covered, partial, uncovered, or uncertain.",
    "Provide concrete file-path evidence for covered or partially covered criteria.",
    "Do not mark the capability verified solely from prose; report remaining gaps explicitly."
  ].join("\n");
}

async function readReference(rootDir: string, reference: string): Promise<ReferenceContent> {
  const resolved = path.resolve(rootDir, reference);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return { reference, exists: false };
    }
    return {
      reference,
      exists: true,
      content: await fs.readFile(resolved, "utf8")
    };
  } catch {
    return { reference, exists: false };
  }
}

function renderReferences(references: ReferenceContent[], includeReferences: boolean): string {
  if (references.length === 0) {
    return "None.";
  }

  if (!includeReferences) {
    return references.map((reference) => `- ${reference.reference}`).join("\n");
  }

  return references
    .map((reference) => {
      if (!reference.exists) {
        return `### ${reference.reference}\n\nMissing or unreadable.`;
      }

      return `### ${reference.reference}\n\n\`\`\`\n${reference.content ?? ""}\n\`\`\``;
    })
    .join("\n\n");
}

function renderCapabilitySummary(capability: Capability): string {
  return [
    `Capability: ${capability.title} (${capability.id})`,
    `Status: ${capability.status}`,
    `Area: ${capability.area}`,
    "",
    capability.summary
  ].join("\n");
}

export async function buildAgentTaskBundle(
  rootDir: string,
  capabilityId: string,
  options: AgentTaskOptions = {}
): Promise<AgentTaskBundle> {
  const mode = options.mode ?? "implement";
  const includeReferences = options.includeReferences ?? true;
  const loaded = await loadCapabilities(rootDir);
  const match = loaded.capabilities.find((item) => item.capability.id === capabilityId);

  if (!match) {
    throw new Error(`Capability not found: ${capabilityId}`);
  }

  const capability = match.capability;
  const implementationReferences = capability.agent?.implementation?.references ?? [];
  const references = await Promise.all(implementationReferences.map((reference) => readReference(loaded.rootDir, reference)));
  const missingReferences = references.filter((reference) => !reference.exists).map((reference) => reference.reference);

  const prompt = [
    "# CapabilityKit Agent Task",
    "",
    `Mode: ${mode}`,
    "",
    section("Instructions", taskInstructions(mode)),
    section("Capability", renderCapabilitySummary(capability)),
    section("Intent", capability.intent),
    section("Acceptance Criteria", numberedList(capability.acceptance)),
    section("Guidance", bulletList(capability.guidance)),
    section("Inputs", bulletList(capability.agent?.inputs)),
    section("Outputs", bulletList(capability.agent?.outputs)),
    section("Dependencies", bulletList(capability.agent?.depends_on)),
    section("Implementation References", bulletList(implementationReferences)),
    section("Automated Verification", verificationChecks(capability.agent?.verification?.automated)),
    section("Manual Verification", bulletList(capability.agent?.verification?.manual)),
    section("Declared Verification Gaps", bulletList(capability.agent?.verification?.gaps)),
    section("Referenced Implementation Content", renderReferences(references, includeReferences))
  ].join("\n\n");

  return {
    capabilityId: capability.id,
    mode,
    prompt,
    missingReferences
  };
}
