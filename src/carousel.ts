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
  private inputCursor = 0;
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
      this.setInputBuffer(input);
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

  setInputBuffer(value: string, cursorPos: number = value.length) {
    this.inputBuffer = value;
    this.inputCursor = Math.max(
      0,
      Math.min(cursorPos, this.inputBuffer.length)
    );
  }

  resetIndex() {
    this.index = 0;
  }

  private adoptSelectionIntoInput() {
    if (this.index === 0) return;
    const current = this.getRow(this.index);
    this.setInputBuffer(current, current.length);
    this.index = 0;
  }

  insertAtCursor(text: string) {
    if (!text) return;
    this.adoptSelectionIntoInput();
    const before = this.inputBuffer.slice(0, this.inputCursor);
    const after = this.inputBuffer.slice(this.inputCursor);
    this.inputBuffer = `${before}${text}${after}`;
    this.inputCursor += text.length;
  }

  deleteBeforeCursor() {
    this.adoptSelectionIntoInput();
    if (this.inputCursor === 0) return;
    const before = this.inputBuffer.slice(0, this.inputCursor - 1);
    const after = this.inputBuffer.slice(this.inputCursor);
    this.inputBuffer = `${before}${after}`;
    this.inputCursor -= 1;
  }

  moveCursorLeft() {
    this.adoptSelectionIntoInput();
    if (this.inputCursor === 0) return;
    this.inputCursor -= 1;
  }

  moveCursorRight() {
    this.adoptSelectionIntoInput();
    if (this.inputCursor >= this.inputBuffer.length) return;
    this.inputCursor += 1;
  }

  moveCursorHome() {
    this.adoptSelectionIntoInput();
    this.inputCursor = 0;
  }

  moveCursorEnd() {
    this.adoptSelectionIntoInput();
    this.inputCursor = this.inputBuffer.length;
  }

  deleteAtCursor() {
    this.adoptSelectionIntoInput();
    if (this.inputCursor >= this.inputBuffer.length) return;
    const before = this.inputBuffer.slice(0, this.inputCursor);
    const after = this.inputBuffer.slice(this.inputCursor + 1);
    this.inputBuffer = `${before}${after}`;
  }

  deleteToLineStart() {
    this.adoptSelectionIntoInput();
    if (this.inputCursor === 0) return;
    const after = this.inputBuffer.slice(this.inputCursor);
    this.setInputBuffer(after, 0);
  }

  clearInput() {
    this.adoptSelectionIntoInput();
    this.setInputBuffer("", 0);
    this.index = 0;
  }

  hasInput(): boolean {
    return this.inputBuffer.length > 0;
  }

  isPromptRowSelected(): boolean {
    return this.index === 0;
  }

  private getPromptCursorColumn(): number {
    const prefix = this.getPrefixByIndex(0);
    return prefix.length + this.inputCursor;
  }

  render() {
    logLine("Rendering carousel");
    // Draw all the lines
    const width = process.stdout.columns || 80;
    const { brightWhite, reset, dim } = colors;
    const lines: { text: string; rowIndex: number }[] = [];

    const start = this.index + this.topRowCount;
    const rowCount = this.topRowCount + this.bottomRowCount + 1;
    const end = start - rowCount;
    for (let i = start; i > end; i--) {
      lines.push({
        rowIndex: i,
        text: this.getFormattedRow(i).slice(0, width - 2),
      });
    }

    const promptLineIndex = lines.findIndex((line) => line.rowIndex === 0);
    const cursorRow = this.topRowCount;
    const cursorCol = this.getPromptCursorColumn();
    this.terminal.renderBlock(
      lines.map((line) => line.text),
      cursorRow,
      cursorCol
    );
  }

  getSuggesters(): Suggester[] {
    return [this.top, this.bottom];
  }
}
