import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const workspacePackages = [
  {
    name: "@capabilitykit/core",
    packagePath: "packages/core/package.json",
    lockPath: "packages/core",
  },
  {
    name: "@capabilitykit/cli",
    packagePath: "packages/cli/package.json",
    lockPath: "packages/cli",
  },
];

const usage = `Usage:
  npm run release:prep -- <patch|minor|major|version> [options]

Options:
  --allow-dirty    Allow release prep when the git working tree is already dirty.
  --skip-verify    Do not run npm run verify.
  --skip-pack      Do not run npm pack dry-runs for the workspaces.
  --files-only     Update release files, then stop before commit, tag, and push.
  --help           Show this message.

Examples:
  npm run release:prep -- patch
  npm run release:prep -- minor -- --skip-verify
  npm run release:prep -- 0.2.0
  npm run release:prep:files -- patch
`;

const args = process.argv.slice(2);
const bump = args.find((arg) => !arg.startsWith("--"));
const options = new Set(args.filter((arg) => arg.startsWith("--")));

if (!bump || options.has("--help")) {
  console.log(usage);
  process.exit(bump ? 0 : 1);
}

for (const option of options) {
  if (
    !["--allow-dirty", "--skip-verify", "--skip-pack", "--files-only", "--help"].includes(option)
  ) {
    fail(`Unknown option: ${option}\n\n${usage}`);
  }
}

if (!options.has("--allow-dirty")) {
  const status = run("git", ["status", "--porcelain"], { capture: true });
  if (status.stdout.trim()) {
    fail(
      "Working tree is dirty. Commit or stash current work before release prep, or rerun with --allow-dirty.",
    );
  }
}

const packages = workspacePackages.map((workspacePackage) => ({
  ...workspacePackage,
  json: readJson(workspacePackage.packagePath),
}));

const currentVersions = new Set(packages.map((workspacePackage) => workspacePackage.json.version));
if (currentVersions.size !== 1) {
  fail(
    `Workspace package versions must match before release prep. Found: ${packages
      .map((workspacePackage) => `${workspacePackage.name}@${workspacePackage.json.version}`)
      .join(", ")}`,
  );
}

const currentVersion = packages[0].json.version;
const nextVersion = resolveNextVersion(currentVersion, bump);

for (const workspacePackage of packages) {
  workspacePackage.json.version = nextVersion;
}

const cliPackage = packages.find((workspacePackage) => workspacePackage.name === "@capabilitykit/cli");
if (!cliPackage.json.dependencies?.["@capabilitykit/core"]) {
  fail("packages/cli/package.json must depend on @capabilitykit/core.");
}
cliPackage.json.dependencies["@capabilitykit/core"] = `^${nextVersion}`;

for (const workspacePackage of packages) {
  writeJson(workspacePackage.packagePath, workspacePackage.json);
}

updatePackageLock(nextVersion);

if (!options.has("--skip-verify")) {
  run("npm", ["run", "verify"]);
}

if (!options.has("--skip-pack")) {
  for (const workspacePackage of packages) {
    run("npm", ["pack", "--workspace", workspacePackage.name, "--dry-run"]);
  }
}

console.log(`\nPrepared release ${nextVersion}.`);

if (options.has("--files-only")) {
  printManualCommands(nextVersion);
  process.exit(0);
}

const status = run("git", ["status", "--short"], { capture: true }).stdout.trim();
if (status) {
  console.log("\nPending changes:");
  console.log(status);
}

const shouldPublish = await confirm(
  `\nCommit release ${nextVersion}, create tag v${nextVersion}, and push main with tags? [y/N] `,
);

if (!shouldPublish) {
  printManualCommands(nextVersion);
  process.exit(0);
}

run("git", ["add", "package-lock.json", "packages/core/package.json", "packages/cli/package.json"]);
run("git", ["commit", "-m", `Release ${nextVersion}`]);
run("git", ["tag", "-a", `v${nextVersion}`, "-m", `Release ${nextVersion}`]);
run("git", ["push", "origin", "main", "--follow-tags"]);

console.log(`\nRelease ${nextVersion} pushed. Monitor the publish workflow:`);
console.log("  https://github.com/FocusedObjective/capabilitykit/actions");

function resolveNextVersion(currentVersion, bumpTypeOrVersion) {
  const exactVersion = parseVersion(bumpTypeOrVersion);
  if (exactVersion) {
    return formatVersion(exactVersion);
  }

  const current = parseVersion(currentVersion);
  if (!current) {
    fail(`Current package version is not a simple semver version: ${currentVersion}`);
  }

  if (bumpTypeOrVersion === "patch") {
    current.patch += 1;
  } else if (bumpTypeOrVersion === "minor") {
    current.minor += 1;
    current.patch = 0;
  } else if (bumpTypeOrVersion === "major") {
    current.major += 1;
    current.minor = 0;
    current.patch = 0;
  } else {
    fail(`Expected patch, minor, major, or an exact version. Received: ${bumpTypeOrVersion}`);
  }

  return formatVersion(current);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function updatePackageLock(nextVersion) {
  const lock = readJson("package-lock.json");

  for (const workspacePackage of workspacePackages) {
    const lockPackage = lock.packages?.[workspacePackage.lockPath];
    if (!lockPackage) {
      fail(`package-lock.json is missing ${workspacePackage.lockPath}.`);
    }
    lockPackage.version = nextVersion;
  }

  const cliLockPackage = lock.packages["packages/cli"];
  if (!cliLockPackage.dependencies?.["@capabilitykit/core"]) {
    fail("package-lock.json packages/cli entry must depend on @capabilitykit/core.");
  }
  cliLockPackage.dependencies["@capabilitykit/core"] = `^${nextVersion}`;

  writeJson("package-lock.json", lock);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function confirm(question) {
  if (!process.stdin.isTTY) {
    console.log("Non-interactive shell detected; skipping commit, tag, and push.");
    return false;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function printManualCommands(nextVersion) {
  console.log("\nRelease files are prepared. To finish manually, run:");
  console.log("  git add package-lock.json packages/core/package.json packages/cli/package.json");
  console.log(`  git commit -m "Release ${nextVersion}"`);
  console.log(`  git tag -a v${nextVersion} -m "Release ${nextVersion}"`);
  console.log("  git push origin main --follow-tags");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(" ")}`);
  }

  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
