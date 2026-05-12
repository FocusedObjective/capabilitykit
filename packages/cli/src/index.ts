#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import YAML from "yaml";
import {
  analyzeCapabilityImpact,
  adviseImplementationCoverage,
  assessImplementationCoverage,
  buildAgentReviewPrompt,
  buildAgentTaskBundle,
  diffCapabilities,
  formatCapabilityImpactReport,
  formatCapabilityDiffReport,
  formatCapabilityStatusReport,
  formatAssessmentAdviceReport,
  formatImplementationCoverageReport,
  loadCapabilities,
  runExternalAgentCommand,
  saveAgentReviewResult,
  summarizeCapabilityStatus,
  syncReviewEvidence,
  validateAgentReviewResult,
  validateLoadedCapabilities,
  writeCompiledCapabilities,
  formatSyncReviewEvidenceReport
} from "@capabilitykit/core";
import { installCapabilityKitSkill } from "./skillInstall.js";

const program = new Command();

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeNewFile(filePath: string, contents: string, force = false): Promise<void> {
  if (!force && (await exists(filePath))) {
    throw new Error(`${path.relative(process.cwd(), filePath)} already exists. Pass --force to overwrite.`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

function capabilityTemplate(name: string, area: string): string {
  return YAML.stringify({
    title: name,
    status: "planned",
    area,
    summary: `Describe the ${name} capability.`,
    intent: "Explain why this capability matters to users, maintainers, and AI coding agents.",
    acceptance: [`${name} has clear acceptance criteria.`],
    guidance: ["Keep implementation and tests aligned with this capability."]
  });
}

function printValidationReport(result: ReturnType<typeof validateLoadedCapabilities>): void {
  console.log("CapabilityKit validation");
  console.log("");
  console.log(`${result.errors.length === 0 ? "OK" : "!!"} ${result.parsedCount} capabilities parsed`);
  console.log(`${result.errors.length === 0 ? "OK" : "!!"} ${result.uniqueIdCount} unique IDs`);

  if (result.errors.length > 0) {
    console.log("");
    console.log("Errors:");
    for (const error of result.errors) {
      console.log(`  - ${error.message}${error.filePath ? ` (${path.relative(process.cwd(), error.filePath)})` : ""}`);
    }
  }

  if (result.verificationGaps.length > 0) {
    console.log("");
    console.log("Verification gaps:");
    for (const gap of result.verificationGaps) {
      console.log(`  - ${gap.message}`);
    }
  }

  console.log("");
  console.log(
    `Result: ${result.valid ? "valid" : "invalid"}${
      result.verificationGaps.length > 0 ? ` with ${result.verificationGaps.length} verification gaps` : ""
    }`
  );
}

function printReviewResult(result: Awaited<ReturnType<typeof validateAgentReviewResult>>): void {
  console.log("CapabilityKit review result");
  console.log("");
  console.log(`${result.valid ? "OK" : "!!"} ${result.review.criteria.length} criteria reviewed`);
  console.log(`Depth: ${result.depth}`);
  console.log(`Done: ${result.review.done ? "yes" : "no"}`);

  if (result.review.remaining_gaps.length > 0) {
    console.log("");
    console.log("Remaining gaps:");
    for (const gap of result.review.remaining_gaps) {
      console.log(`  - ${gap}`);
    }
  }

  if (result.issues.length > 0) {
    console.log("");
    console.log("Issues:");
    for (const issue of result.issues) {
      console.log(`  - ${issue.message}`);
    }
  }
}

function parseAgentTaskMode(value: string): "implement" | "review" {
  if (value === "implement" || value === "review") {
    return value;
  }
  throw new Error(`Invalid agent task mode "${value}". Expected "implement" or "review".`);
}

function parseAgentHandoff(value: string): "stdin" | "argument" | "prompt-file" {
  if (value === "stdin" || value === "argument" || value === "prompt-file") {
    return value;
  }
  throw new Error(`Invalid agent handoff "${value}". Expected "stdin", "argument", or "prompt-file".`);
}

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

type AdviceReport = Awaited<ReturnType<typeof adviseImplementationCoverage>>;

function noisyScore(capability: AdviceReport["capabilities"][number]): number {
  return capability.criteria.reduce((score, criterion) => {
    if (criterion.status === "assessor-limitation") {
      return score + 4;
    }
    if (criterion.status === "weak-evidence") {
      return score + 2;
    }
    if (criterion.status === "implementation-gap") {
      return score + 1;
    }
    return score;
  }, 0);
}

function noisyCandidates(report: AdviceReport, limit: number): Array<AdviceReport["capabilities"][number] & { score: number }> {
  return report.capabilities
    .map((capability) => ({ ...capability, score: noisyScore(capability) }))
    .filter((capability) => capability.score > 0)
    .sort((a, b) => b.score - a.score || a.capabilityId.localeCompare(b.capabilityId))
    .slice(0, limit);
}

function formatReviewNoisy(report: AdviceReport, limit: number, command: string): string {
  const candidates = noisyCandidates(report, limit);
  const lines = ["CapabilityKit noisy review candidates", "", `Candidates: ${candidates.length}`];

  for (const candidate of candidates) {
    const weak = candidate.criteria.filter((criterion) => criterion.status === "weak-evidence").length;
    const limitations = candidate.criteria.filter((criterion) => criterion.status === "assessor-limitation").length;
    const gaps = candidate.criteria.filter((criterion) => criterion.status === "implementation-gap").length;
    lines.push(
      "",
      `${candidate.capabilityId}`,
      `  Score: ${candidate.score}`,
      `  Weak evidence: ${weak}`,
      `  Assessor limitations: ${limitations}`,
      `  Implementation gaps: ${gaps}`,
      `  Review command: capabilitykit agent-review ${candidate.capabilityId} --command ${command} --handoff stdin`
    );
  }

  return `${lines.join("\n")}\n`;
}

program
  .name("capabilitykit")
  .description("Capabilities as code for AI-native software teams")
  .version("0.1.0");

program
  .command("init")
  .description("Create a starter .capabilities folder")
  .option("--force", "overwrite existing files")
  .action(async (options: { force?: boolean }) => {
    const root = process.cwd();
    const configPath = path.join(root, ".capabilities", "capabilitykit.yaml");
    const examplePath = path.join(root, ".capabilities", "example.capability.yaml");

    const config = YAML.stringify({
      schema_version: "0.1",
      project: {
        name: path.basename(root),
        description: "Capabilities as code for this repository."
      },
      source: {
        include: ["**/*.capability.yaml"],
        exclude: ["dist/**"]
      },
      validation: {
        require_acceptance: true,
        require_verification: true,
        allow_verification_gaps: true,
        require_implementation_references_for_status: ["implemented", "verified"]
      },
      output: {
        path: ".capabilities/dist/capabilities.json"
      }
    });

    await writeNewFile(configPath, config, options.force);
    await writeNewFile(examplePath, capabilityTemplate("Example capability", "example"), options.force);

    console.log("Created .capabilities/");
    console.log("Created .capabilities/capabilitykit.yaml");
    console.log("Created .capabilities/example.capability.yaml");
    console.log("");
    console.log("Next steps:");
    console.log('  capabilitykit create "User login" --area account');
    console.log("  capabilitykit validate");
    console.log("  capabilitykit compile");
  });

program
  .command("create")
  .description("Create a capability YAML file")
  .argument("<name>", "capability name")
  .option("--area <area>", "capability area", "general")
  .option("--force", "overwrite existing files")
  .action(async (name: string, options: { area: string; force?: boolean }) => {
    const filePath = path.join(process.cwd(), ".capabilities", slugify(options.area), `${slugify(name)}.capability.yaml`);
    await writeNewFile(filePath, capabilityTemplate(name, options.area), options.force);
    console.log(`Created ${path.relative(process.cwd(), filePath)}`);
  });

program
  .command("skill")
  .description("Create or update CapabilityKit skill files and agent entrypoints")
  .option(
    "--skill-path <path>",
    "path agents should read for the full CapabilityKit guide",
    "node_modules/@capabilitykit/cli/SKILL.md"
  )
  .action(async (options: { skillPath: string }) => {
    const result = await installCapabilityKitSkill(process.cwd(), { packageSkillPath: options.skillPath });
    console.log("Installed CapabilityKit skill:");
    for (const filePath of result.written) {
      console.log(`  - ${filePath}`);
    }
    console.log("");
    console.log("Try:");
    console.log("  /capabilitykit review .capabilities/core/validation/verify-implementation-references.capability.yaml");
    console.log("  Ask Codex: review this capability against its agent.implementation.references");
  });

program
  .command("status")
  .description("Show a developer-friendly capability health summary")
  .argument("[capability-id]", "optional capability id")
  .option("--json", "print the status report as JSON")
  .action(async (capabilityId: string | undefined, options: { json?: boolean }) => {
    const report = await summarizeCapabilityStatus(process.cwd(), capabilityId);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(formatCapabilityStatusReport(report));
  });

program
  .command("validate")
  .description("Validate capability files")
  .action(async () => {
    const loaded = await loadCapabilities(process.cwd());
    const result = validateLoadedCapabilities(loaded);
    printValidationReport(result);
    process.exitCode = result.valid ? 0 : 1;
  });

program
  .command("compile")
  .description("Compile capabilities to normalized JSON")
  .action(async () => {
    const { outputPath, compiled } = await writeCompiledCapabilities(process.cwd());
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
    console.log(`Compiled ${compiled.capabilities.length} capabilities with ${compiled.verification_summary.gaps} verification gaps`);
    process.exitCode = compiled.validation.valid ? 0 : 1;
  });

program
  .command("inspect")
  .description("Inspect a capability and its relationships")
  .argument("<capability-id>", "capability id")
  .action(async (capabilityId: string) => {
    const loaded = await loadCapabilities(process.cwd());
    const match = loaded.capabilities.find((item) => item.capability.id === capabilityId);
    if (!match) {
      console.error(`Capability not found: ${capabilityId}`);
      process.exitCode = 1;
      return;
    }

    const result = validateLoadedCapabilities(loaded);
    const dependents = loaded.capabilities
      .filter((item) => item.capability.agent?.depends_on?.includes(capabilityId))
      .map((item) => item.capability.id);
    const gaps = result.verificationGaps.filter((gap) => gap.capabilityId === capabilityId);

    console.log(`${match.capability.title} (${match.capability.id})`);
    console.log(`Status: ${match.capability.status}`);
    console.log(`Area: ${match.capability.area}`);
    console.log(`Path: .capabilities/${match.relativePath}`);
    console.log("");
    console.log(match.capability.summary);
    console.log("");
    console.log("Dependencies:");
    for (const dependency of match.capability.agent?.depends_on ?? []) {
      console.log(`  - ${dependency}`);
    }
    if ((match.capability.agent?.depends_on ?? []).length === 0) {
      console.log("  - none");
    }
    console.log("Dependents:");
    for (const dependent of dependents) {
      console.log(`  - ${dependent}`);
    }
    if (dependents.length === 0) {
      console.log("  - none");
    }
    console.log("Verification gaps:");
    for (const gap of gaps) {
      console.log(`  - ${gap.message}`);
    }
    if (gaps.length === 0) {
      console.log("  - none");
    }
  });

program
  .command("impact")
  .description("Analyze downstream capability impact")
  .argument("<capability-id>", "capability id")
  .option("--json", "print the impact report as JSON")
  .action(async (capabilityId: string, options: { json?: boolean }) => {
    const report = await analyzeCapabilityImpact(process.cwd(), capabilityId);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(formatCapabilityImpactReport(report));
  });

program
  .command("diff")
  .description("Compare capability changes against a Git base")
  .argument("[capability-id]", "optional capability id")
  .option("--base <ref>", "git ref to compare against", "HEAD")
  .option("--include-review", "include saved agent.review evidence changes")
  .option("--verbose", "print field-level capability diffs")
  .option("--json", "print the diff report as JSON")
  .action(
    async (
      capabilityId: string | undefined,
      options: { base: string; includeReview?: boolean; verbose?: boolean; json?: boolean }
    ) => {
      const report = await diffCapabilities(process.cwd(), {
        base: options.base,
        capabilityId,
        includeReview: options.includeReview
      });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(formatCapabilityDiffReport(report, { verbose: options.verbose }));
    }
  );

program
  .command("assess")
  .description("Assess implementation coverage for a capability")
  .argument("<capability-id>", "capability id")
  .option("--json", "print the coverage report as JSON")
  .action(async (capabilityId: string, options: { json?: boolean }) => {
    const report = await assessImplementationCoverage(process.cwd(), capabilityId);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(formatImplementationCoverageReport(report));
  });

program
  .command("advise")
  .description("Assess capability coverage and recommend next actions")
  .argument("[capability-id]", "optional capability id")
  .option("--json", "print the advisory report as JSON")
  .action(async (capabilityId: string | undefined, options: { json?: boolean }) => {
    const report = await adviseImplementationCoverage(process.cwd(), capabilityId);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(formatAssessmentAdviceReport(report));
  });

program
  .command("review-noisy")
  .description("List high-value capabilities for Codex or human semantic review")
  .option("--limit <count>", "maximum candidates to list", "5")
  .option("--command <command>", "agent-review executable to show in suggested commands", "codex")
  .option("--json", "print candidates as JSON")
  .action(async (options: { limit: string; command: string; json?: boolean }) => {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Invalid limit "${options.limit}". Expected a positive integer.`);
    }

    const report = await adviseImplementationCoverage(process.cwd());
    const candidates = noisyCandidates(report, limit);
    if (options.json) {
      console.log(JSON.stringify(candidates, null, 2));
      return;
    }

    console.log(formatReviewNoisy(report, limit, options.command));
  });

program
  .command("agent-task")
  .description("Generate a prompt bundle for an external coding agent")
  .argument("<capability-id>", "capability id")
  .option("--mode <mode>", "task mode: implement or review", "implement")
  .option("--no-references", "omit implementation reference file contents")
  .option("--output <path>", "write the prompt bundle to a file instead of stdout")
  .action(
    async (
      capabilityId: string,
      options: { mode: string; references: boolean; output?: string }
    ) => {
      const bundle = await buildAgentTaskBundle(process.cwd(), capabilityId, {
        mode: parseAgentTaskMode(options.mode),
        includeReferences: options.references
      });

      if (options.output) {
        const outputPath = path.resolve(process.cwd(), options.output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, bundle.prompt);
        console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
        if (bundle.missingReferences.length > 0) {
          console.log(`Missing references: ${bundle.missingReferences.join(", ")}`);
        }
        return;
      }

      console.log(bundle.prompt);
      if (bundle.missingReferences.length > 0) {
        console.error(`Missing references: ${bundle.missingReferences.join(", ")}`);
      }
    }
  );

program
  .command("agent-run")
  .description("Run an external coding-agent command with a generated capability task bundle")
  .argument("<capability-id>", "capability id")
  .requiredOption("--command <command>", "external agent executable to run")
  .option("--arg <value>", "argument to pass to the external agent command; repeat for multiple args", collectOption, [])
  .option("--mode <mode>", "task mode: implement or review", "implement")
  .option("--handoff <strategy>", "bundle handoff strategy: stdin, argument, or prompt-file", "stdin")
  .option("--prompt-file <path>", "prompt file path for prompt-file handoff")
  .option("--transcript <path>", "write stdout, stderr, exit code, and handoff details to a transcript file")
  .option("--no-references", "omit implementation reference file contents")
  .option("--dry-run", "detect the command and prepare handoff files without running the external agent")
  .action(
    async (
      capabilityId: string,
      options: {
        command: string;
        arg: string[];
        mode: string;
        handoff: string;
        promptFile?: string;
        transcript?: string;
        references: boolean;
        dryRun?: boolean;
      }
    ) => {
      const bundle = await buildAgentTaskBundle(process.cwd(), capabilityId, {
        mode: parseAgentTaskMode(options.mode),
        includeReferences: options.references
      });

      const result = await runExternalAgentCommand({
        command: options.command,
        args: options.arg,
        cwd: process.cwd(),
        input: bundle.prompt,
        handoff: parseAgentHandoff(options.handoff),
        promptFilePath: options.promptFile,
        transcriptPath: options.transcript,
        dryRun: options.dryRun
      });

      console.log(`Command: ${[result.command, ...result.args].join(" ")}`);
      console.log(`Handoff: ${result.handoff}`);
      if (result.promptFilePath) {
        console.log(`Prompt file: ${path.relative(process.cwd(), result.promptFilePath)}`);
      }
      if (result.dryRun) {
        console.log("Result: dry run");
      } else {
        console.log(`Exit code: ${result.exitCode ?? "unknown"}`);
      }
      if (result.transcriptPath) {
        console.log(`Transcript: ${path.relative(process.cwd(), result.transcriptPath)}`);
      }
      if (result.stdout.trim()) {
        console.log("");
        console.log(result.stdout.trimEnd());
      }
      if (result.stderr.trim()) {
        console.error("");
        console.error(result.stderr.trimEnd());
      }

      if (!result.dryRun && result.exitCode !== 0) {
        process.exitCode = result.exitCode ?? 1;
      }
    }
  );

program
  .command("agent-review")
  .description("Ask an external agent to review a capability against implementation evidence")
  .argument("<capability-id>", "capability id")
  .requiredOption("--command <command>", "external agent executable to run")
  .option("--arg <value>", "argument to pass to the external agent command; repeat for multiple args", collectOption, [])
  .option("--handoff <strategy>", "bundle handoff strategy: stdin, argument, or prompt-file", "stdin")
  .option("--prompt-file <path>", "prompt file path for prompt-file handoff")
  .option("--transcript <path>", "write stdout, stderr, exit code, and handoff details to a transcript file")
  .option("--output-prompt <path>", "write the generated review prompt to a file")
  .option("--no-references", "omit implementation reference file contents")
  .option("--dry-run", "detect the command and prepare handoff files without running the external agent")
  .action(
    async (
      capabilityId: string,
      options: {
        command: string;
        arg: string[];
        handoff: string;
        promptFile?: string;
        transcript?: string;
        outputPrompt?: string;
        references: boolean;
        dryRun?: boolean;
      }
    ) => {
      const review = await buildAgentReviewPrompt(process.cwd(), capabilityId, {
        includeReferences: options.references
      });

      if (options.outputPrompt) {
        const outputPath = path.resolve(process.cwd(), options.outputPrompt);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, review.prompt);
        console.log(`Review prompt: ${path.relative(process.cwd(), outputPath)}`);
      }

      const result = await runExternalAgentCommand({
        command: options.command,
        args: options.arg,
        cwd: process.cwd(),
        input: review.prompt,
        handoff: parseAgentHandoff(options.handoff),
        promptFilePath: options.promptFile,
        transcriptPath: options.transcript,
        dryRun: options.dryRun
      });

      console.log(`Command: ${[result.command, ...result.args].join(" ")}`);
      console.log(`Handoff: ${result.handoff}`);
      if (result.promptFilePath) {
        console.log(`Prompt file: ${path.relative(process.cwd(), result.promptFilePath)}`);
      }
      if (result.dryRun) {
        console.log("Result: dry run");
      } else {
        console.log(`Exit code: ${result.exitCode ?? "unknown"}`);
      }
      if (result.transcriptPath) {
        console.log(`Transcript: ${path.relative(process.cwd(), result.transcriptPath)}`);
      }
      if (review.missingReferences.length > 0) {
        console.log(`Missing references: ${review.missingReferences.join(", ")}`);
      }
      if (result.stdout.trim()) {
        console.log("");
        console.log(result.stdout.trimEnd());
      }
      if (result.stderr.trim()) {
        console.error("");
        console.error(result.stderr.trimEnd());
      }

      if (!result.dryRun && result.exitCode !== 0) {
        process.exitCode = result.exitCode ?? 1;
      }
    }
  );

program
  .command("review-result")
  .description("Validate or save structured agent review output for a capability")
  .argument("<capability-id>", "capability id")
  .requiredOption("--input <path>", "path to the agent review JSON output")
  .option("--save", "save valid review output to the capability agent.review field")
  .option("--json", "print validation result as JSON")
  .action(async (capabilityId: string, options: { input: string; save?: boolean; json?: boolean }) => {
    const inputPath = path.resolve(process.cwd(), options.input);
    const source = await fs.readFile(inputPath, "utf8");

    if (options.save) {
      const result = await saveAgentReviewResult(process.cwd(), capabilityId, source);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printReviewResult(result.validation);
        if (result.validation.valid) {
          console.log(`Saved review evidence to ${path.relative(process.cwd(), result.filePath)}`);
        }
      }
      process.exitCode = result.validation.valid ? 0 : 1;
      return;
    }

    const loaded = await loadCapabilities(process.cwd());
    const match = loaded.capabilities.find((item) => item.capability.id === capabilityId);
    if (!match) {
      console.error(`Capability not found: ${capabilityId}`);
      process.exitCode = 1;
      return;
    }

    const validation = await validateAgentReviewResult(process.cwd(), match.capability, source);
    if (options.json) {
      console.log(JSON.stringify(validation, null, 2));
    } else {
      printReviewResult(validation);
    }
    process.exitCode = validation.valid ? 0 : 1;
  });

program
  .command("sync-review")
  .description("Update agent.review from current implementation evidence without changing capability status")
  .argument("[capability-id]", "optional capability id")
  .option("--dry-run", "show what would be updated without writing files")
  .option("--json", "print the sync result as JSON")
  .action(async (capabilityId: string | undefined, options: { dryRun?: boolean; json?: boolean }) => {
    const result = await syncReviewEvidence(process.cwd(), capabilityId, { dryRun: options.dryRun });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatSyncReviewEvidenceReport(result));
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
