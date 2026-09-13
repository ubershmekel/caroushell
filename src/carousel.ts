import { logLine } from "./logs";
import { Terminal, colors } from "./terminal";

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;
const COMBINING_MARK_REGEX = /^\p{Mark}+$/u;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;
// A grapheme is one user-visible character, potentially made of several Unicode
// code points (e.g. "e" + a combining accent, or a joined family emoji).
// Segmenting prevents wrapping between those pieces. String.length counts UTF-16
// code units instead, so it cannot tell us where visible characters end.
const GRAPHEME_SEGMENTER =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

function isFullWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f6ff) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x1fa70 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

export function getDisplayWidth(text: string): number {
  // Colors occupy no terminal cells. Most graphemes occupy one cell; wide
  // characters and emoji typically occupy two (exact rendering is terminal-specific).
  const stripped = text.replace(ANSI_ESCAPE_REGEX, "");
  let width = 0;
  if (GRAPHEME_SEGMENTER) {
    for (const { segment } of GRAPHEME_SEGMENTER.segment(stripped)) {
      if (!segment) continue;
      if (COMBINING_MARK_REGEX.test(segment)) continue;
      if (EMOJI_REGEX.test(segment)) {
        width += 2;
        continue;
      }
      const codePoint = segment.codePointAt(0) ?? 0;
      width += isFullWidthCodePoint(codePoint) ? 2 : 1;
    }
    return width;
  }

  for (const char of stripped) {
    if (COMBINING_MARK_REGEX.test(char)) continue;
    if (EMOJI_REGEX.test(char)) {
      width += 2;
      continue;
    }
    const codePoint = char.codePointAt(0) ?? 0;
    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

// Split by terminal cells, keeping color sequences and graphemes intact.
// `cursor` is a display-cell offset in the unwrapped line, not a string index.
export function wrapDisplayLine(text: string, width: number, cursor?: number) {
  const lines = [""];
  let column = 0;
  let offset = 0;
  let cursorRow = 0;
  let cursorCol = 0;
  // The capturing group preserves color escapes as separate parts. Copy them
  // without counting their bytes; their style remains active across wrapped rows.
  for (const part of text.split(/(\x1b\[[0-9;]*m)/g)) {
    if (part.startsWith("\x1b[")) {
      lines[lines.length - 1] += part;
      continue;
    }
    const segments = GRAPHEME_SEGMENTER
      ? Array.from(GRAPHEME_SEGMENTER.segment(part), ({ segment }) => segment)
      : Array.from(part);
    for (const segment of segments) {
      const cells = getDisplayWidth(segment);
      if (segment === "\n" || segment === "\r\n" || segment === "\r") {
        if (offset === cursor) {
          if (column >= width) {
            lines.push("");
            column = 0;
          }
          cursorRow = lines.length - 1;
          cursorCol = column;
        }
        lines.push("");
        column = 0;
        offset += cells;
        continue;
      }
      // Move a two-cell character to the next row if only one cell remains.
      if (cells > 0 && column + cells > width) {
        lines.push("");
        column = 0;
      }
      if (offset === cursor) {
        // Resolve the cursor after wrapping so it stays with the next character.
        cursorRow = lines.length - 1;
        cursorCol = column;
      }
      lines[lines.length - 1] += segment;
      column += cells;
      offset += cells;
    }
  }
  if (offset === cursor) {
    // A cursor after a full row needs a real continuation row; terminals
    // otherwise leave it at the right margin with autowrap pending.
    if (column >= width) {
      lines.push("");
      column = 0;
    }
    cursorRow = lines.length - 1;
    cursorCol = column;
  }
  return { lines, cursorRow, cursorCol };
}

export interface Suggester {
  prefix: string;
  init(): Promise<void>;
  refreshSuggestions(carousel: Carousel, maxDisplayed: number): Promise<void>;
  latest(): string[];
  descriptionForAi(): string;
  onCommandWillRun?(command: string): Promise<void> | void;
  onCommandRan?(command: string): Promise<void> | void;
}

export class NullSuggester implements Suggester {
  prefix = "";
  async init() {}
  async refreshSuggestions() {}
  latest() {
    return [];
  }
  descriptionForAi() {
    return "";
  }
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
  private overlay: (() => string[]) | null = null;

  /**
   * When set, render() draws these lines (e.g. the menu) instead of the
   * carousel, so a suggester finishing in the background can't draw over it.
   */
  setOverlay(overlay: (() => string[]) | null) {
    this.overlay = overlay;
  }
  private top: Suggester;
  private bottom: Suggester;
  private topRowCount: number;
  private bottomRowCount: number;
  private index = 0;
  private inputBuffer: string = "";
  private cursorIndex = 0;
  private terminal: Terminal;
  private promptLine0Getter: () => string;

  constructor(opts: {
    top: Suggester;
    bottom: Suggester;
    topRows: number;
    bottomRows: number;
    terminal: Terminal;
    promptLine0?: () => string;
  }) {
    this.terminal = opts.terminal;
    this.top = opts.top;
    this.bottom = opts.bottom;
    this.topRowCount = opts.topRows;
    this.bottomRowCount = opts.bottomRows;
    this.promptLine0Getter = opts.promptLine0 ?? (() => "$> ");
  }

  async updateSuggestions(input?: string) {
    if (typeof input === "string") {
      this.setInputBuffer(input);
    }
    if (this.topRowCount > 0) {
      void this.top.refreshSuggestions(this, this.topRowCount);
    }
    if (this.bottomRowCount > 0 && this.bottom !== this.top) {
      void this.bottom.refreshSuggestions(this, this.bottomRowCount);
    }
  }

  up() {
    this.index += 1;
    const topLength = this.top.latest().length;
    if (this.index >= topLength) {
      this.index = topLength;
    }
    this.clampCursorToActiveRow();
  }

  down() {
    this.index -= 1;
    const bottomLength = this.bottom.latest().length;
    if (-this.index >= bottomLength) {
      this.index = -bottomLength;
    }
    this.clampCursorToActiveRow();
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
    let prefix = this.getSuggestionPrefix(rowIndex, rowStr);
    const { reset, dim } = colors;
    let color = dim;
    if (this.index === rowIndex) {
      color = colors.purple;
    }

    return `${color}${prefix}${rowStr}${reset}`;
  }

  private getSuggestionPreview(rowIndex: number, width: number): string {
    const rowStr = this.getRow(rowIndex);
    const prefix = this.getSuggestionPrefix(rowIndex, rowStr).replace(
      ANSI_ESCAPE_REGEX,
      "",
    );
    const sourceLines = rowStr
      .replace(ANSI_ESCAPE_REGEX, "")
      .split(/\r\n|\r|\n/);
    const firstLine = sourceLines[0];
    const segments = GRAPHEME_SEGMENTER
      ? Array.from(
          GRAPHEME_SEGMENTER.segment(firstLine),
          ({ segment }) => segment,
        )
      : Array.from(firstLine);
    const hiddenLines = sourceLines.length - 1;
    const widths = segments.map(getDisplayWidth);
    let visible = segments.length;
    let textWidth = widths.reduce((sum, cells) => sum + cells, 0);
    const prefixWidth = getDisplayWidth(prefix);
    const indicator = () => {
      const counts: string[] = [];
      if (hiddenLines) {
        counts.push(`+${hiddenLines} ${hiddenLines === 1 ? "line" : "lines"}`);
      }
      const hiddenChars = segments.length - visible;
      if (hiddenChars) {
        counts.push(`+${hiddenChars} ${hiddenChars === 1 ? "char" : "chars"}`);
      }
      return counts.length ? `… ${counts.join(", ")}` : "";
    };
    // Recalculate the count as text is removed: the marker itself needs space,
    // and its width can grow when the hidden-character count gains a digit.
    let suffix = indicator();
    while (
      visible > 0 &&
      prefixWidth + textWidth + (suffix ? 1 + getDisplayWidth(suffix) : 0) >
        width
    ) {
      textWidth -= widths[--visible];
      suffix = indicator();
    }
    if (suffix && prefixWidth + 1 + getDisplayWidth(suffix) > width) {
      // Very narrow terminals still get a visible overflow hint.
      suffix = "…";
    }
    const content = prefix + segments.slice(0, visible).join("");
    const budget = width - (suffix ? getDisplayWidth(suffix) : 0);
    let preview = "";
    // Clip even an unusually long suggester prefix, without splitting graphemes.
    const parts = GRAPHEME_SEGMENTER
      ? Array.from(
          GRAPHEME_SEGMENTER.segment(content),
          ({ segment }) => segment,
        )
      : Array.from(content);
    let used = 0;
    for (const part of parts) {
      const cells = getDisplayWidth(part);
      if (used + cells > budget) break;
      preview += part;
      used += cells;
    }
    const gap = suffix && used < budget ? " " : "";
    return `${colors.dim}${preview}${gap}${colors.yellow}${suffix}${colors.reset}`;
  }

  private getSuggestionPrefix(rowIndex: number, rowStr: string): string {
    let prefix = this.getPrefixByIndex(rowIndex);
    if (this.index === rowIndex && rowIndex !== 0) {
      prefix = `${prefix}> `;
    }
    if (rowIndex !== 0 && !rowStr) {
      // The edge of the top or bottom panel
      prefix = "---";
    }
    return prefix;
  }

  private getFormattedPromptRow(
    lineIndex: number,
    lineText: string,
    promptSelected: boolean,
  ): string {
    const { reset, dimmest, dim } = colors;
    const color = promptSelected ? colors.purple : dim;
    const separatorColor = promptSelected ? dim : dimmest;
    const prefix = this.getPromptPrefix(lineIndex);
    // Color the separators differently from the prompt prefix
    const formattedPrefix = prefix
      .split("")
      .map((char) =>
        char === ":" || char === ">"
          ? `${separatorColor}${char}${color}`
          : char,
      )
      .join("");
    return `${color}${formattedPrefix}${lineText}${reset}`;
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
    this.cursorIndex = Math.max(
      0,
      Math.min(cursorPos, this.inputBuffer.length),
    );
  }

  getInputBuffer(): string {
    return this.inputBuffer;
  }

  resetIndex() {
    this.index = 0;
    this.cursorIndex = Math.min(this.cursorIndex, this.inputBuffer.length);
  }

  private adoptSelectionIntoInput() {
    // When you highlighted a suggestion row (history/AI) and then type
    // or edit, we want to pull that selected row into the input buffer
    if (this.index === 0) return;
    const current = this.getRow(this.index);
    this.setInputBuffer(current, Math.min(this.cursorIndex, current.length));
    this.index = 0;
  }

  private getActiveRowLength(): number {
    if (this.isPromptRowSelected()) return this.inputBuffer.length;
    return this.getRow(this.index).length;
  }

  private canMoveRight(): boolean {
    return this.cursorIndex < this.getActiveRowLength();
  }

  private clampCursorToActiveRow() {
    const len = this.getActiveRowLength();
    this.cursorIndex = Math.max(0, Math.min(this.cursorIndex, len));
  }

  insertAtCursor(text: string) {
    if (!text) return;
    this.adoptSelectionIntoInput();
    const before = this.inputBuffer.slice(0, this.cursorIndex);
    const after = this.inputBuffer.slice(this.cursorIndex);
    this.inputBuffer = `${before}${text}${after}`;
    this.cursorIndex += text.length;
  }

  deleteBeforeCursor() {
    this.adoptSelectionIntoInput();
    if (this.cursorIndex === 0) return;
    const before = this.inputBuffer.slice(0, this.cursorIndex - 1);
    const after = this.inputBuffer.slice(this.cursorIndex);
    this.inputBuffer = `${before}${after}`;
    this.cursorIndex -= 1;
  }

  moveCursorLeft() {
    if (this.cursorIndex === 0) return;
    this.cursorIndex -= 1;
  }

  private isWhitespace(char: string) {
    return /\s/.test(char);
  }

  moveCursorWordLeft() {
    this.adoptSelectionIntoInput();
    if (this.cursorIndex === 0) return;
    let pos = this.cursorIndex;
    // Skip any whitespace directly to the left of the cursor
    while (pos > 0 && this.isWhitespace(this.inputBuffer[pos - 1])) {
      pos -= 1;
    }
    // Skip the word characters to the left
    while (pos > 0 && !this.isWhitespace(this.inputBuffer[pos - 1])) {
      pos -= 1;
    }
    this.cursorIndex = pos;
  }

  moveCursorRight() {
    if (!this.canMoveRight()) return;
    this.cursorIndex += 1;
  }

  shouldUpMoveMultilineCursor(): boolean {
    const info = this.getLineInfoAtPosition(this.cursorIndex);
    return this.isPromptRowSelected() && info.lineIndex > 0;
  }

  shouldDownMoveMultilineCursor(): boolean {
    const info = this.getLineInfoAtPosition(this.cursorIndex);
    return this.isPromptRowSelected() && info.lineIndex < info.lines.length - 1;
  }

  moveMultilineCursorUp() {
    this.adoptSelectionIntoInput();
    const info = this.getLineInfoAtPosition(this.cursorIndex);
    if (info.lineIndex === 0) return;
    const targetIndex = info.lineIndex - 1;
    const targetStart = this.getLineStartIndex(targetIndex, info.lines);
    const targetLen = info.lines[targetIndex].length;
    this.cursorIndex = targetStart + Math.min(info.column, targetLen);
  }

  moveMultilineCursorDown() {
    this.adoptSelectionIntoInput();
    const info = this.getLineInfoAtPosition(this.cursorIndex);
    if (info.lineIndex >= info.lines.length - 1) return;
    const targetIndex = info.lineIndex + 1;
    const targetStart = this.getLineStartIndex(targetIndex, info.lines);
    const targetLen = info.lines[targetIndex].length;
    this.cursorIndex = targetStart + Math.min(info.column, targetLen);
  }

  moveCursorWordRight() {
    this.adoptSelectionIntoInput();
    if (this.cursorIndex >= this.inputBuffer.length) return;
    let pos = this.cursorIndex;
    const len = this.inputBuffer.length;
    // Skip any whitespace to the right of the cursor
    while (pos < len && this.isWhitespace(this.inputBuffer[pos])) {
      pos += 1;
    }
    // Skip through the next word
    while (pos < len && !this.isWhitespace(this.inputBuffer[pos])) {
      pos += 1;
    }
    this.cursorIndex = pos;
  }

  moveCursorHome() {
    this.adoptSelectionIntoInput();
    this.cursorIndex = this.getLineInfoAtPosition(this.cursorIndex).lineStart;
  }

  moveCursorEnd() {
    this.adoptSelectionIntoInput();
    this.cursorIndex = this.getLineInfoAtPosition(this.cursorIndex).lineEnd;
  }

  deleteAtCursor() {
    this.adoptSelectionIntoInput();
    if (this.cursorIndex >= this.inputBuffer.length) return;
    const before = this.inputBuffer.slice(0, this.cursorIndex);
    const after = this.inputBuffer.slice(this.cursorIndex + 1);
    this.inputBuffer = `${before}${after}`;
  }

  deleteToLineStart() {
    this.adoptSelectionIntoInput();
    if (this.cursorIndex === 0) return;
    const info = this.getLineInfoAtPosition(this.cursorIndex);
    if (info.column === 0) return;
    const before = this.inputBuffer.slice(0, info.lineStart);
    const after = this.inputBuffer.slice(this.cursorIndex);
    this.inputBuffer = `${before}${after}`;
    this.cursorIndex = info.lineStart;
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
    return this.cursorIndex;
  }

  getWordInfoAtCursor() {
    let start = this.cursorIndex;
    while (start > 0 && !this.isWhitespace(this.inputBuffer[start - 1])) {
      start -= 1;
    }
    let end = this.cursorIndex;
    const len = this.inputBuffer.length;
    while (end < len && !this.isWhitespace(this.inputBuffer[end])) {
      end += 1;
    }
    return {
      start,
      end,
      prefix: this.inputBuffer.slice(start, this.cursorIndex),
      word: this.inputBuffer.slice(start, end),
    };
  }

  getInputLineInfoAtCursor() {
    return this.getLineInfoAtPosition(this.cursorIndex);
  }

  private getPromptCursorColumn(): number {
    const info = this.getLineInfoAtPosition(this.cursorIndex);
    const prefix = this.getPromptPrefix(info.lineIndex);
    const linePrefix = info.lineText.slice(0, info.column);
    return getDisplayWidth(prefix) + getDisplayWidth(linePrefix);
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
      this.inputBuffer.length - lines[lastIndex].length,
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
    return lineIndex === 0 ? this.promptLine0Getter() : "> ";
  }

  render() {
    if (this.overlay) {
      const width = Math.max(2, process.stdout.columns || 80);
      const lines = this.overlay().flatMap(
        (line) => wrapDisplayLine(line, width).lines,
      );
      this.terminal.renderBlock(lines, 0, 0);
      return;
    }
    logLine("Rendering carousel");
    const width = Math.max(2, process.stdout.columns || 80);
    const lines: string[] = [];
    const rowCount = this.topRowCount + this.bottomRowCount + 1;
    const start = this.index + this.topRowCount;
    const end = start - rowCount;
    const promptLines = this.getInputLines();
    const promptSelected = this.index === 0;
    const lineInfo = this.getLineInfoAtPosition(this.cursorIndex);
    let cursorRow = 0;
    let cursorCol = 0;

    for (let rowIndex = start; rowIndex > end; rowIndex--) {
      if (rowIndex === 0) {
        for (let i = 0; i < promptLines.length; i++) {
          const containsCursor = promptSelected && i === lineInfo.lineIndex;
          const wrapped = wrapDisplayLine(
            this.getFormattedPromptRow(i, promptLines[i], promptSelected),
            width,
            containsCursor ? this.getPromptCursorColumn() : undefined,
          );
          if (containsCursor) {
            cursorRow = lines.length + wrapped.cursorRow;
            cursorCol = wrapped.cursorCol;
          }
          lines.push(...wrapped.lines);
        }
      } else {
        if (this.index === rowIndex) {
          const rowStr = this.getRow(rowIndex);
          const prefix = this.getSuggestionPrefix(rowIndex, rowStr);
          const cursorText = rowStr.slice(
            0,
            Math.min(this.cursorIndex, rowStr.length),
          );
          // The selected suggestion is browsable just like the prompt: show all
          // wrapped rows and map its cursor into them instead of pinning it to
          // the right edge of a clipped preview.
          const wrapped = wrapDisplayLine(
            this.getFormattedSuggestionRow(rowIndex),
            width,
            getDisplayWidth(prefix) + getDisplayWidth(cursorText),
          );
          cursorRow = lines.length + wrapped.cursorRow;
          cursorCol = wrapped.cursorCol;
          lines.push(...wrapped.lines);
        } else {
          // Keep unselected suggestions as compact, single-row previews.
          lines.push(this.getSuggestionPreview(rowIndex, width));
        }
      }
    }
    this.terminal.renderBlock(lines, cursorRow, cursorCol);
  }

  setTopSuggester(suggester: Suggester) {
    if (this.top === suggester) return;
    this.top = suggester;
    if (this.index > 0) {
      const topLength = this.top.latest().length;
      this.index = Math.min(this.index, topLength);
    }
  }

  /** Replace the suggesters shown above and below the prompt. An Off (Null) panel takes no rows. */
  setPanels(top: Suggester, bottom: Suggester) {
    this.top = top;
    this.bottom = bottom;
    this.topRowCount = top instanceof NullSuggester ? 0 : 2;
    this.bottomRowCount = bottom instanceof NullSuggester ? 0 : 2;
    // Keep the selection where possible, only clamping it to the new panels.
    if (this.index > 0) {
      this.index = Math.min(this.index, this.top.latest().length);
    } else if (this.index < 0) {
      this.index = Math.max(this.index, -this.bottom.latest().length);
    }
  }

  getSuggesters(): Suggester[] {
    return [this.top, this.bottom];
  }
}
