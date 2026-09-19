import assert from "node:assert/strict";
import { test, TestContext } from "node:test";

import { Carousel, getDisplayWidth, NullSuggester } from "../src/carousel";
import { Terminal, colors } from "../src/terminal";

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
    "printTemporary",
    (lines: string[], cursorRow: number, cursorCol: number) => {
      block = {
        lines: lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "")),
        cursorRow,
        cursorCol,
      };
    },
  );
  // Empty panels that still take a row each when `panels` is set.
  const panel = () =>
    Object.assign(new NullSuggester(), { rowCount: panels ? 1 : 0 });
  const carousel = new Carousel({ terminal, top: panel(), bottom: panel() });
  return { carousel, terminal, lastBlock: () => block };
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

for (const panel of ["top", "bottom"] as const) {
  void test(`left/right reveal the entire selected ${panel} suggestion in a narrow terminal`, (t) => {
    const { carousel, lastBlock } = narrowCarousel(t, 10, true);
    const suggestion = "abcdefghijklmnop";
    const suggester = carousel.getSuggesters()[panel === "top" ? 0 : 1];
    suggester.prefix = "H>";
    t.mock.method(suggester, "latest", () => [suggestion]);
    if (panel === "top") carousel.up();
    else carousel.down();

    const assertCursor = (position: number) => {
      carousel.render();
      const block = lastBlock();
      assert.equal(block.lines.slice(1, -1).join(""), "H>> " + suggestion);
      assert.ok(block.lines.every((line) => getDisplayWidth(line) <= 10));
      assert.equal(block.cursorRow, 1 + Math.floor((4 + position) / 10));
      assert.equal(block.cursorCol, (4 + position) % 10);
      assert.equal(carousel.getCurrentRow(), suggestion);
      assert.equal(carousel.getInputBuffer(), "");
    };

    assertCursor(0);
    for (let position = 1; position <= suggestion.length; position++) {
      carousel.moveCursorRight();
      assertCursor(position);
    }
    for (let position = suggestion.length - 1; position >= 0; position--) {
      carousel.moveCursorLeft();
      assertCursor(position);
    }

    carousel.resetIndex();
    carousel.render();
    assert.equal(lastBlock().lines.length, 3);
    assert.equal(lastBlock().cursorRow, 1);
  });
}

void test("getDisplayWidth handles ansi, emoji, combining, and full width", () => {
  assert.equal(getDisplayWidth("abc"), 3);
  assert.equal(getDisplayWidth("\u001b[31mred\u001b[0m"), 3);
  assert.equal(getDisplayWidth("e\u0301"), 1);
  assert.equal(getDisplayWidth("界"), 2);
  assert.equal(getDisplayWidth("🙂"), 2);
});

void test("multiline history previews stay on one row and selected entries track each line", (t) => {
  const { carousel, lastBlock } = narrowCarousel(t, 20, true);
  const suggestion = "dir e:\n\necho 1\ndir c:\necho 2";
  const history = new NullSuggester();
  history.prefix = "H>";
  t.mock.method(history, "latest", () => [suggestion]);
  carousel.setTopSuggester(history);
  carousel.render();
  assert.equal(lastBlock().lines.length, 3);
  assert.equal(lastBlock().lines[0], "H>dir e: … +4 lines");
  carousel.up();
  for (let position = 0; position <= suggestion.length; position++) {
    carousel.render();
    const block = lastBlock();
    assert.ok(block.lines.every((line) => !/[\r\n]/.test(line)));
    const beforeCursor = suggestion.slice(0, position).split("\n");
    assert.equal(block.cursorRow, 1 + beforeCursor.length - 1);
    assert.equal(
      block.cursorCol,
      beforeCursor.length === 1
        ? 4 + position
        : beforeCursor[beforeCursor.length - 1].length,
    );
    assert.equal(carousel.getCurrentRow(), suggestion);
    carousel.moveCursorRight();
  }
  carousel.resetIndex();
  carousel.render();
  assert.equal(lastBlock().lines.length, 3);
});

for (const panel of ["top", "bottom"] as const) {
  void test(`${panel} previews reserve space for colored character counts`, (t) => {
    const { carousel, terminal, lastBlock } = narrowCarousel(t, 24, true);
    const suggester = carousel.getSuggesters()[panel === "top" ? 0 : 1];
    suggester.prefix = "H>";
    const suggestion = "abcdefghijklmnopqrstuvwxyz";
    t.mock.method(suggester, "latest", () => [suggestion]);
    carousel.render();
    const row = panel === "top" ? 0 : 2;
    assert.equal(lastBlock().lines[row], "H>abcdefghij … +16 chars");
    // Inspect the actual terminal output as well as the uncolored layout.
    const render = terminal.printTemporary as typeof terminal.printTemporary & {
      mock: { calls: { arguments: [string[], number, number] }[] };
    };
    assert.ok(
      render.mock.calls[0].arguments[0][row].includes(
        colors.yellow + "… +16 chars",
      ),
    );
    assert.equal(lastBlock().lines.length, 3);
    if (panel === "top") carousel.up();
    else carousel.down();
    carousel.render();
    assert.equal(carousel.getCurrentRow(), suggestion);
    assert.equal(lastBlock().lines.slice(1, -1).join(""), "H>> " + suggestion);
    carousel.resetIndex();
    carousel.render();
    assert.equal(lastBlock().lines[row], "H>abcdefghij … +16 chars");
  });
}

void test("previews count both overflow dimensions and preserve Unicode graphemes", (t) => {
  const { carousel, lastBlock } = narrowCarousel(t, 36, true);
  const history = carousel.getSuggesters()[0];
  history.prefix = "H>";
  t.mock.method(history, "latest", () => [
    "界e\u0301🙂".repeat(10) + "\r\nnext\rlast",
  ]);
  carousel.render();
  const preview = lastBlock().lines[0];
  assert.equal(preview, "H>界e\u0301🙂界e\u0301🙂界 … +2 lines, +23 chars");
  assert.ok(getDisplayWidth(preview) <= 36);
  assert.equal(lastBlock().lines.length, 3);
});

void test("tiny previews keep an ellipsis within the terminal width", (t) => {
  const { carousel, lastBlock } = narrowCarousel(t, 2, true);
  const history = carousel.getSuggesters()[0];
  history.prefix = "History>";
  t.mock.method(history, "latest", () => ["long\ncommand"]);
  carousel.render();
  assert.equal(lastBlock().lines[0], "H…");
});
