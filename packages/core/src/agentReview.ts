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
    '  "intent_summary": "string",',
    '  "criteria": [',
    "    {",
    '      "criterion": "string",',
    '      "status": "covered | partial | uncovered | uncertain",',
    '      "evidence": ["path:line"],',
    '      "notes": "string"',
    "    }",
    "  ],",
    '  "remaining_gaps": ["string"],',
    '  "done": false',
    "}",
    "```",
    "",
    "Set `done` to true only when every criterion is covered with concrete file-path evidence.",
    "Use `partial` or `uncertain` when the deterministic report points to possible evidence but semantic coverage is not proven.",
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
