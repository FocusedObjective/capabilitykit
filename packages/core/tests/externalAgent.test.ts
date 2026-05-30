import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectExternalAgentCommand, runExternalAgentCommand } from "../src/externalAgent.js";

const tempDirs: string[] = [];

async function createExecutable(name: string, source: string): Promise<{ rootDir: string; commandPath: string }> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "capabilitykit-external-agent-"));
  tempDirs.push(rootDir);
  const commandPath = path.join(rootDir, name);
  await writeFile(commandPath, source);
  if (process.platform !== "win32") {
    await chmod(commandPath, 0o755);
  }
  return { rootDir, commandPath };
}

describe("external agent command runner", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("detects a configured command on PATH", async () => {
    const scriptName = process.platform === "win32" ? "agent.cmd" : "agent";
    const { rootDir } = await createExecutable(
      scriptName,
      process.platform === "win32" ? "@echo off\r\necho agent\r\n" : "#!/bin/sh\necho agent\n"
    );

    const result = await detectExternalAgentCommand("agent", {
      env: { PATH: rootDir, PATHEXT: ".CMD" }
    });

    expect(result.available).toBe(true);
    expect(result.resolvedPath).toContain("agent");
  });

  it("returns an actionable result for a missing command", async () => {
    const result = await detectExternalAgentCommand("missing-capabilitykit-agent", {
      env: { PATH: "" }
    });

    expect(result.available).toBe(false);
    expect(result.message).toContain("was not found on PATH");
  });

  it("detects Codex from an explicit override when it is not on PATH", async () => {
    const scriptName = process.platform === "win32" ? "codex.cmd" : "codex";
    const { commandPath } = await createExecutable(
      scriptName,
      process.platform === "win32" ? "@echo off\r\necho codex\r\n" : "#!/bin/sh\necho codex\n"
    );

    const result = await detectExternalAgentCommand("codex", {
      env: { PATH: "", CAPABILITYKIT_CODEX_COMMAND: commandPath }
    });

    expect(result.available).toBe(true);
    expect(result.resolvedPath).toBe(commandPath);
  });

  it("explains the Codex override when Codex is missing", async () => {
    const result = await detectExternalAgentCommand("codex", {
      env: { PATH: "" }
    });

    expect(result.available).toBe(false);
    expect(result.message).toContain("CAPABILITYKIT_CODEX_COMMAND");
  });

  it("detects GitHub Copilot CLI from an explicit override when it is not on PATH", async () => {
    const scriptName = process.platform === "win32" ? "copilot.cmd" : "copilot";
    const { commandPath } = await createExecutable(
      scriptName,
      process.platform === "win32" ? "@echo off\r\necho copilot\r\n" : "#!/bin/sh\necho copilot\n"
    );

    const result = await detectExternalAgentCommand("copilot", {
      env: { PATH: "", CAPABILITYKIT_COPILOT_COMMAND: commandPath }
    });

    expect(result.available).toBe(true);
    expect(result.resolvedPath).toBe(commandPath);
  });

  it("explains the GitHub Copilot CLI override when Copilot is missing", async () => {
    const result = await detectExternalAgentCommand("copilot", {
      env: { PATH: "" }
    });

    expect(result.available).toBe(false);
    expect(result.message).toContain("CAPABILITYKIT_COPILOT_COMMAND");
    expect(result.message).toContain("@github/copilot");
  });

  it("detects Pi Coding Agent from an explicit override when it is not on PATH", async () => {
    const scriptName = process.platform === "win32" ? "pi.cmd" : "pi";
    const { commandPath } = await createExecutable(
      scriptName,
      process.platform === "win32" ? "@echo off\r\necho pi\r\n" : "#!/bin/sh\necho pi\n"
    );

    const result = await detectExternalAgentCommand("pi", {
      env: { PATH: "", CAPABILITYKIT_PI_COMMAND: commandPath }
    });

    expect(result.available).toBe(true);
    expect(result.resolvedPath).toBe(commandPath);
  });

  it("explains the Pi Coding Agent override when Pi is missing", async () => {
    const result = await detectExternalAgentCommand("pi", {
      env: { PATH: "" }
    });

    expect(result.available).toBe(false);
    expect(result.message).toContain("CAPABILITYKIT_PI_COMMAND");
    expect(result.message).toContain("@earendil-works/pi-coding-agent");
  });

  it("detects Claude Code from an explicit override when it is not on PATH", async () => {
    const scriptName = process.platform === "win32" ? "claude.cmd" : "claude";
    const { commandPath } = await createExecutable(
      scriptName,
      process.platform === "win32" ? "@echo off\r\necho claude\r\n" : "#!/bin/sh\necho claude\n"
    );

    const result = await detectExternalAgentCommand("claude", {
      env: { PATH: "", CAPABILITYKIT_CLAUDE_COMMAND: commandPath }
    });

    expect(result.available).toBe(true);
    expect(result.resolvedPath).toBe(commandPath);
  });

  it("explains the Claude Code override when Claude is missing", async () => {
    const result = await detectExternalAgentCommand("claude", {
      env: { PATH: "" }
    });

    expect(result.available).toBe(false);
    expect(result.message).toContain("CAPABILITYKIT_CLAUDE_COMMAND");
    expect(result.message).toContain("@anthropic-ai/claude-code");
  });

  it("detects Cursor CLI from an explicit override when it is not on PATH", async () => {
    const scriptName = process.platform === "win32" ? "cursor-agent.cmd" : "cursor-agent";
    const { commandPath } = await createExecutable(
      scriptName,
      process.platform === "win32" ? "@echo off\r\necho cursor-agent\r\n" : "#!/bin/sh\necho cursor-agent\n"
    );

    const result = await detectExternalAgentCommand("cursor-agent", {
      env: { PATH: "", CAPABILITYKIT_CURSOR_COMMAND: commandPath }
    });

    expect(result.available).toBe(true);
    expect(result.resolvedPath).toBe(commandPath);
  });

  it("explains the Cursor CLI override when Cursor is missing", async () => {
    const result = await detectExternalAgentCommand("cursor-agent", {
      env: { PATH: "" }
    });

    expect(result.available).toBe(false);
    expect(result.message).toContain("CAPABILITYKIT_CURSOR_COMMAND");
    expect(result.message).toContain("https://cursor.com/install");
  });

  it("runs a configured command with the task bundle on stdin", async () => {
    const result = await runExternalAgentCommand({
      command: process.execPath,
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      input: "capability task"
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("capability task");
  });

  it("captures stdin write errors when the command exits before reading input", async () => {
    const result = await runExternalAgentCommand({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      input: "capability task".repeat(10000)
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("stdin:");
  });

  it("prepares prompt-file handoff during dry runs", async () => {
    const scriptName = process.platform === "win32" ? "dry-agent.cmd" : "dry-agent";
    const { rootDir, commandPath } = await createExecutable(
      scriptName,
      process.platform === "win32" ? "@echo off\r\necho should not run\r\n" : "#!/bin/sh\necho should not run\n"
    );

    const result = await runExternalAgentCommand({
      command: commandPath,
      input: "prompt file task",
      handoff: "prompt-file",
      promptFilePath: "tmp/prompt.md",
      transcriptPath: "tmp/transcript.md",
      cwd: rootDir,
      dryRun: true
    });

    expect(result.dryRun).toBe(true);
    expect(result.args).toEqual([path.join(rootDir, "tmp", "prompt.md")]);
    expect(await readFile(path.join(rootDir, "tmp", "prompt.md"), "utf8")).toBe("prompt file task");
    expect(await readFile(path.join(rootDir, "tmp", "transcript.md"), "utf8")).toContain("Dry run: yes");
  });

  it("passes the task bundle as an argument", async () => {
    const result = await runExternalAgentCommand({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", "{prompt}"],
      input: "argument task",
      handoff: "argument"
    });

    expect(result.exitCode).toBe(0);
    expect(result.args).toEqual(["-e", "process.stdout.write(process.argv[1])", "argument task"]);
    expect(result.stdout).toBe("argument task");
  });

  it.runIf(process.platform === "win32")("runs a Windows command shim", async () => {
    const { commandPath } = await createExecutable("shim.cmd", "@echo off\r\necho %*\r\n");

    const result = await runExternalAgentCommand({
      command: commandPath,
      args: ["{prompt}"],
      input: "shim task",
      handoff: "argument"
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("shim task");
  });
});
