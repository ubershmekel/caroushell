import { logLine } from "./logs";
import { Terminal, colors } from "./terminal";

export interface Suggester {
  prefix: string;
  init(): Promise<void>;
  suggest(carousel: Carousel, maxDisplayed: number): Promise<string[]>;
  descriptionForAi(): string;
}

export class Carousel {
  private top: Suggester;
  private bottom: Suggester;
  private topRowCount: number;
  private bottomRowCount: number;
  private latestTop: string[] = [];
  private latestBottom: string[] = [];
  private index = 0;
  private inputBuffer: string = "";
  private terminal: Terminal;

  constructor(opts: {
    top: Suggester;
    bottom: Suggester;
    topRows: number;
    bottomRows: number;
    terminal: Terminal;
  }) {
    this.terminal = opts.terminal;
    this.top = opts.top;
    this.bottom = opts.bottom;
    this.topRowCount = opts.topRows;
    this.bottomRowCount = opts.bottomRows;
    const empty = "---";
    this.latestTop = Array(this.topRowCount).fill(empty);
    this.latestBottom = Array(this.bottomRowCount).fill(empty);
  }

  async updateSuggestions(input?: string) {
    if (typeof input === "string") {
      this.inputBuffer = input;
    }
    const topPromise = this.top.suggest(this, this.topRowCount);
    const bottomPromise = this.bottom.suggest(this, this.bottomRowCount);
    topPromise.then((r) => {
      this.latestTop = r;
      this.render();
    });
    bottomPromise.then((r) => {
      this.latestBottom = r;
      this.render();
    });
  }

  up() {
    this.index += 1;
    if (this.index >= this.latestTop.length) {
      this.index = this.latestTop.length;
    }
  }

  down() {
    this.index -= 1;
    if (-this.index >= this.latestBottom.length) {
      this.index = -this.latestBottom.length;
    }
  }

  getRow(rowIndex: number): string {
    if (rowIndex < 0) {
      const bottomIndex = -rowIndex - 1;
      return this.latestBottom[bottomIndex] || "";
    }
    if (rowIndex === 0) {
      return this.inputBuffer;
    }
    if (rowIndex > 0) {
      const topIndex = rowIndex - 1;
      return this.latestTop[topIndex] || "";
    }
    return "";
  }

  getPrefixByIndex(index: number): string {
    if (index < 0) {
      return this.bottom.prefix;
    }
    if (index > 0) {
      return this.top.prefix;
    }
    return "$> ";
  }

  getFormattedRow(rowIndex: number): string {
    const rowStr = this.getRow(rowIndex);
    let prefix = this.getPrefixByIndex(rowIndex);
    const { brightWhite, reset, dim } = colors;
    let color = dim;
    if (this.index === rowIndex) {
      color = brightWhite;
      if (rowIndex !== 0) {
        prefix = "> ";
      }
    }

    return `${color}${prefix}${rowStr}${reset}`;
  }

  getCurrentRow(): string {
    return this.getRow(this.index);
  }

  setInputBuffer(value: string) {
    this.inputBuffer = value;
  }

  resetIndex() {
    this.index = 0;
  }

  render() {
    logLine("Rendering carousel");
    // Draw all the lines
    const width = process.stdout.columns || 80;
    const { brightWhite, reset, dim } = colors;
    const lines: string[] = [];

    const start = this.index + this.topRowCount;
    const rowCount = this.topRowCount + this.bottomRowCount + 1;
    const end = start - rowCount;
    for (let i = start; i > end; i--) {
      lines.push(this.getFormattedRow(i).slice(0, width - 2));
    }

    this.terminal.renderBlock(lines);
  }

  getSuggesters(): Suggester[] {
    return [this.top, this.bottom];
  }
}
