import readline from "readline";
import { Writable } from "stream";

// Color helpers
export const colors = {
  reset: "\x1b[0m",
  white: "\x1b[37m",
  brightWhite: "\x1b[97m",
  dimmest: "\x1b[2m",
  dim: "\x1b[37m",
  purple: "\x1b[95m",
  yellow: "\x1b[33m",
};

export class Terminal {
  private out = process.stdout;
  private activeRows = 0;
  private cursorRow = 0;
  private cursorCol = 0;
  private writesDisabled = false;

  disableWrites() {
    this.writesDisabled = true;
  }

  enableWrites() {
    this.writesDisabled = false;
  }

  reset() {
    // Some apps (such as vim) change the terminal cursor mode.
    // We need to reset it to the default. To avoid arrow keys causing this:
    // $> OAOBOCODODODODOAOAOCOB
    const RESET_CURSOR_MODE = "\x1b[?1l";
    this.write(RESET_CURSOR_MODE);
  }

  private canWrite(): boolean {
    return !this.writesDisabled;
  }

  private moveCursorToTopOfBlock() {
    if (this.activeRows === 0) return;
    readline.cursorTo(this.out, 0);
    if (this.cursorRow > 0) {
      readline.moveCursor(this.out, 0, -this.cursorRow);
    }
    this.cursorRow = 0;
    this.cursorCol = 0;
  }

  private withCork<T>(fn: () => T): T {
    // Cork is like "don't flush" and then "uncork" is like flush.
    // This prevents a flicker on the screen when we move the cursor around to render.
    // Node's Writable has cork/uncork; guard for environments that may not.
    const w = this.out as unknown as Writable;
    const hasCork =
      typeof (w as Writable).cork === "function" &&
      typeof (w as Writable).uncork === "function";
    if (!hasCork) {
      return fn();
    }

    (w as Writable).cork();
    try {
      return fn();
    } finally {
      (w as Writable).uncork();
    }
  }

  write(text: string) {
    if (!this.canWrite()) return;
    this.out.write(text);
  }

  hideCursor() {
    this.write("\x1b[?25l");
  }

  showCursor() {
    this.write("\x1b[?25h");
  }

  // Render a block of lines by clearing previous block (if any) and writing fresh
  renderBlock(lines: string[], cursorRow?: number, cursorCol?: number) {
    if (!this.canWrite()) return;
    this.withCork(() => {
      this.moveCursorToTopOfBlock();
      if (this.activeRows > 0) {
        readline.cursorTo(this.out, 0);
        readline.clearScreenDown(this.out);
      }

      for (let i = 0; i < lines.length; i++) {
        this.write(lines[i]);
        if (i < lines.length - 1) this.write("\n");
      }
      this.activeRows = lines.length;
      this.cursorRow = Math.max(0, this.activeRows - 1);
      const lastLine = lines[this.cursorRow] || "";
      this.cursorCol = lastLine.length;
      const needsPosition =
        typeof cursorRow === "number" || typeof cursorCol === "number";
      if (needsPosition) {
        const targetRow =
          typeof cursorRow === "number"
            ? Math.min(Math.max(cursorRow, 0), Math.max(0, this.activeRows - 1))
            : this.cursorRow;
        const targetCol = Math.max(0, cursorCol ?? this.cursorCol);
        this.moveCursorTo(targetRow, targetCol);
      }
    });
  }

  moveCursorTo(lineIndex: number, column: number) {
    if (!this.canWrite()) return;
    if (this.activeRows === 0) return;
    const safeLine = Math.min(
      Math.max(lineIndex, 0),
      Math.max(0, this.activeRows - 1)
    );
    const safeColumn = Math.max(0, column);
    const rowDelta = safeLine - this.cursorRow;
    if (rowDelta !== 0) {
      readline.moveCursor(this.out, 0, rowDelta);
    }
    readline.cursorTo(this.out, safeColumn);
    this.cursorRow = safeLine;
    this.cursorCol = safeColumn;
  }

  // When we have printed arbitrary output that is not managed by renderBlock,
  // reset internal line tracking so the next render starts fresh.
  resetBlockTracking() {
    this.activeRows = 0;
    this.cursorRow = 0;
    this.cursorCol = 0;
  }
}
