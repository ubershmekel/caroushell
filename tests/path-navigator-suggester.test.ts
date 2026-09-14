import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { PathNavigatorSuggester } from "../src/path-navigator-suggester";

void test("navigator lists folders only, prefix matches first, and nested queries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "caroushell-nav-"));
  const originalCwd = process.cwd();
  try {
    await mkdir(path.join(root, "src", "utils"), { recursive: true });
    await mkdir(path.join(root, "docs"));
    await mkdir(path.join(root, "my resources"));
    await writeFile(path.join(root, "source.txt"), "");
    process.chdir(root);
    const nav = new PathNavigatorSuggester();
    assert.deepEqual(await nav.getMatchingFolders(""), [
      "..",
      "docs",
      "my resources",
      "src",
    ]);
    assert.deepEqual(await nav.getMatchingFolders("S"), [
      "src",
      "docs",
      "my resources",
    ]);
    assert.deepEqual(await nav.getMatchingFolders("src/"), [
      "src/..",
      "src/utils",
    ]);
    assert.deepEqual(await nav.getMatchingFolders("src/ut"), ["src/utils"]);
    assert.deepEqual(await nav.getMatchingFolders("missing/"), []);
    assert.deepEqual(nav.accept("src"), {
      changeDirectory: path.join(root, "src"),
    });
    assert.deepEqual(nav.accept("my resources"), {
      changeDirectory: path.join(root, "my resources"),
    });
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});
