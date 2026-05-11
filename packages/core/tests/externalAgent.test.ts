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

  it("runs a configured command with the task bundle on stdin", async () => {
    const result = await runExternalAgentCommand({
      command: process.execPath,
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      input: "capability task"
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("capability task");
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
