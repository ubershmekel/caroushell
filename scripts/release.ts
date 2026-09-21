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

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
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
      VALID_TYPES,
    ).join(", ")} or an explicit semver version.`,
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
        "Working tree is dirty. Commit or stash changes before releasing.",
      );
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("detected dubious ownership")) {
      console.error(
        "Git refused to inspect this repository because it is not marked as a safe.directory.",
      );
      console.error(
        "Run `git config --global --add safe.directory .` and try again.",
      );
      process.exit(1);
    }
    console.error(
      "Failed to read git status. Is git installed and are you in a git repo?",
    );
    console.error(error);
    process.exit(1);
  }
}

function git(args: string) {
  return execSync(`git ${args}`, { encoding: "utf8" }).trim();
}

function ensureUpToDateWithUpstream() {
  const branch = git("rev-parse --abbrev-ref HEAD");
  let remote: string;
  try {
    remote = git(`config --get branch.${branch}.remote`);
  } catch {
    console.error(
      `Branch "${branch}" has no upstream remote. Push it once before releasing.`,
    );
    process.exit(1);
  }

  runStep("git", ["fetch", remote, branch]);

  const behind = git(`rev-list --count HEAD..${remote}/${branch}`);
  if (behind !== "0") {
    console.error(
      `Branch "${branch}" is ${behind} commit(s) behind ${remote}/${branch}.`,
    );
    console.error(
      "Pull first, otherwise the version commit cannot be pushed and its tag is left stranded.",
    );
    process.exit(1);
  }

  return { branch, remote };
}

function runStep(command: string, args: string[]) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

ensureCleanGitState();
const { branch, remote } = ensureUpToDateWithUpstream();

runStep(npmCommand, ["run", "lint"]);
runStep(npmCommand, ["run", "test"]);
runStep(npmCommand, ["version", versionArgument]);
runStep(npmCommand, ["run", "build"]);

const tag = git("tag --points-at HEAD")
  .split("\n")
  .find((line) => line.startsWith("v"));
if (!tag) {
  console.error("Could not find the version tag that `npm version` created.");
  process.exit(1);
}

// Push the commit and its tag together. A partial push would publish nothing
// now and, worse, release the stranded tag whenever the next release pushes.
runStep("git", [
  "push",
  "--atomic",
  remote,
  `HEAD:refs/heads/${branch}`,
  `refs/tags/${tag}`,
]);

console.log(
  `\nPushed ${tag} to ${remote}/${branch}. The npm publish workflow takes it from here.`,
);
