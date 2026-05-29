export function agentMetadataCommentLines(capabilityId: string): string[] {
  return [
    "machine managed agent metadata",
    "review all capabilities and save evidence: capabilitykit review",
    `review this capability and save evidence: capabilitykit review ${capabilityId}`,
    `run deterministic review only: capabilitykit review ${capabilityId} --deterministic-only`,
    `ask an agent and save review evidence: capabilitykit review ${capabilityId} --agent codex --arg exec --handoff stdin`,
    `validate saved agent output without writing: capabilitykit review-result ${capabilityId} --input review.json`
  ];
}
