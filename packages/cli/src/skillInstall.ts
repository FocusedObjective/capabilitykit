import { promises as fs } from "node:fs";
import path from "node:path";

const blockStart = "<!-- capabilitykit:start -->";
const blockEnd = "<!-- capabilitykit:end -->";

export interface SkillInstallFile {
  path: string;
  contents: string;
  block: string;
}

export interface InstallCapabilityKitSkillOptions {
  packageSkillPath?: string;
}

export interface InstallCapabilityKitSkillResult {
  written: string[];
}

function managedBlock(packageSkillPath: string): string {
  return `${blockStart}
# capabilitykit

This project uses **CapabilityKit** to manage capabilities as code.
Read the full guide at \`${packageSkillPath}\` before creating,
editing, validating, reviewing, or implementing capability files.
When drafting new capability files from product intent, write the human-authored
spec first and do not invent agent metadata. Use \`capabilitykit format\`,
\`capabilitykit validate\`, \`capabilitykit compile\`, and the review commands in
the full guide to refresh generated metadata and review evidence.
${blockEnd}`;
}

function codexSkillContents(packageSkillPath: string): string {
  return `---
name: capabilitykit
description: Work with CapabilityKit capabilities as code. Use when creating, editing, validating, compiling, reviewing, or comparing .capability.yaml files against agent.implementation.references.
---

# CapabilityKit

${managedBlock(packageSkillPath)}
`;
}

function claudeCommandContents(packageSkillPath: string): string {
  return `${managedBlock(packageSkillPath)}

Help with this CapabilityKit task:

$ARGUMENTS
`;
}

export function mergeManagedBlock(existing: string | undefined, block: string): string {
  const trimmedBlock = block.trim();
  if (!existing || existing.trim().length === 0) {
    return `${trimmedBlock}\n`;
  }

  const pattern = new RegExp(`${escapeRegExp(blockStart)}[\\s\\S]*?${escapeRegExp(blockEnd)}`, "m");
  if (pattern.test(existing)) {
    return existing.replace(pattern, trimmedBlock);
  }

  return `${existing.replace(/\s*$/, "")}\n\n${trimmedBlock}\n`;
}

export function buildCapabilityKitSkillFiles(options: InstallCapabilityKitSkillOptions = {}): SkillInstallFile[] {
  const packageSkillPath = options.packageSkillPath ?? "node_modules/@capabilitykit/cli/SKILL.md";
  const block = managedBlock(packageSkillPath);

  return [
    {
      path: "AGENTS.md",
      contents: block,
      block
    },
    {
      path: "CLAUDE.md",
      contents: block,
      block
    },
    {
      path: ".codex/skills/capabilitykit/SKILL.md",
      contents: codexSkillContents(packageSkillPath),
      block
    },
    {
      path: ".claude/commands/capabilitykit.md",
      contents: claudeCommandContents(packageSkillPath),
      block
    }
  ];
}

export async function installCapabilityKitSkill(
  rootDir: string,
  options: InstallCapabilityKitSkillOptions = {}
): Promise<InstallCapabilityKitSkillResult> {
  const files = buildCapabilityKitSkillFiles(options);
  const written: string[] = [];

  for (const file of files) {
    const filePath = path.join(rootDir, file.path);
    const existing = await readOptional(filePath);
    const nextContents = existing === undefined
      ? file.contents
      : mergeManagedBlock(existing, file.block);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, nextContents);
    written.push(file.path);
  }

  return { written };
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
