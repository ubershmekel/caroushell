import readline from 'readline';

export class Terminal {
  private out = process.stdout;
  private lastRenderedLines = 0;

  write(text: string) {
    this.out.write(text);
  }

  hideCursor() {
    this.write("\x1b[?25l");
  }

  showCursor() {
    this.write("\x1b[?25h");
  }

  // Render a block of lines, replacing previous block
  renderBlock(lines: string[]) {
    if (this.lastRenderedLines > 0) {
      const up = this.lastRenderedLines - 1;
      if (up > 0) readline.moveCursor(this.out, 0, -up);
      readline.cursorTo(this.out, 0);
      readline.clearScreenDown(this.out);
    }
    for (let i = 0; i < lines.length; i++) {
      this.out.write(lines[i]);
      if (i < lines.length - 1) this.out.write("\n");
    }
    this.lastRenderedLines = lines.length;
  }

  // When we have printed arbitrary output that is not managed by renderBlock,
  // reset internal line tracking so the next render starts fresh.
  resetBlockTracking() {
    this.lastRenderedLines = 0;
  }

  // Color helpers
  color = {
    reset: "\x1b[0m",
    white: "\x1b[37m",
    brightWhite: "\x1b[97m",
    dim: "\x1b[2m",
    yellow: "\x1b[33m",
  } as const;
}
