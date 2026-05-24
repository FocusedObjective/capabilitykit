export function agentMetadataCommentLines(capabilityId: string): string[] {
  return [
    "machine managed agent metadata",
    "refresh all review evidence: capabilitykit sync-review",
    `refresh this review evidence: capabilitykit sync-review ${capabilityId}`,
    `review this capability: capabilitykit assess ${capabilityId}`,
    `ask an agent to review this capability: capabilitykit agent-review ${capabilityId} --command codex --handoff stdin`,
    `save agent review output: capabilitykit review-result ${capabilityId} --input review.json --save`
  ];
}
