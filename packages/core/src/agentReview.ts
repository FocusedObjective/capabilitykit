import { assessImplementationCoverage, formatImplementationCoverageReport } from "./assessImplementationCoverage.js";
import { buildAgentTaskBundle } from "./agentTask.js";
import { loadCapabilities } from "./loadCapabilities.js";
import { fingerprintReviewInputs } from "./reviewFingerprint.js";

export interface AgentReviewPromptOptions {
  includeReferences?: boolean;
  detailed?: boolean;
}

export interface AgentReviewPrompt {
  capabilityId: string;
  prompt: string;
  missingReferences: string[];
  inputFingerprint: string;
}

function reviewOutputInstructions(detailed: boolean): string {
  return [
    "## Required Review Output",
    "",
    "Return a concise review with this JSON shape:",
    "",
    "```json",
    "{",
    '  "source": "coding-agent",',
    '  "intent_summary": "string",',
    '  "criteria": [',
    "    {",
    '      "criterion": "string",',
    '      "status": "covered | partial | uncovered | uncertain",',
    '      "evidence": ["path:line"],',
    '      "notes": "short gap or uncertainty; omit for covered criteria"',
    "    }",
    "  ],",
    '  "verification_evidence": ["successful command or manual check"],',
    '  "remaining_gaps": ["string"],',
    '  "done": false',
    "}",
    "```",
    "",
    "Act as a coding agent reviewing the repository, not as a text matcher.",
    "Inspect the referenced source, tests, and related code paths directly before deciding whether each criterion is implemented.",
    "Use the deterministic report only as a starting evidence bundle; do not trust it as proof.",
    "Set `done` to true only when every criterion is covered with concrete file-path evidence. Residual verification gaps may remain when the implementation behavior is covered but confidence is not complete.",
    "Record successful test commands, builds, and manual checks in `verification_evidence`. Record only unresolved risks or missing checks in `remaining_gaps`.",
    "Use `partial` when only part of a behavior is implemented, `uncovered` when the code does not implement it, and `uncertain` only when the repository evidence is insufficient to decide.",
    "Do not change capability status; this review is evidence for a human or policy-controlled acceptance step.",
    ...(detailed ? [] : [
      "Return JSON only. Keep intent_summary to one sentence. Omit notes for covered criteria; give a short reason for partial, uncovered, or uncertain criteria.",
      "Review only this capability. Inspect every implementation reference, following related code only as needed to decide the acceptance criteria.",
      "Use the smallest concrete evidence set that supports each decision. Stop once every criterion has a status and sufficient evidence.",
      "Search large reference files for relevant symbols and read focused sections instead of dumping entire files. Batch independent evidence reads.",
      "Run focused verification only when needed to resolve uncertainty. Do not run repository-wide reviews, repeat already supplied successful checks, or fix code.",
      "If a decision requires a long investigation or unavailable verification, report uncertain and the missing evidence instead of expanding the review."
    ])
  ].join("\n");
}

export async function buildAgentReviewPrompt(
  rootDir: string,
  capabilityId: string,
  options: AgentReviewPromptOptions = {}
): Promise<AgentReviewPrompt> {
  const detailed = options.detailed ?? false;
  const loaded = await loadCapabilities(rootDir);
  const capability = loaded.capabilities.find((item) => item.capability.id === capabilityId)?.capability;
  if (!capability) throw new Error(`Capability not found: ${capabilityId}`);
  const inputFingerprint = await fingerprintReviewInputs(loaded.rootDir, capability, loaded.capabilities.map((item) => item.capability));
  const bundle = await buildAgentTaskBundle(rootDir, capabilityId, {
      mode: "review",
      includeReferences: options.includeReferences ?? detailed
    });
  const coverage = detailed ? await assessImplementationCoverage(rootDir, capabilityId) : undefined;

  return {
    capabilityId: bundle.capabilityId,
    inputFingerprint,
    missingReferences: Array.from(new Set([...bundle.missingReferences, ...(coverage?.missingReferences ?? [])])),
    prompt: [
      bundle.prompt,
      ...(coverage ? ["", "# Deterministic Implementation Coverage Report", "", formatImplementationCoverageReport(coverage)] : []),
      "",
      reviewOutputInstructions(detailed)
    ].join("\n")
  };
}
