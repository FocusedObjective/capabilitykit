#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import YAML from "yaml";
import { loadCapabilities, validateLoadedCapabilities, writeCompiledCapabilities } from "@capabilitykit/core";

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
  const id = `${slugify(area).replace(/-/g, ".")}.${slugify(name)}`;
  return YAML.stringify({
    id,
    title: name,
    status: "planned",
    area,
    summary: `Describe the ${name} capability.`,
    intent: "Explain why this capability matters to users, maintainers, and AI coding agents.",
    inputs: [],
    outputs: [],
    depends_on: [],
    acceptance: [`${name} has clear acceptance criteria.`],
    verification: {
      automated: [],
      manual: [`Review ${name} behavior against the acceptance criteria.`],
      gaps: ["Add automated tests before marking this capability implemented."]
    },
    implementation: {
      references: []
    },
    agent_guidance: {
      build_notes: ["Update this capability when implementation behavior changes."],
      avoid: ["Do not mark this verified without automated or manual evidence."]
    }
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
      .filter((item) => item.capability.depends_on?.includes(capabilityId))
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
    for (const dependency of match.capability.depends_on ?? []) {
      console.log(`  - ${dependency}`);
    }
    if ((match.capability.depends_on ?? []).length === 0) {
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

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
