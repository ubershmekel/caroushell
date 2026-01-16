import { logLine } from "./logs";
import { Terminal, colors } from "./terminal";

export interface Suggester {
  prefix: string;
  init(): Promise<void>;
  refreshSuggestions(carousel: Carousel, maxDisplayed: number): Promise<void>;
  latest(): string[];
  descriptionForAi(): string;
  onCommandRan?(command: string): Promise<void> | void;
}

type LineInfo = {
  // Full set of input lines split on "\n".
  lines: string[];
  // Index of the line containing the cursor.
  lineIndex: number;
  // The text of the current line (no trailing newline).
  lineText: string;
  // Absolute buffer index where this line starts.
  lineStart: number;
  // Absolute buffer index where this line ends.
  lineEnd: number;
  // Column position within the current line.
  column: number;
};

export class Carousel {
  private top: Suggester;
  private bottom: Suggester;
  private topRowCount: number;
  private bottomRowCount: number;
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
  }

  async updateSuggestions(input?: string) {
    if (typeof input === "string") {
      this.setInputBuffer(input);
    }
    void this.top.refreshSuggestions(this, this.topRowCount);
    void this.bottom.refreshSuggestions(this, this.bottomRowCount);
  }

  up() {
    this.index += 1;
    const topLength = this.top.latest().length;
    if (this.index >= topLength) {
      this.index = topLength;
    }
  }

  down() {
    this.index -= 1;
    const bottomLength = this.bottom.latest().length;
    if (-this.index >= bottomLength) {
      this.index = -bottomLength;
    }
  }

  getRow(rowIndex: number): string {
    const latestTop = this.top.latest();
    const latestBottom = this.bottom.latest();
    if (rowIndex < 0) {
      const bottomIndex = -rowIndex - 1;
      return latestBottom[bottomIndex] || "";
    }
    if (rowIndex === 0) {
      return this.inputBuffer;
    }
    if (rowIndex > 0) {
      const topIndex = rowIndex - 1;
      return latestTop[topIndex] || "";
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

  private getFormattedSuggestionRow(rowIndex: number): string {
    const rowStr = this.getRow(rowIndex);
    let prefix = this.getPrefixByIndex(rowIndex);
    const { reset, dim } = colors;
    let color = dim;
    if (this.index === rowIndex) {
      color = colors.purple;
      if (rowIndex !== 0) {
        prefix = "> ";
      }
    }
    if (rowIndex !== 0 && !rowStr) {
      // The edge of the top or bottom panel
      prefix = "---";
    }

    return `${color}${prefix}${rowStr}${reset}`;
  }

  private getFormattedPromptRow(
    lineIndex: number,
    lineText: string,
    promptSelected: boolean
  ): string {
    const { reset, dim } = colors;
    const color = promptSelected ? colors.purple : dim;
    const prefix = this.getPromptPrefix(lineIndex);
    return `${color}${prefix}${lineText}${reset}`;
  }

  getCurrentRow(): string {
    return this.getRow(this.index);
  }

  getCurrentRowSuggester(): Suggester | null {
    if (this.index > 0) return this.top;
    if (this.index < 0) return this.bottom;
    return null;
  }

  setInputBuffer(value: string, cursorPos: number = value.length) {
    this.inputBuffer = value;
    this.inputCursor = Math.max(
      0,
      Math.min(cursorPos, this.inputBuffer.length)
    );
  }

  getInputBuffer(): string {
    return this.inputBuffer;
  }

  resetIndex() {
    this.index = 0;
  }

  private adoptSelectionIntoInput() {
    // When you highlighted a suggestion row (history/AI) and then type
    // or edit, we want to pull that selected row into the input buffer
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

  private isWhitespace(char: string) {
    return /\s/.test(char);
  }

  moveCursorWordLeft() {
    this.adoptSelectionIntoInput();
    if (this.inputCursor === 0) return;
    let pos = this.inputCursor;
    // Skip any whitespace directly to the left of the cursor
    while (pos > 0 && this.isWhitespace(this.inputBuffer[pos - 1])) {
      pos -= 1;
    }
    // Skip the word characters to the left
    while (pos > 0 && !this.isWhitespace(this.inputBuffer[pos - 1])) {
      pos -= 1;
    }
    this.inputCursor = pos;
  }

  moveCursorRight() {
    this.adoptSelectionIntoInput();
    if (this.inputCursor >= this.inputBuffer.length) return;
    this.inputCursor += 1;
  }

  shouldUpMoveMultilineCursor(): boolean {
    const info = this.getLineInfoAtPosition(this.inputCursor);
    return this.isPromptRowSelected() && info.lineIndex > 0;
  }

  shouldDownMoveMultilineCursor(): boolean {
    const info = this.getLineInfoAtPosition(this.inputCursor);
    return (
      this.isPromptRowSelected() && info.lineIndex < info.lines.length - 1
    );
  }

  moveMultilineCursorUp() {
    this.adoptSelectionIntoInput();
    const info = this.getLineInfoAtPosition(this.inputCursor);
    if (info.lineIndex === 0) return;
    const targetIndex = info.lineIndex - 1;
    const targetStart = this.getLineStartIndex(targetIndex, info.lines);
    const targetLen = info.lines[targetIndex].length;
    this.inputCursor = targetStart + Math.min(info.column, targetLen);
  }

  moveMultilineCursorDown() {
    this.adoptSelectionIntoInput();
    const info = this.getLineInfoAtPosition(this.inputCursor);
    if (info.lineIndex >= info.lines.length - 1) return;
    const targetIndex = info.lineIndex + 1;
    const targetStart = this.getLineStartIndex(targetIndex, info.lines);
    const targetLen = info.lines[targetIndex].length;
    this.inputCursor = targetStart + Math.min(info.column, targetLen);
  }

  moveCursorWordRight() {
    this.adoptSelectionIntoInput();
    if (this.inputCursor >= this.inputBuffer.length) return;
    let pos = this.inputCursor;
    const len = this.inputBuffer.length;
    // Skip any whitespace to the right of the cursor
    while (pos < len && this.isWhitespace(this.inputBuffer[pos])) {
      pos += 1;
    }
    // Skip through the next word
    while (pos < len && !this.isWhitespace(this.inputBuffer[pos])) {
      pos += 1;
    }
    this.inputCursor = pos;
  }

  moveCursorHome() {
    this.adoptSelectionIntoInput();
    this.inputCursor = this.getLineInfoAtPosition(this.inputCursor).lineStart;
  }

  moveCursorEnd() {
    this.adoptSelectionIntoInput();
    this.inputCursor = this.getLineInfoAtPosition(this.inputCursor).lineEnd;
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
    const info = this.getLineInfoAtPosition(this.inputCursor);
    if (info.column === 0) return;
    const before = this.inputBuffer.slice(0, info.lineStart);
    const after = this.inputBuffer.slice(this.inputCursor);
    this.inputBuffer = `${before}${after}`;
    this.inputCursor = info.lineStart;
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

  getInputCursor(): number {
    return this.inputCursor;
  }

  getWordInfoAtCursor() {
    let start = this.inputCursor;
    while (start > 0 && !this.isWhitespace(this.inputBuffer[start - 1])) {
      start -= 1;
    }
    let end = this.inputCursor;
    const len = this.inputBuffer.length;
    while (end < len && !this.isWhitespace(this.inputBuffer[end])) {
      end += 1;
    }
    return {
      start,
      end,
      prefix: this.inputBuffer.slice(start, this.inputCursor),
      word: this.inputBuffer.slice(start, end),
    };
  }

  getInputLineInfoAtCursor() {
    return this.getLineInfoAtPosition(this.inputCursor);
  }

  private getPromptCursorColumn(): number {
    const info = this.getLineInfoAtPosition(this.inputCursor);
    const prefix = this.getPromptPrefix(info.lineIndex);
    return prefix.length + info.column;
  }

  private getLineInfoAtPosition(pos: number): LineInfo {
    // Map a buffer index to its line/column and line boundaries.
    const lines = this.getInputLines();
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const end = start + line.length;
      if (pos <= end) {
        // Cursor is on this line or at its end.
        return {
          lines,
          lineIndex: i,
          lineText: line,
          lineStart: start,
          lineEnd: end,
          column: pos - start,
        };
      }
      start = end + 1;
    }
    const lastIndex = Math.max(0, lines.length - 1);
    const lastStart = Math.max(
      0,
      this.inputBuffer.length - lines[lastIndex].length
    );
    // Fallback when pos is beyond the buffer end.
    return {
      lines,
      lineIndex: lastIndex,
      lineText: lines[lastIndex] ?? "",
      lineStart: lastStart,
      lineEnd: lastStart + (lines[lastIndex]?.length ?? 0),
      column: Math.max(0, pos - lastStart),
    };
  }

  private getInputLines(): string[] {
    return this.inputBuffer.split("\n");
  }

  private getLineStartIndex(lineIndex: number, lines: string[]): number {
    let start = 0;
    for (let i = 0; i < lineIndex; i++) {
      start += lines[i].length + 1;
    }
    return start;
  }

  private getPromptPrefix(lineIndex: number): string {
    return lineIndex === 0 ? "$> " : "> ";
  }

  render() {
    logLine("Rendering carousel");
    const width = process.stdout.columns || 80;
    const lines: string[] = [];
    const rowCount = this.topRowCount + this.bottomRowCount + 1;
    const start = this.index + this.topRowCount;
    const end = start - rowCount;
    const promptLines = this.getInputLines();
    const promptSelected = this.index === 0;
    const lineInfo = this.getLineInfoAtPosition(this.inputCursor);
    let cursorRow = 0;
    let cursorCol = 0;

    for (let rowIndex = start; rowIndex > end; rowIndex--) {
      if (rowIndex === 0) {
        for (let i = 0; i < promptLines.length; i++) {
          if (this.index === 0 && i === lineInfo.lineIndex) {
            cursorRow = lines.length;
            cursorCol = this.getPromptCursorColumn();
          }
          lines.push(
            this.getFormattedPromptRow(i, promptLines[i], promptSelected)
          );
        }
      } else {
        if (this.index === rowIndex) {
          cursorRow = lines.length;
          cursorCol = 2;
        }
        lines.push(this.getFormattedSuggestionRow(rowIndex));
      }
    }
    this.terminal.renderBlock(
      lines.map((line) => line.slice(0, width - 2)),
      cursorRow,
      cursorCol
    );
  }

  setTopSuggester(suggester: Suggester) {
    if (this.top === suggester) return;
    this.top = suggester;
    if (this.index > 0) {
      const topLength = this.top.latest().length;
      this.index = Math.min(this.index, topLength);
    }
  }

  getSuggesters(): Suggester[] {
    return [this.top, this.bottom];
  }
}
