import assert from "node:assert/strict";
import { test, TestContext } from "node:test";

import { Carousel, getDisplayWidth, NullSuggester } from "../src/carousel";
import { Terminal } from "../src/terminal";

function narrowCarousel(t: TestContext, width = 10, panels = false) {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "columns", {
    value: width,
    configurable: true,
  });
  t.after(() => {
    if (previous) Object.defineProperty(process.stdout, "columns", previous);
    else Reflect.deleteProperty(process.stdout, "columns");
  });
  let block = { lines: [] as string[], cursorRow: 0, cursorCol: 0 };
  const terminal = new Terminal();
  t.mock.method(
    terminal,
    "renderBlock",
    (lines: string[], cursorRow: number, cursorCol: number) => {
      block = {
        lines: lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "")),
        cursorRow,
        cursorCol,
      };
    },
  );
  const carousel = new Carousel({
    terminal,
    top: new NullSuggester(),
    bottom: new NullSuggester(),
    topRows: panels ? 1 : 0,
    bottomRows: panels ? 1 : 0,
  });
  return { carousel, lastBlock: () => block };
}

void test("typing wraps all input and keeps the cursor visible between suggestion panels", (t) => {
  const { carousel, lastBlock } = narrowCarousel(t, 10, true);
  const input = "abcdefghijklmnopqrstuvwxyz";
  for (const char of input) {
    carousel.insertAtCursor(char);
    carousel.render();
    const block = lastBlock();
    const text = "$> " + carousel.getInputBuffer();
    assert.equal(block.lines.slice(1, -1).join(""), text);
    assert.equal(block.lines[0], "---");
    assert.equal(block.lines[block.lines.length - 1], "---");
    assert.ok(block.lines.every((line) => getDisplayWidth(line) <= 10));
    assert.equal(block.cursorRow, 1 + Math.floor(text.length / 10));
    assert.equal(block.cursorCol, text.length % 10);
  }
});

void test("editing across a wrap boundary removes obsolete continuation rows", (t) => {
  const { carousel, lastBlock } = narrowCarousel(t);
  carousel.setInputBuffer("abcdefgh");
  carousel.moveCursorLeft();
  carousel.render();
  assert.deepEqual(lastBlock(), {
    lines: ["$> abcdefg", "h"],
    cursorRow: 1,
    cursorCol: 0,
  });
  carousel.deleteBeforeCursor();
  carousel.render();
  assert.deepEqual(lastBlock(), {
    lines: ["$> abcdefh"],
    cursorRow: 0,
    cursorCol: 9,
  });
  carousel.moveCursorEnd();
  carousel.render();
  assert.deepEqual(lastBlock(), {
    lines: ["$> abcdefh", ""],
    cursorRow: 1,
    cursorCol: 0,
  });
  carousel.deleteBeforeCursor();
  carousel.render();
  assert.deepEqual(lastBlock(), {
    lines: ["$> abcdef"],
    cursorRow: 0,
    cursorCol: 9,
  });
});

void test("wrapped explicit continuation lines retain their prefixes and cursor position", (t) => {
  const { carousel, lastBlock } = narrowCarousel(t);
  carousel.setInputBuffer("abcdefgh\\\n123456789");
  carousel.render();
  assert.deepEqual(lastBlock(), {
    lines: ["$> abcdefg", "h\\", "> 12345678", "9"],
    cursorRow: 3,
    cursorCol: 1,
  });
});

void test("wrapping preserves wide and combining characters and counts color codes as zero cells", (t) => {
  const { carousel, lastBlock } = narrowCarousel(t);
  carousel.setInputBuffer("abcdef界e\u0301🙂");
  carousel.render();
  assert.deepEqual(lastBlock(), {
    lines: ["$> abcdef", "界e\u0301🙂"],
    cursorRow: 1,
    cursorCol: 5,
  });
  carousel.setInputBuffer("abcdef界e\u0301🙂", 6);
  carousel.render();
  assert.equal(lastBlock().cursorRow, 1);
  assert.equal(lastBlock().cursorCol, 0);
});

void test("getDisplayWidth handles ansi, emoji, combining, and full width", () => {
  assert.equal(getDisplayWidth("abc"), 3);
  assert.equal(getDisplayWidth("\u001b[31mred\u001b[0m"), 3);
  assert.equal(getDisplayWidth("e\u0301"), 1);
  assert.equal(getDisplayWidth("界"), 2);
  assert.equal(getDisplayWidth("🙂"), 2);
});
