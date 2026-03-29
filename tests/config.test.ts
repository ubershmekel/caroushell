import assert from "node:assert/strict";
import os from "node:os";
import { test } from "node:test";

import { buildPromptLine0 } from "../src/config";

function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/");
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  return parts
    .map((part, i) => {
      if (i === parts.length - 1) return part;
      if (part === "" || part === "~") return part;
      return part[0];
    })
    .join("/");
}

void test("buildPromptLine0 expands hostname and full directory tokens", () => {
  const cwd = normalizeCwd(process.cwd());
  const prompt = buildPromptLine0({
    prompt: "{hostname}:{directory} $> ",
  });

  assert.equal(prompt(), `${os.hostname()}:${cwd} $> `);
});

void test("buildPromptLine0 expands the short directory token", () => {
  const cwd = normalizeCwd(process.cwd());
  const prompt = buildPromptLine0({
    prompt: "{short-directory} $> ",
  });

  assert.equal(prompt(), `${shortenPath(cwd)} $> `);
});

void test("buildPromptLine0 falls back to the default prompt", () => {
  const prompt = buildPromptLine0({});
  assert.equal(prompt(), "$> ");
});

void test("buildPromptLine0 leaves unknown tokens unchanged", () => {
  const prompt = buildPromptLine0({
    prompt: "{hostname} {unknown} $> ",
  });

  assert.equal(prompt(), `${os.hostname()} {unknown} $> `);
});
