import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runHelloNewUserFlow } from "../src/hello-new-user";

function makeTerminalStub(answers: string[]) {
  let index = 0;
  return {
    createPrompter() {
      return {
        async ask() {
          const answer = answers[index];
          index += 1;
          return answer ?? "";
        },
        close() {},
      };
    },
    isInteractive() {
      return true;
    },
  };
}

void test("onboarding saves prompt config even when AI setup is skipped", async (ctx) => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "caroushell-onboarding-"),
  );
  ctx.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const configPath = path.join(tempDir, "config.toml");

  await runHelloNewUserFlow(configPath, {
    logFn: () => {},
    terminal: makeTerminalStub(['{hostname} {short-directory} $> ', "n"]),
  });

  const saved = await fs.readFile(configPath, "utf8");

  assert.equal(
    saved,
    'noAi = true\nprompt = "{hostname} {short-directory} $> "\n',
  );
});

void test("onboarding writes prompt template alongside AI settings", async (ctx) => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "caroushell-onboarding-"),
  );
  ctx.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const configPath = path.join(tempDir, "config.toml");

  const config = await runHelloNewUserFlow(configPath, {
    listModelsFn: async () => [],
    logFn: () => {},
    terminal: makeTerminalStub([
      "{directory} $> ",
      "y",
      "https://api.openai.com/v1",
      "sk-test",
      "gpt-4o-mini",
    ]),
  });

  assert.deepEqual(config, {
    apiUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    prompt: "{directory} $> ",
  });

  const saved = await fs.readFile(configPath, "utf8");

  assert.equal(
    saved,
    'apiUrl = "https://api.openai.com/v1"\napiKey = "sk-test"\nmodel = "gpt-4o-mini"\nprompt = "{directory} $> "\n',
  );
});
