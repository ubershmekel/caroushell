import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test, TestContext } from "node:test";
import { Keyboard, KeyEvent } from "../src/keyboard";

function capture(chunks: string[]): KeyEvent[] {
  const input = new PassThrough();
  const keyboard = new Keyboard(input as unknown as NodeJS.ReadStream);
  const events: KeyEvent[] = [];
  keyboard.on("key", (event: KeyEvent) => events.push(event));
  keyboard.enableCapture();
  try {
    for (const chunk of chunks) input.emit("data", chunk);
    return events;
  } finally {
    keyboard.disableCapture();
  }
}

void test("bracketed paste inserts text without interpreting command keys", () => {
  const events = capture(["\x1b[200~echo one\r\necho two\t\x03\x1b[201~\r"]);
  assert.deepEqual(
    events.map(({ name, sequence }) => ({ name, sequence })),
    [
      { name: "char", sequence: "echo one\necho two\t" },
      { name: "enter", sequence: "\r" },
    ],
  );
});

void test("paste markers survive every chunk boundary, including single bytes", () => {
  const paste = "\x1b[200~echo hello\x1b[201~";
  for (let split = 1; split < paste.length; split++) {
    assert.deepEqual(capture([paste.slice(0, split), paste.slice(split)]), [
      { name: "char", sequence: "echo hello" },
    ]);
  }
  assert.deepEqual(capture([...paste]), [
    { name: "char", sequence: "echo hello" },
  ]);
});

void test("stray paste end markers do not leak into the prompt", () => {
  assert.deepEqual(capture(["\x1b[201~x"]), [{ name: "char", sequence: "x" }]);
});

void test("paste removes ANSI colors before inserting text", () => {
  assert.deepEqual(capture(["\x1b[200~\x1b[31mred\x1b[0m\x1b[201~"]), [
    { name: "char", sequence: "red" },
  ]);
});

void test("paste drops control characters while preserving tabs and newlines", () => {
  const controls = Array.from({ length: 32 }, (_, code) =>
    String.fromCharCode(code),
  )
    .filter((char) => !["\t", "\n", "\r"].includes(char))
    .join("");
  assert.deepEqual(
    capture([`\x1b[200~a${controls}\x7fb\t\r\nc\rd\ne\x1b[201~`]),
    [{ name: "char", sequence: "ab\t\nc\nd\ne" }],
  );
  assert.deepEqual(
    capture(["\x1b[200~\x1b[31m\x00\x03\x7f\x1b[0m\x1b[201~"]),
    [],
  );
});

function timedKeyboard(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const input = new PassThrough();
  const keyboard = new Keyboard(input as unknown as NodeJS.ReadStream);
  const events: { name: string; sequence: string }[] = [];
  keyboard.on("key", ({ name, sequence }: KeyEvent) =>
    events.push({ name, sequence }),
  );
  keyboard.enableCapture();
  t.after(() => keyboard.disableCapture());
  return { keyboard, events, send: (text: string) => input.emit("data", text) };
}

void test("lone Escape emits a key when the sequence timeout expires", (t) => {
  const { send, events } = timedKeyboard(t);
  send("\x1b");
  t.mock.timers.tick(39);
  assert.deepEqual(events, []);
  t.mock.timers.tick(1);
  assert.deepEqual(events, [{ name: "escape", sequence: "\x1b" }]);
});

void test("Escape timeout prevents the next letter becoming a word jump", (t) => {
  const { send, events } = timedKeyboard(t);
  send("\x1b");
  t.mock.timers.tick(40);
  send("b");
  assert.deepEqual(events, [
    { name: "escape", sequence: "\x1b" },
    { name: "char", sequence: "b" },
  ]);
});

void test("split arrow before timeout remains a single key", (t) => {
  const { send, events } = timedKeyboard(t);
  send("\x1b");
  t.mock.timers.tick(20);
  send("[A");
  t.mock.timers.tick(40);
  assert.deepEqual(events, [{ name: "up", sequence: "\x1b[A" }]);
});

void test("incomplete prefix times out into Escape and plain text", (t) => {
  const { send, events } = timedKeyboard(t);
  send("\x1b[");
  t.mock.timers.tick(40);
  send("A");
  assert.deepEqual(events, [
    { name: "escape", sequence: "\x1b" },
    { name: "char", sequence: "[" },
    { name: "char", sequence: "A" },
  ]);
});

void test("new partial input restarts the sequence timeout", (t) => {
  const { send, events } = timedKeyboard(t);
  send("\x1b");
  t.mock.timers.tick(30);
  send("[");
  t.mock.timers.tick(30);
  assert.deepEqual(events, []);
  send("A");
  t.mock.timers.tick(40);
  assert.deepEqual(events, [{ name: "up", sequence: "\x1b[A" }]);
});

void test("stopping capture cancels a pending sequence timeout", (t) => {
  const { send, events, keyboard } = timedKeyboard(t);
  send("\x1b");
  keyboard.disableCapture();
  keyboard.enableCapture();
  send("\x1b");
  t.mock.timers.tick(20);
  send("[");
  t.mock.timers.tick(20);
  assert.deepEqual(events, []);
  keyboard.disableCapture();
  t.mock.timers.tick(100);
  assert.deepEqual(events, []);
});

void test("multiple arrows in one chunk are matched independently", () => {
  assert.deepEqual(
    capture(["\x1b[A\x1b[A"]).map(({ name }) => name),
    ["up", "up"],
  );
});

void test("paste split across chunks stays one text insertion", (t) => {
  const { send, events } = timedKeyboard(t);
  send("\x1b[200~he");
  t.mock.timers.tick(100);
  assert.deepEqual(events, []);
  send("llo\x1b[201~");
  assert.deepEqual(events, [{ name: "char", sequence: "hello" }]);
});

void test("Alt-M is recognized across chunk boundaries", () => {
  for (const sequence of ["\x1bm", "\x1bM"]) {
    for (let split = 1; split < sequence.length; split++) {
      const events = capture([sequence.slice(0, split), sequence.slice(split)]);
      assert.equal(events.length, 1);
      assert.equal(events[0].name, "alt-m");
      assert.equal(events[0].meta, true);
    }
  }
});

void test("macOS Option-M without Option-as-Meta is recognized as Alt-M", () => {
  const events = capture(["µ"]);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "alt-m");
});
