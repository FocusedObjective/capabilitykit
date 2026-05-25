import { describe, expect, it } from "vitest";
import { buildCapabilityKitSkillFiles, mergeManagedBlock } from "../src/skillInstall.js";

describe("CapabilityKit skill installation", () => {
  it("creates a managed block for empty agent files", () => {
    const result = mergeManagedBlock(undefined, "<!-- capabilitykit:start -->\nbody\n<!-- capabilitykit:end -->");
    expect(result).toBe("<!-- capabilitykit:start -->\nbody\n<!-- capabilitykit:end -->\n");
  });

  it("appends the managed block without removing existing instructions", () => {
    const result = mergeManagedBlock(
      "Keep existing project instructions.\n",
      "<!-- capabilitykit:start -->\nCapabilityKit instructions\n<!-- capabilitykit:end -->"
    );

    expect(result).toBe(
      "Keep existing project instructions.\n\n<!-- capabilitykit:start -->\nCapabilityKit instructions\n<!-- capabilitykit:end -->\n"
    );
  });

  it("replaces only the existing CapabilityKit managed block", () => {
    const result = mergeManagedBlock(
      "Before\n\n<!-- capabilitykit:start -->\nOld instructions\n<!-- capabilitykit:end -->\n\nAfter\n",
      "<!-- capabilitykit:start -->\nNew instructions\n<!-- capabilitykit:end -->"
    );

    expect(result).toBe("Before\n\n<!-- capabilitykit:start -->\nNew instructions\n<!-- capabilitykit:end -->\n\nAfter\n");
  });

  it("can merge a managed block into an existing skill file", () => {
    const result = mergeManagedBlock(
      "---\nname: existing\n---\n\n# Existing Skill\n\nKeep this workflow.\n",
      "<!-- capabilitykit:start -->\nCapabilityKit reference\n<!-- capabilitykit:end -->"
    );

    expect(result).toContain("# Existing Skill");
    expect(result).toContain("Keep this workflow.");
    expect(result).toContain("CapabilityKit reference");
  });

  it("builds Codex and Claude entrypoints that reference the package skill", () => {
    const files = buildCapabilityKitSkillFiles();
    expect(files.map((file) => file.path)).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      ".codex/skills/capabilitykit/SKILL.md",
      ".claude/commands/capabilitykit.md"
    ]);
    expect(files.every((file) => file.contents.includes("node_modules/@capabilitykit/cli/SKILL.md"))).toBe(true);
    expect(files.every((file) => file.contents.includes("write the human-authored"))).toBe(true);
    expect(files.every((file) => file.contents.includes("do not invent agent metadata"))).toBe(true);
  });
});
