import { isMap, isNode, isScalar, type Document } from "yaml";

export function setAgentSectionComment(document: Document, lines: string[]): void {
  const agentNode = document.get("agent", true);
  if (!isMap(document.contents) || !isNode(agentNode)) {
    return;
  }
  const agentPair = document.contents.items.find((item) => isScalar(item.key) && item.key.value === "agent");
  if (isNode(agentPair?.key)) {
    agentPair.key.commentBefore = " \n ";
  }
  const banner = "-----------------------------";
  agentNode.commentBefore = [banner, ...lines, banner].map((line) => ` ${line}`).join("\n");
}
