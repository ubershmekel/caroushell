import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { HistorySuggester } from "../src/history-suggester";

test("descriptionForAi lists newest history entries first", async (ctx) => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "caroushell-history-")
  );
  ctx.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const historyFile = path.join(tempDir, "history");

  const suggester = new HistorySuggester(historyFile);
  await suggester.init();
  const commands = ["echo first", "echo second", "echo third"];
  for (const command of commands) {
    await suggester.add(command);
  }

  // Reload from disk to exercise the parser as well as in-memory ordering.
  const reloaded = new HistorySuggester(historyFile);
  await reloaded.init();

  const lines = reloaded.descriptionForAi().split("\n");

  assert.strictEqual(lines[0], 'The most recent command is: "echo third"');
  const secondLineOnwardsText = lines.slice(1).join("\n");
  const commandIndexes = commands.map((cmd) =>
    secondLineOnwardsText.indexOf(cmd)
  );
  for (let i = 0; i < commandIndexes.length - 1; i++) {
    // make sure the indexes are shrinking (older commands show up later)
    assert.ok(commandIndexes[i] > commandIndexes[i + 1]);
  }
});
