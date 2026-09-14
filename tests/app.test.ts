import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { App } from "../src/app";
import type { Carousel, Suggester } from "../src/carousel";
import { Keyboard, keySequence } from "../src/keyboard";
import { PathNavigatorSuggester } from "../src/path-navigator-suggester";
import { Terminal } from "../src/terminal";
import { makeTempDirectory } from "./helpers/temp-directory";

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;

class RecordingTerminal extends Terminal {
  blocks: {
    lines: string[];
    cursorRow?: number;
    cursorCol?: number;
    hideCursor?: boolean;
  }[] = [];
  writes: string[] = [];

  renderBlock(
    lines: string[],
    cursorRow?: number,
    cursorCol?: number,
    opts: { hideCursor?: boolean } = {},
  ) {
    this.blocks.push({
      lines: [...lines],
      cursorRow,
      cursorCol,
      hideCursor: opts.hideCursor,
    });
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
  constructor(items: string[] = []) {
    super("F>", items);
  }

  accept(row: string) {
    return { insert: row };
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
    history: history,
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
    history: history,
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
    history: history,
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
    history: history,
    ai,
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
    history: history,
    ai,
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
    history: history,
    ai,
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
    history: history,
    ai,
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

void test("Alt-M menu preserves input and survives asynchronous suggester redraws", async () => {
  const terminal = new RecordingTerminal();
  const history = new StaticSuggester("H>", ["echo history"]);
  const app = new App({
    terminal,
    history: history,
    files: new NullFileSuggester(),
    suggesters: [],
  });
  const key = (name: string) => app.handleKey({ name, sequence: "" });
  app.carousel.setInputBuffer("unfinished command", 4);
  await key("alt-m");
  await history.refreshSuggestions(app.carousel, 2);
  assert.match(
    terminal.lastBlock().lines.join("\n").replace(ANSI_ESCAPE_REGEX, ""),
    /Caroushell v\d+\.\d+\.\d+  \/ Menu/,
  );
  assert.doesNotMatch(terminal.lastBlock().lines.join("\n"), /AI/);
  await app.handleKey({ name: "char", sequence: "ignored" });
  await key("enter");
  await key("down");
  await key("escape");
  await key("escape");
  assert.equal(app.carousel.getInputBuffer(), "unfinished command");
  assert.equal(app.carousel.getInputLineInfoAtCursor().column, 4);
  assert.equal(app.carousel.getSuggesters()[0], history);
});

void test(".menu opens controls without executing a shell command", async () => {
  const terminal = new RecordingTerminal();
  const app = new App({
    terminal,
    history: new StaticSuggester("H>", []),
    files: new NullFileSuggester(),
    suggesters: [],
  });
  (app as any).runCommand = async () => assert.fail(".menu must not execute");
  app.carousel.setInputBuffer("  .menu  ");
  await app.handleKey({ name: "enter", sequence: "\r" });
  assert.match(terminal.lastBlock().lines[0], /Caroushell.*v\d+\.\d+\.\d+/);
  assert.equal(terminal.lastBlock().hideCursor, true);
  await app.handleKey({ name: "escape", sequence: "\x1b" });
  assert.equal(app.carousel.getInputBuffer(), "");
  assert.doesNotMatch(terminal.lastBlock().lines.join("\n"), /Caroushell/);
  assert.notEqual(terminal.lastBlock().hideCursor, true);
});

void test("menu can hide both panels and Tab temporarily opens completion", async () => {
  const terminal = new RecordingTerminal();
  const files = new NullFileSuggester();
  const app = new App({
    terminal,
    history: new StaticSuggester("H>", []),
    files,
    suggesters: [],
  });
  const key = (name: string) => app.handleKey({ name, sequence: "" });
  await key("alt-m");
  await key("enter");
  await key("up"); // History wraps to Off.
  await key("enter");
  assert.equal(terminal.lastBlock().lines.length, 1);
  await key("tab");
  assert.equal(app.carousel.getSuggesters()[0], files);
  assert.equal(terminal.lastBlock().lines.length, 3);
  await key("escape");
  assert.equal(terminal.lastBlock().lines.length, 1);
  await key("tab");
  await key("tab"); // Tab again toggles back.
  assert.equal(terminal.lastBlock().lines.length, 1);
  await key("alt-m");
  assert.match(terminal.lastBlock().lines[0], /Caroushell/);
});

void test("accepting a file suggestion inserts at the prompt cursor after browsing shorter rows", async () => {
  const terminal = new RecordingTerminal();
  const files = new NullFileSuggester([".claude", ".git", ".github"]);
  const app = new App({
    terminal,
    history: new StaticSuggester("H>", []),
    files,
    suggesters: [],
  });
  const key = (name: string) => app.handleKey({ name, sequence: "" });
  app.carousel.setInputBuffer(".git x ");
  await key("tab");
  await key("up");
  await key("up"); // ".git" is shorter than the prompt and clamps the cursor.
  await key("up");
  assert.equal(app.carousel.getCurrentRow(), ".github");
  await key("enter");
  assert.equal(app.carousel.getInputBuffer(), ".git x .github");
  assert.equal(app.carousel.getInputCursor(), ".git x .github".length);
});

void test("Enter on folder rows preserves literal paths without executing commands", async () => {
  const root = await makeTempDirectory("caroushell-literal-nav-");
  const originalCwd = process.cwd();
  const terminal = new RecordingTerminal();
  const navigator = new PathNavigatorSuggester();
  const app = new App({
    terminal,
    history: new StaticSuggester("H>", []),
    folders: navigator,
    panels: { bottom: "folders" },
    files: new NullFileSuggester(),
    suggesters: [],
  });
  (app as any).runCommand = async () =>
    assert.fail("folder navigation must not execute commands");
  const key = (name: string) => app.handleKey({ name, sequence: "" });
  const names = ["my folder", "%TEMP%", "$HOME", "~", "a&b"];
  if (process.platform !== "win32") names.push('quote"folder', "line\nbreak");
  try {
    for (const name of names) {
      process.chdir(root);
      await mkdir(path.join(root, name));
      await navigator.getMatchingFolders("");
      (navigator as any).latest = () => [name];
      app.carousel.setInputBuffer("filter");
      await key("down");
      await key("enter");
      assert.equal(process.cwd(), path.join(root, name));
      assert.equal(app.carousel.getInputBuffer(), "");
      assert.equal(app.carousel.isPromptRowSelected(), true);
    }
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

void test("delayed Tab completion is discarded after cursor or selection changes", async () => {
  for (const movement of ["end", "up", null]) {
    for (const match of ["first-completed", null]) {
      const files = new NullFileSuggester();
      let resolve!: (match: string | null) => void;
      files.findUniqueMatch = () =>
        new Promise((done) => {
          resolve = done;
        });
      const history = new StaticSuggester("H>", ["history row"]);
      const app = new App({
        terminal: new RecordingTerminal(),
        history,
        files,
        suggesters: [],
      });
      app.carousel.setInputBuffer("first second", 5);
      const pending = app.handleKey({ name: "tab", sequence: "" });
      if (movement) await app.handleKey({ name: movement, sequence: "" });
      resolve(match);
      await pending;
      assert.equal(
        app.carousel.getInputBuffer(),
        !movement && match ? "first-completed second" : "first second",
      );
      if (movement) {
        assert.equal(app.carousel.getSuggesters()[0], history);
        assert.equal(app.carousel.isPromptRowSelected(), movement !== "up");
        assert.equal(
          app.carousel.getInputCursor(),
          movement === "end" ? 12 : 5,
        );
      }
    }
  }
});

void test("menu shows unconfigured AI as unavailable", async () => {
  const terminal = new RecordingTerminal();
  const app = new App({
    terminal,
    history: new StaticSuggester("H>", []),
    files: new NullFileSuggester(),
    suggesters: [],
  });
  const key = (name: string) => app.handleKey({ name, sequence: "" });
  await key("alt-m");
  await key("enter");
  const text = terminal
    .lastBlock()
    .lines.join("\n")
    .replace(ANSI_ESCAPE_REGEX, "");
  assert.match(text, /Folders/);
  assert.match(text, /AI {2}\(disabled until you set apiUrl/);
  await key("up"); // Off
  await key("up"); // AI (not configured)
  await key("enter");
  assert.match(terminal.lastBlock().lines.join("\n"), /Top panel/);
});

void test("independent panel choices allow duplicates and bottom-only completion", async () => {
  const terminal = new RecordingTerminal();
  const history = new StaticSuggester("H>", ["echo hello"]);
  const files = new NullFileSuggester();
  const app = new App({ terminal, history: history, files, suggesters: [] });
  const key = (name: string) => app.handleKey({ name, sequence: "" });
  await key("alt-m");
  await key("down");
  await key("enter");
  await key("down"); // Off wraps to History.
  await key("enter");
  assert.deepEqual(app.carousel.getSuggesters(), [history, history]);
  await key("alt-m");
  await key("enter");
  await key("up");
  await key("enter");
  await key("tab");
  assert.equal(app.carousel.getSuggesters()[1], files);
  await key("escape");
  assert.equal(app.carousel.getSuggesters()[1], history);
  await key("tab");
  await key("tab"); // Tab again toggles back.
  assert.equal(app.carousel.getSuggesters()[1], history);
  assert.equal(terminal.lastBlock().lines.length, 3);
});
