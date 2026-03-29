import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";

import { Terminal } from "../src/terminal";

class RecordingWritable extends Writable {
  chunks: string[] = [];

  _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.chunks.push(String(chunk));
    callback();
  }
}

void test("renderBlock hides the cursor while repainting", async () => {
  const out = new RecordingWritable();
  const terminal = new Terminal();
  (terminal as any).out = out;

  terminal.renderBlock(["$> g"], 0, 4);

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
