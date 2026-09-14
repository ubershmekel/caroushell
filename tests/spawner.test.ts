import assert from "node:assert/strict";
import { accessSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runUserCommand } from "../src/spawner";
import { makeTempDirectory } from "./helpers/temp-directory";

const tmpSuffix = "caroushell-test";

void test("multiline commands execute every line in order, including after a builtin", async () => {
  const original = process.cwd();
  const base = await makeTempDirectory(tmpSuffix);
  try {
    process.chdir(base);
    await runUserCommand(
      "cd .\n\necho first>result.txt\n\necho second>>result.txt",
    );
    assert.equal(
      (await readFile("result.txt", "utf8")).replace(/\r/g, ""),
      "first\nsecond\n",
    );
  } finally {
    process.chdir(original);
    await rm(base, { recursive: true, force: true });
  }
});

void test("Windows multiline scripts preserve variables and execute directory listings", async (t) => {
  if (process.platform !== "win32") return t.skip("cmd script behavior");
  const original = process.cwd();
  const base = await makeTempDirectory(tmpSuffix);
  try {
    process.chdir(base);
    await runUserCommand(
      'dir . > listing1.txt\n\n>result.txt echo 1\n\ndir . > listing2.txt\n\nset "PASTE_TEST_VALUE=2"\n>>result.txt echo %PASTE_TEST_VALUE%',
    );
    assert.equal(
      (await readFile("result.txt", "utf8")).replace(/\r/g, ""),
      "1\n2\n",
    );
    assert.ok((await readFile("listing1.txt", "utf8")).length > 0);
    assert.ok((await readFile("listing2.txt", "utf8")).length > 0);
  } finally {
    process.chdir(original);
    await rm(base, { recursive: true, force: true });
  }
});

async function captureStdout<T>(fn: () => Promise<T>) {
  const original = process.stdout.write;
  let out = "";
  process.stdout.write = ((chunk: any) => {
    out += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { result: await fn(), out };
  } finally {
    process.stdout.write = original;
  }
}

function findAlternateDrive(): string | null {
  const letters = "DEFGHIJKLMNOPQRSTUVWXYZ";
  for (const letter of letters) {
    const root = `${letter}:\\`;
    try {
      accessSync(root);
      return `${letter}:`;
    } catch {
      // keep searching
    }
  }
  return null;
}

void test("cd changes directories and reports cwd", async () => {
  const original = process.cwd();
  const base = await makeTempDirectory(tmpSuffix);
  const child = path.join(base, "child");
  await mkdir(child);
  try {
    process.chdir(base);
    await runUserCommand(`cd ${child}`);
    assert.equal(process.cwd(), child);
    const { out } = await captureStdout(() => runUserCommand("cd"));
    assert.equal(out, process.cwd() + "\n");
  } finally {
    process.chdir(original);
    await rm(base, { recursive: true, force: true });
  }
});

void test("cd ~ changes to the home directory", async () => {
  const original = process.cwd();
  const base = await makeTempDirectory(tmpSuffix);
  try {
    process.chdir(base);
    await runUserCommand("cd ~");
    assert.equal(process.cwd(), homedir());
  } finally {
    process.chdir(original);
    await rm(base, { recursive: true, force: true });
  }
});

void test("pushd swaps directories using the stack", async () => {
  const original = process.cwd();
  const base = await makeTempDirectory(tmpSuffix);
  const child = path.join(base, "child");
  await mkdir(child);
  try {
    process.chdir(base);
    const first = await captureStdout(() => runUserCommand(`pushd ${child}`));
    assert.equal(process.cwd(), child);
    assert.ok(first.out.startsWith(`${child} ${base}`));
    const second = await captureStdout(() => runUserCommand("pushd"));
    assert.equal(process.cwd(), base);
    assert.ok(second.out.startsWith(`${base} ${child}`));
  } finally {
    process.chdir(original);
    await rm(base, { recursive: true, force: true });
  }
});

void test("popd moves to next directory in stack", async () => {
  const original = process.cwd();
  const base = await makeTempDirectory(tmpSuffix);
  const child = path.join(base, "child");
  await mkdir(child);
  try {
    process.chdir(base);
    await runUserCommand(`pushd ${child}`);
    assert.equal(process.cwd(), child);
    const result = await captureStdout(() => runUserCommand("popd"));
    assert.equal(process.cwd(), base);
    assert.ok(result.out.startsWith(base));
  } finally {
    process.chdir(original);
    await rm(base, { recursive: true, force: true });
  }
});

void test("windows drive change commands switch cwd", async (t) => {
  if (process.platform !== "win32") {
    t.skip("windows drive changes only");
    return;
  }
  const drive = findAlternateDrive();
  if (!drive) {
    t.skip("no alternate drive detected");
    return;
  }
  const original = process.cwd();
  try {
    await runUserCommand(drive);
    assert.equal(process.cwd().slice(0, 2).toUpperCase(), drive.toUpperCase());
  } finally {
    process.chdir(original);
  }
});

void test("runUserCommand temporarily registers SIGINT protection", async () => {
  // I wonder if this is a good test or not.
  // It would be cooler if we could run something that would throw a Ctrl-C
  // and see how caroushell handles it.
  const originalOn = process.on;
  const originalOff = process.off;
  let sigintAdded = 0;
  let sigintRemoved = 0;

  process.on = ((event: any, listener: any) => {
    if (event === "SIGINT") {
      sigintAdded += 1;
    }
    return originalOn.call(process, event, listener);
  }) as typeof process.on;

  process.off = ((event: any, listener: any) => {
    if (event === "SIGINT") {
      sigintRemoved += 1;
    }
    return originalOff.call(process, event, listener);
  }) as typeof process.off;

  try {
    await runUserCommand('node -e "setTimeout(() => process.exit(0), 20)"');
  } finally {
    process.on = originalOn;
    process.off = originalOff;
  }

  assert.equal(sigintAdded, 1);
  assert.equal(sigintRemoved, 1);
});

void test("external commands receive expanded home paths", async () => {
  const target = path.join(
    homedir(),
    `caroushell-tilde-test-${process.pid}-${Date.now()}.txt`,
  );
  const arg = `~/${path.basename(target)}`;

  try {
    await rm(target, { force: true });
    await runUserCommand(
      `node -e "require('node:fs').writeFileSync(process.argv[1], 'ok')" ${arg}`,
    );
    accessSync(target);
  } finally {
    await rm(target, { force: true });
  }
});
