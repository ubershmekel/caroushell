import assert from "node:assert/strict";
import { accessSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runUserCommand } from "../src/spawner";

const tmpSuffix = "caroushell-test";

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
  const base = await mkdtemp(path.join(tmpdir(), tmpSuffix));
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

void test("pushd swaps directories using the stack", async () => {
  const original = process.cwd();
  const base = await mkdtemp(path.join(tmpdir(), tmpSuffix));
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
  const base = await mkdtemp(path.join(tmpdir(), tmpSuffix));
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
