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
    // Restore Caroushell's prompt modes, not a full terminal reset.
    // See docs/modes.md for mode ownership and command handoff.
    // Some apps (such as vim) change the terminal cursor mode.
    // We need to reset it to the default. To avoid arrow keys causing this:
    // $> OAOBOCODODODODOAOAOCOB
    const RESET_CURSOR_MODE = "\x1b[?1l";
    this.write(RESET_CURSOR_MODE);
    this.write("\x1b[?2004h");
  }

  release() {
    // Child programs and the parent shell must manage their own paste mode.
    this.write("\x1b[?2004l");
    // The menu hides the cursor; never exit with it still hidden.
    this.showCursor();
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
    if (!this.canWrite()) return;
    this.out.write("\x1b[?25l");
  }

  showCursor() {
    if (!this.canWrite()) return;
    this.out.write("\x1b[?25h");
  }

  /**
   * Draw lines that the next print replaces, such as the carousel. Clears the
   * previous temporary lines (if any) and writes these in their place.
   */
  printTemporary(
    lines: string[],
    cursorRow?: number,
    cursorCol?: number,
    opts: { hideCursor?: boolean } = {},
  ) {
    if (!this.canWrite()) return;
    this.withCork(() => {
      this.hideCursor();
      this.moveCursorToTopOfBlock();
      if (this.activeRows > 0) {
        readline.cursorTo(this.out, 0);
        readline.clearScreenDown(this.out);
      }

      for (let i = 0; i < lines.length; i++) {
        this.out.write(lines[i]);
        // Terminal controls, not file line endings: CR returns to column zero,
        // then LF moves down one row. This works on Windows and Unix, including
        // raw mode where LF may not automatically return to column zero.
        // CR also cancels pending autowrap when the preceding row is full.
        if (i < lines.length - 1) this.out.write("\r\n");
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
      if (!opts.hideCursor) this.showCursor();
    });
  }

  moveCursorTo(lineIndex: number, column: number) {
    if (!this.canWrite()) return;
    if (this.activeRows === 0) return;
    const safeLine = Math.min(
      Math.max(lineIndex, 0),
      Math.max(0, this.activeRows - 1),
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

  /**
   * Replace the temporary lines with lines that stay in the scrollback, such
   * as an echoed command. The next print starts on the row below them, so
   * command output that follows is kept too.
   */
  printPermanent(lines: string[]) {
    if (!this.canWrite()) return;
    this.printTemporary(lines);
    this.write("\n");
    this.activeRows = 0;
    this.cursorRow = 0;
    this.cursorCol = 0;
  }
}
