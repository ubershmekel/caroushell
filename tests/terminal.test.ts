import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";

import { Carousel, NullSuggester } from "../src/carousel";
import { Terminal } from "../src/terminal";

class RecordingWritable extends Writable {
  chunks: string[] = [];

  _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.chunks.push(String(chunk));
    callback();
  }
}

void test("reset restores prompt modes and release disables bracketed paste", () => {
  const out = new RecordingWritable();
  const terminal = new Terminal();
  (terminal as any).out = out;
  terminal.reset();
  assert.ok(out.chunks.join("").includes("\x1b[?1l"));
  assert.ok(out.chunks.join("").includes("\x1b[?2004h"));
  out.chunks = [];
  terminal.release();
  assert.equal(out.chunks.join(""), "\x1b[?2004l\x1b[?25h");
});

void test("printTemporary hides the cursor while repainting", async () => {
  const out = new RecordingWritable();
  const terminal = new Terminal();
  (terminal as any).out = out;

  terminal.printTemporary(["$> g"], 0, 4);

  const output = out.chunks.join("");
  const hideIndex = output.indexOf("\x1b[?25l");
  const showIndex = output.lastIndexOf("\x1b[?25h");
  const promptIndex = output.indexOf("$> g");

  assert.notEqual(hideIndex, -1);
  assert.notEqual(showIndex, -1);
  assert.notEqual(promptIndex, -1);
  assert.ok(hideIndex < promptIndex);
  assert.ok(promptIndex < showIndex);
});

void test("wrapped rows start at column zero and are cleared when input shrinks", () => {
  const out = new RecordingWritable();
  const terminal = new Terminal();
  (terminal as any).out = out;

  terminal.printTemporary(["$> abcdefg", "hijklmnopq", "rs"], 2, 2);
  assert.ok(out.chunks.join("").includes("$> abcdefg\r\nhijklmnopq\r\nrs"));

  out.chunks = [];
  terminal.printTemporary(["$> a"], 0, 4);
  const output = out.chunks.join("");
  assert.ok(output.includes("\x1b[2A"));
  assert.ok(output.indexOf("\x1b[2A") < output.indexOf("$> a"));
  assert.ok(output.includes("\x1b[0J"));
  assert.ok(output.includes("\x1b[5G"));
});

void test("prompt separators render in a different color than prompt text", () => {
  const out = new RecordingWritable();
  const terminal = new Terminal();
  (terminal as any).out = out;

  const carousel = new Carousel({
    top: new NullSuggester(),
    bottom: new NullSuggester(),
    terminal,
    promptLine0: () => "host:path > ",
  });

  carousel.setInputBuffer("ls");
  carousel.render();

  const output = out.chunks.join("");

  assert.match(
    output,
    /\x1b\[95mhost\x1b\[37m:\x1b\[95mpath \x1b\[37m>\x1b\[95m ls\x1b\[0m/,
  );
});
