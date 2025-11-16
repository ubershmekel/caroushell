import { execSync, spawnSync } from "node:child_process";

const VALID_TYPES = new Set([
  "patch",
  "minor",
  "major",
  "prerelease",
  "prepatch",
  "preminor",
  "premajor",
]);

const rawArg = process.argv[2] ?? "patch";
const normalizedArg = rawArg.toLowerCase();
const semverRegex = /^\d+\.\d+\.\d+(-[\da-z.-]+)?$/i;

const versionArgument = VALID_TYPES.has(normalizedArg)
  ? normalizedArg
  : semverRegex.test(rawArg)
  ? rawArg
  : null;

if (!versionArgument) {
  console.error(
    `Invalid release type "${rawArg}". Use one of ${Array.from(
      VALID_TYPES
    ).join(", ")} or an explicit semver version.`
  );
  process.exit(1);
}

function ensureCleanGitState() {
  try {
    const status = execSync("git status --porcelain", {
      encoding: "utf8",
    }).trim();
    if (status.length > 0) {
      console.error(
        "Working tree is dirty. Commit or stash changes before releasing."
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(
      "Failed to read git status. Is git installed and are you in a git repo?"
    );
    console.error(error);
    process.exit(1);
  }
}

function runStep(command: string, args: string[]) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

ensureCleanGitState();

runStep("npm", ["run", "lint"]);
runStep("npm", ["version", versionArgument]);
runStep("npm", ["run", "build"]);
runStep("npm", ["publish"]);

console.log("\nRelease complete!");
