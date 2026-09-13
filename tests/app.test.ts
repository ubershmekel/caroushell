import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import { App } from "../src/app";
import type { Carousel, Suggester } from "../src/carousel";
import { Keyboard, keySequence } from "../src/keyboard";
import { Terminal } from "../src/terminal";

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;

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
    _maxDisplayed: number,
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

void test("prompt owns paste mode across command handoff, failure, and shutdown", async () => {
  const terminal = new RecordingTerminal();
  const input = new PassThrough();
  const keyboard = new Keyboard(input as unknown as NodeJS.ReadStream);
  const history = new StaticSuggester("H>", []);
  const files = new NullFileSuggester();
  const app = new App({
    terminal,
    keyboard,
    topPanel: history,
    files,
    suggesters: [],
  });
  const exitListeners = process.listenerCount("exit");
  const modes = () =>
    terminal.writes.filter((text) => /\x1b\[\?2004[hl]/.test(text));
  try {
    await app.run();
    assert.deepEqual(modes(), ["\x1b[?2004h"]);
    assert.equal(process.listenerCount("exit"), exitListeners + 1);
    (app as any).preBroadcastCommand = async () => {
      assert.equal(modes().slice(-1)[0], "\x1b[?2004l");
      assert.equal(input.listenerCount("data"), 0);
    };
    await (app as any).runCommand("echo paste-mode-test");
    assert.deepEqual(modes().slice(-2), ["\x1b[?2004l", "\x1b[?2004h"]);
    (app as any).preBroadcastCommand = async () => {
      throw new Error("hook failed");
    };
    await assert.rejects((app as any).runCommand("unused"), /hook failed/);
    assert.deepEqual(modes().slice(-2), ["\x1b[?2004l", "\x1b[?2004h"]);
    assert.equal(input.listenerCount("data"), 1);
  } finally {
    app.end();
  }
  assert.equal(modes().slice(-1)[0], "\x1b[?2004l");
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(process.listenerCount("exit"), exitListeners);
});

void test("multiline bracketed paste waits for a typed Enter", async () => {
  const terminal = new RecordingTerminal();
  const input = new PassThrough();
  const keyboard = new Keyboard(input as unknown as NodeJS.ReadStream);
  const history = new StaticSuggester("H>", []);
  const files = new NullFileSuggester();
  const app = new App({
    terminal,
    keyboard,
    topPanel: history,
    files,
    suggesters: [],
  });
  const commands: string[] = [];
  (app as any).runCommand = async (cmd: string) => {
    commands.push(cmd);
  };
  try {
    await app.run();
    input.emit("data", "\x1b[200~echo one\r\necho two\r\n\x1b[201~");
    assert.equal(app.carousel.getInputBuffer(), "echo one\necho two\n");
    assert.deepEqual(commands, []);
    input.emit("data", "\r");
    await delay(0);
    assert.deepEqual(commands, ["echo one\necho two"]);
  } finally {
    app.end();
  }
});

void test("command display tracks multiline input as separate terminal rows", async () => {
  const terminal = new RecordingTerminal();
  const input = new PassThrough();
  const keyboard = new Keyboard(input as unknown as NodeJS.ReadStream);
  const history = new StaticSuggester("H>", []);
  const files = new NullFileSuggester();
  const app = new App({
    terminal,
    keyboard,
    topPanel: history,
    files,
    suggesters: [],
  });
  // Stop before executing: this test inspects the command echo's physical rows.
  (app as any).preBroadcastCommand = async () => {
    throw new Error("display checked");
  };
  try {
    await assert.rejects(
      (app as any).runCommand("dir e:\n\necho 1\ndir c:\necho 2"),
      /display checked/,
    );
    assert.deepEqual(
      terminal
        .lastBlock()
        ?.lines.map((line) => line.replace(ANSI_ESCAPE_REGEX, "")),
      ["$ dir e:", "", "echo 1", "dir c:", "echo 2"],
    );
  } finally {
    app.end();
  }
});

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
    afterInput?.lines.some((line) =>
      line.replace(ANSI_ESCAPE_REGEX, "").includes("$> hi"),
    ),
    "prompt line shows the typed input",
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
  input.write(keySequence("enter"));
  await delay(0);
  assert.equal(ran.length, 0);
  assert.equal(app.carousel.getInputBuffer(), "echo 123\\\n");

  input.write("x\\");
  input.write(keySequence("enter"));
  input.write("y\\");
  input.write(keySequence("enter"));
  input.write("z");
  input.write(keySequence("enter"));
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
  input.write(keySequence("enter"));
  input.write("two");
  await delay(0);

  assert.equal(app.carousel.getInputBuffer(), "one\\\ntwo");
  assert.equal(app.carousel.getInputCursor(), 8);
  assert.equal(app.carousel.isPromptRowSelected(), true);

  input.write(keySequence("up"));
  await delay(0);
  assert.equal(app.carousel.getInputCursor(), 3);
  assert.equal(app.carousel.isPromptRowSelected(), true);

  input.write(keySequence("up"));
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
  input.write(keySequence("enter"));
  input.write("two");
  await delay(0);

  assert.equal(app.carousel.getInputBuffer(), "one\\\ntwo");
  assert.equal(app.carousel.getInputLineInfoAtCursor().lineIndex, 1);

  input.write(keySequence("down"));
  await delay(0);

  assert.equal(app.carousel.isPromptRowSelected(), false);
  assert.equal(app.carousel.getCurrentRow(), "ai suggestion");
  const block = terminal.lastBlock();
  assert.ok(block, "app rendered after moving to ai suggestion");
  assert.equal(block?.cursorRow, 3);

  app.end();
});
