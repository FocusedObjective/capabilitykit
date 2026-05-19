import { isNode, type Document } from "yaml";

export function setAgentSectionComment(document: Document, lines: string[]): void {
  const agentNode = document.get("agent", true);
  if (!isNode(agentNode)) {
    return;
  }
  agentNode.commentBefore = lines.map((line) => ` ${line}`).join("\n");
}
