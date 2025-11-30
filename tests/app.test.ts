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

test("app prompt redraw keeps suggestion row intact", async () => {
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
    history,
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
    afterInput?.lines.some((line) => line.includes("$> hi")),
    "prompt line shows the typed input"
  );
  assert.strictEqual(afterInput?.lines[1], baselineHistoryLine);
  app.keyboard.disableCapture();
});
