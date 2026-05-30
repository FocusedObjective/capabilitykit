import { spawn } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type AgentHandoffStrategy = "stdin" | "argument" | "prompt-file";

export interface ExternalAgentCommand {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ExternalAgentRunOptions extends ExternalAgentCommand {
  input: string;
  handoff?: AgentHandoffStrategy;
  promptFilePath?: string;
  transcriptPath?: string;
  dryRun?: boolean;
}

export interface ExternalAgentDetectionResult {
  available: boolean;
  command: string;
  resolvedPath?: string;
  message?: string;
}

export interface ExternalAgentRunResult {
  command: string;
  args: string[];
  handoff: AgentHandoffStrategy;
  detected: ExternalAgentDetectionResult;
  dryRun: boolean;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  transcriptPath?: string;
  promptFilePath?: string;
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? env.Path ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function candidateExtensions(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") {
    return [""];
  }

  const pathext = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = pathext
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);

  return [...extensions, ""];
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function commandName(command: string): string {
  return path.basename(command).replace(/\.(cmd|bat|exe)$/i, "").toLowerCase();
}

async function detectConfiguredCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<ExternalAgentDetectionResult | undefined> {
  const configuredCommandVariable =
    commandName(command) === "codex"
      ? "CAPABILITYKIT_CODEX_COMMAND"
      : commandName(command) === "copilot"
        ? "CAPABILITYKIT_COPILOT_COMMAND"
        : commandName(command) === "pi"
          ? "CAPABILITYKIT_PI_COMMAND"
          : commandName(command) === "claude"
            ? "CAPABILITYKIT_CLAUDE_COMMAND"
            : commandName(command) === "cursor-agent"
              ? "CAPABILITYKIT_CURSOR_COMMAND"
        : undefined;
  if (!configuredCommandVariable) {
    return undefined;
  }

  const configuredCommand = env[configuredCommandVariable]?.trim();
  if (!configuredCommand) {
    return undefined;
  }

  const resolvedPath = path.resolve(cwd, configuredCommand);
  if (await isExecutable(resolvedPath)) {
    return { available: true, command, resolvedPath };
  }

  return {
    available: false,
    command,
    message: `${configuredCommandVariable} is set but was not found or is not executable: ${configuredCommand}`
  };
}

function npmFallbackDirectories(env: NodeJS.ProcessEnv): string[] {
  const directories: string[] = [];

  if (process.platform === "win32") {
    if (env.APPDATA) {
      directories.push(path.join(env.APPDATA, "npm"));
    }
    if (env.LOCALAPPDATA) {
      directories.push(path.join(env.LOCALAPPDATA, "npm"));
    }
    return directories;
  }

  directories.push("/opt/homebrew/bin", "/usr/local/bin");

  const home = env.HOME;
  if (home) {
    directories.push(path.join(home, ".npm-global", "bin"), path.join(home, ".local", "bin"));
  }

  if (env.npm_config_prefix) {
    directories.push(path.join(env.npm_config_prefix, "bin"));
  }

  return directories;
}

export async function detectExternalAgentCommand(
  command: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<ExternalAgentDetectionResult> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  if (!command.trim()) {
    return {
      available: false,
      command,
      message: "No external agent command was provided."
    };
  }

  const configuredCommand = await detectConfiguredCommand(command, env, cwd);
  if (configuredCommand) {
    return configuredCommand;
  }

  if (path.isAbsolute(command) || hasPathSeparator(command)) {
    const resolvedPath = path.resolve(cwd, command);
    if (await isExecutable(resolvedPath)) {
      return { available: true, command, resolvedPath };
    }
    return {
      available: false,
      command,
      message: `External agent command was not found or is not executable: ${command}`
    };
  }

  for (const entry of pathEntries(env)) {
    for (const extension of candidateExtensions(env)) {
      const candidate = path.join(entry, `${command}${extension}`);
      if (await isExecutable(candidate)) {
        return { available: true, command, resolvedPath: candidate };
      }
    }
  }

  if (
    commandName(command) === "codex" ||
    commandName(command) === "copilot" ||
    commandName(command) === "pi" ||
    commandName(command) === "claude" ||
    commandName(command) === "cursor-agent"
  ) {
    for (const entry of npmFallbackDirectories(env)) {
      for (const extension of candidateExtensions(env)) {
        const candidate = path.join(entry, `${command}${extension}`);
        if (await isExecutable(candidate)) {
          return { available: true, command, resolvedPath: candidate };
        }
      }
    }
  }

  return {
    available: false,
    command,
    message:
      commandName(command) === "codex"
        ? `External agent command "codex" was not found on PATH. Install it, pass --agent/--command with a configured executable, or set CAPABILITYKIT_CODEX_COMMAND to the Codex executable path.`
        : commandName(command) === "copilot"
          ? `External agent command "copilot" was not found on PATH. Install @github/copilot, pass --agent/--command with a configured executable, or set CAPABILITYKIT_COPILOT_COMMAND to the GitHub Copilot CLI executable path.`
          : commandName(command) === "pi"
            ? `External agent command "pi" was not found on PATH. Install @earendil-works/pi-coding-agent, pass --agent/--command with a configured executable, or set CAPABILITYKIT_PI_COMMAND to the Pi Coding Agent executable path.`
            : commandName(command) === "claude"
              ? `External agent command "claude" was not found on PATH. Install @anthropic-ai/claude-code, pass --agent/--command with a configured executable, or set CAPABILITYKIT_CLAUDE_COMMAND to the Claude Code executable path.`
              : commandName(command) === "cursor-agent"
                ? `External agent command "cursor-agent" was not found on PATH. Install Cursor CLI from https://cursor.com/install, pass --agent/--command with a configured executable, or set CAPABILITYKIT_CURSOR_COMMAND to the Cursor CLI executable path.`
        : `External agent command "${command}" was not found on PATH. Install it or pass --command with a configured executable.`
  };
}

async function writePromptFile(input: string, promptFilePath?: string, cwd = process.cwd()): Promise<string> {
  const resolvedPath =
    promptFilePath === undefined
      ? path.join(await fs.mkdtemp(path.join(os.tmpdir(), "capabilitykit-agent-")), "prompt.md")
      : path.resolve(cwd, promptFilePath);

  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, input);
  return resolvedPath;
}

function renderTranscript(result: ExternalAgentRunResult): string {
  return [
    `Command: ${[result.command, ...result.args].join(" ")}`,
    `Handoff: ${result.handoff}`,
    `Dry run: ${result.dryRun ? "yes" : "no"}`,
    `Exit code: ${result.exitCode ?? "not run"}`,
    result.promptFilePath ? `Prompt file: ${result.promptFilePath}` : undefined,
    "",
    "## stdout",
    "",
    result.stdout,
    "",
    "## stderr",
    "",
    result.stderr
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

async function writeTranscript(result: ExternalAgentRunResult, transcriptPath: string, cwd = process.cwd()): Promise<string> {
  const resolvedPath = path.resolve(cwd, transcriptPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, renderTranscript({ ...result, transcriptPath: resolvedPath }));
  return resolvedPath;
}

function requiresWindowsCommandShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

export async function runExternalAgentCommand(options: ExternalAgentRunOptions): Promise<ExternalAgentRunResult> {
  const handoff = options.handoff ?? "stdin";
  const cwd = options.cwd ?? process.cwd();
  const args = [...(options.args ?? [])];
  const detected = await detectExternalAgentCommand(options.command, { cwd, env: options.env });
  let promptFilePath: string | undefined;

  if (!detected.available) {
    throw new Error(detected.message ?? `External agent command "${options.command}" is not available.`);
  }

  if (handoff === "prompt-file") {
    promptFilePath = await writePromptFile(options.input, options.promptFilePath, cwd);
    const placeholderIndex = args.indexOf("{promptFile}");
    if (placeholderIndex >= 0) {
      args[placeholderIndex] = promptFilePath;
    } else {
      args.push(promptFilePath);
    }
  }

  if (handoff === "argument") {
    const placeholderIndex = args.indexOf("{prompt}");
    if (placeholderIndex >= 0) {
      args[placeholderIndex] = options.input;
    } else {
      args.push(options.input);
    }
  }

  const baseResult: ExternalAgentRunResult = {
    command: detected.resolvedPath ?? options.command,
    args,
    handoff,
    detected,
    dryRun: Boolean(options.dryRun),
    stdout: "",
    stderr: "",
    promptFilePath
  };

  if (options.dryRun) {
    const result = options.transcriptPath
      ? { ...baseResult, transcriptPath: await writeTranscript(baseResult, options.transcriptPath, cwd) }
      : baseResult;
    return result;
  }

  const runResult = await new Promise<ExternalAgentRunResult>((resolve, reject) => {
    const child = spawn(baseResult.command, args, {
      cwd,
      env: options.env ?? process.env,
      shell: requiresWindowsCommandShell(baseResult.command),
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdinError: string | undefined;

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on("error", (error) => {
      stdinError = error instanceof Error ? error.message : String(error);
    });
    child.on("error", (error) => reject(error));
    child.on("close", (exitCode) => {
      const stderrText = Buffer.concat(stderr).toString("utf8");
      resolve({
        ...baseResult,
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: stdinError ? `${stderrText}${stderrText ? "\n" : ""}stdin: ${stdinError}` : stderrText
      });
    });

    if (handoff === "stdin") {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });

  if (options.transcriptPath) {
    return {
      ...runResult,
      transcriptPath: await writeTranscript(runResult, options.transcriptPath, cwd)
    };
  }

  return runResult;
}
