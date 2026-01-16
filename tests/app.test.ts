import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import { App } from "../src/app";
import type { Carousel, Suggester } from "../src/carousel";
import { Keyboard } from "../src/keyboard";
import { Terminal } from "../src/terminal";

class RecordingTerminal extends Terminal {
  blocks: { lines: string[]; cursorRow?: number; cursorCol?: number }[] = [];
  writes: string[] = [];

  renderBlock(lines: string[], cursorRow?: number, cursorCol?: number) {
    this.blocks.push({ lines: [...lines], cursorRow, cursorCol });
  }

  write(text: string) {
    this.writes.push(text);
  }

  lastBlock() {
    return this.blocks[this.blocks.length - 1];
  }
}

function findLineIndex(lines: string[], snippet: string): number {
  return lines.findIndex((line) => line.includes(snippet));
}

class StaticSuggester implements Suggester {
  prefix: string;
  private items: string[];

  constructor(prefix: string, items: string[]) {
    this.prefix = prefix;
    this.items = items;
  }

  async init() {}

  latest() {
    return this.items;
  }

  async refreshSuggestions(
    carousel: Carousel,
    _maxDisplayed: number
  ): Promise<void> {
    carousel.render();
  }

  descriptionForAi(): string {
    return "";
  }

  onCommandRan(command: string) {
    this.items = [command, ...this.items];
  }
}

class NullFileSuggester extends StaticSuggester {
  constructor() {
    super("F>", []);
  }

  async findUniqueMatch(): Promise<string | null> {
    return null;
  }
}

void test("app prompt redraw keeps suggestion row intact", async () => {
  const terminal = new RecordingTerminal();
  const input = new PassThrough();
  (input as any).isTTY = false;
  const keyboard = new Keyboard(input as unknown as NodeJS.ReadStream);

  const history = new StaticSuggester("H>", ["history 2", "history 1"]);
  const ai = new StaticSuggester("A>", ["ai suggestion"]);
  const files = new NullFileSuggester();

  const app = new App({
    terminal,
    keyboard,
    topPanel: history,
    bottomPanel: ai,
    files,
    suggesters: [history, ai, files],
  });

  await app.run();
  await delay(0);

  const initial = terminal.lastBlock();
  assert.ok(initial, "app rendered an initial block");
  const baselineHistoryLine = initial?.lines[1];

  input.write("h");
  input.write("i");
  await delay(0);

  const afterInput = terminal.lastBlock();
  assert.ok(
    afterInput?.lines.some((line) => line.includes("$> hi")),
    "prompt line shows the typed input"
  );
  assert.strictEqual(afterInput?.lines[1], baselineHistoryLine);
  app.end();
});

void test("backslash continuation keeps multiline input until complete", async () => {
  const terminal = new RecordingTerminal();
  const input = new PassThrough();
  (input as any).isTTY = false;
  const keyboard = new Keyboard(input as unknown as NodeJS.ReadStream);

  const history = new StaticSuggester("H>", ["history 2", "history 1"]);
  const ai = new StaticSuggester("A>", ["ai suggestion"]);
  const files = new NullFileSuggester();

  const app = new App({
    terminal,
    keyboard,
    topPanel: history,
    bottomPanel: ai,
    files,
    suggesters: [history, ai, files],
  });

  let ran: string[] = [];
  (app as any).runCommand = async (cmd: string) => {
    ran.push(cmd);
  };

  await app.run();
  await delay(0);

  input.write("echo 123\\");
  input.write("\r");
  await delay(0);
  assert.equal(ran.length, 0);
  assert.equal(app.carousel.getInputBuffer(), "echo 123\\\n");

  input.write("x\\");
  input.write("\r");
  input.write("y\\");
  input.write("\r");
  input.write("z");
  input.write("\r");
  await delay(0);

  assert.deepEqual(ran, ["echo 123xyz"]);
  app.end();
});

void test("up/down traverse multiline input before carousel selection", async () => {
  const terminal = new RecordingTerminal();
  const input = new PassThrough();
  (input as any).isTTY = false;
  const keyboard = new Keyboard(input as unknown as NodeJS.ReadStream);

  const history = new StaticSuggester("H>", ["history 2", "history 1"]);
  const ai = new StaticSuggester("A>", ["ai suggestion"]);
  const files = new NullFileSuggester();

  const app = new App({
    terminal,
    keyboard,
    topPanel: history,
    bottomPanel: ai,
    files,
    suggesters: [history, ai, files],
  });

  await app.run();
  await delay(0);

  input.write("one\\");
  input.write("\r");
  input.write("two");
  await delay(0);

  assert.equal(app.carousel.getInputBuffer(), "one\\\ntwo");
  assert.equal(app.carousel.getInputCursor(), 8);
  assert.equal(app.carousel.isPromptRowSelected(), true);

  input.write("\u001b[A");
  await delay(0);
  assert.equal(app.carousel.getInputCursor(), 3);
  assert.equal(app.carousel.isPromptRowSelected(), true);

  input.write("\u001b[A");
  await delay(0);
  assert.equal(app.carousel.isPromptRowSelected(), false);
  assert.equal(app.carousel.getCurrentRow(), "history 2");
  const block = terminal.lastBlock();
  assert.ok(block, "app rendered after moving to history");
  const historyIndex = findLineIndex(block?.lines ?? [], "history 2");
  assert.equal(historyIndex, 2);

  app.end();
});

void test("down from multiline last line moves to ai suggestion", async () => {
  const terminal = new RecordingTerminal();
  const input = new PassThrough();
  (input as any).isTTY = false;
  const keyboard = new Keyboard(input as unknown as NodeJS.ReadStream);

  const history = new StaticSuggester("H>", ["history 2", "history 1"]);
  const ai = new StaticSuggester("A>", ["ai suggestion"]);
  const files = new NullFileSuggester();

  const app = new App({
    terminal,
    keyboard,
    topPanel: history,
    bottomPanel: ai,
    files,
    suggesters: [history, ai, files],
  });

  await app.run();
  await delay(0);

  input.write("one\\");
  input.write("\r");
  input.write("two");
  await delay(0);

  assert.equal(app.carousel.getInputBuffer(), "one\\\ntwo");
  assert.equal(app.carousel.getInputLineInfoAtCursor().lineIndex, 1);

  input.write("\u001b[B");
  await delay(0);

  assert.equal(app.carousel.isPromptRowSelected(), false);
  assert.equal(app.carousel.getCurrentRow(), "ai suggestion");
  const block = terminal.lastBlock();
  assert.ok(block, "app rendered after moving to ai suggestion");
  assert.equal(block?.cursorRow, 3);

  app.end();
});
