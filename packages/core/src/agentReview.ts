import { assessImplementationCoverage, formatImplementationCoverageReport } from "./assessImplementationCoverage.js";
import { buildAgentTaskBundle } from "./agentTask.js";

export interface AgentReviewPromptOptions {
  includeReferences?: boolean;
}

export interface AgentReviewPrompt {
  capabilityId: string;
  prompt: string;
  missingReferences: string[];
}

function reviewOutputInstructions(): string {
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
    '      "notes": "string"',
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
    "Do not change capability status; this review is evidence for a human or policy-controlled acceptance step."
  ].join("\n");
}

export async function buildAgentReviewPrompt(
  rootDir: string,
  capabilityId: string,
  options: AgentReviewPromptOptions = {}
): Promise<AgentReviewPrompt> {
  const [bundle, coverage] = await Promise.all([
    buildAgentTaskBundle(rootDir, capabilityId, {
      mode: "review",
      includeReferences: options.includeReferences ?? true
    }),
    assessImplementationCoverage(rootDir, capabilityId)
  ]);

  return {
    capabilityId: bundle.capabilityId,
    missingReferences: Array.from(new Set([...bundle.missingReferences, ...coverage.missingReferences])),
    prompt: [
      bundle.prompt,
      "",
      "# Deterministic Implementation Coverage Report",
      "",
      formatImplementationCoverageReport(coverage),
      "",
      reviewOutputInstructions()
    ].join("\n")
  };
}
