import { Terminal, colors } from "./terminal";
import { Keyboard, KeyEvent } from "./keyboard";
import { Carousel, Suggester } from "./carousel";
import { HistorySuggester } from "./history-suggester";
import { AISuggester } from "./ai-suggester";
import { FileSuggester } from "./file-suggester";
import { runUserCommand } from "./spawner";
import { logLine } from "./logs";

type FileSuggesterLike = Suggester & {
  findUniqueMatch(prefix: string): Promise<string | null>;
};

type AppDeps = {
  terminal?: Terminal;
  keyboard?: Keyboard;
  topPanel?: Suggester;
  bottomPanel?: Suggester;
  files?: FileSuggesterLike;
  suggesters?: Suggester[];
};

function collapseLineContinuations(input: string): string {
  return input.replace(/\\\r?\n/g, "");
}

export class App {
  terminal: Terminal;
  keyboard: Keyboard;
  carousel: Carousel;

  private history: Suggester;
  private ai: Suggester;
  private files: FileSuggesterLike;
  private suggesters: Suggester[];
  private handlers: Partial<
    Record<KeyEvent["name"], (evt: KeyEvent) => void | Promise<void>>
  >;
  private queueUpdateSuggestions: () => void;
  private usingFileSuggestions = false;
  private onKeyHandler?: (evt: KeyEvent) => void;

  constructor(deps: AppDeps = {}) {
    this.terminal = deps.terminal ?? new Terminal();
    this.keyboard = deps.keyboard ?? new Keyboard();
    this.history = deps.topPanel ?? new HistorySuggester();
    this.ai = deps.bottomPanel ?? new AISuggester();
    this.files = deps.files ?? new FileSuggester();
    this.suggesters = deps.suggesters ?? [this.history, this.ai, this.files];
    this.carousel = new Carousel({
      top: this.history,
      bottom: this.ai,
      topRows: 2,
      bottomRows: 2,
      terminal: this.terminal,
    });

    this.queueUpdateSuggestions = () => {
      void this.carousel.updateSuggestions();
    };

    this.handlers = {
      "ctrl-c": () => {
        if (this.carousel.isPromptRowSelected() && !this.carousel.hasInput()) {
          this.exit();
          return;
        }
        this.carousel.clearInput();
        this.render();
        this.queueUpdateSuggestions();
      },
      "ctrl-d": () => {
        if (this.carousel.isPromptRowSelected() && !this.carousel.hasInput()) {
          this.exit();
          return;
        }
        this.carousel.deleteAtCursor();
        this.render();
        this.queueUpdateSuggestions();
      },
      "ctrl-u": () => {
        this.carousel.deleteToLineStart();
        this.render();
        this.queueUpdateSuggestions();
      },
      backspace: () => {
        this.carousel.deleteBeforeCursor();
        // Immediate prompt redraw with existing suggestions
        this.render();
        // Async fetch of new suggestions
        this.queueUpdateSuggestions();
      },
      enter: async () => {
        if (this.tryAcceptHighlightedFileSuggestion()) {
          return;
        }
        if (this.carousel.isPromptRowSelected()) {
          await this.enterOnPrompt();
        } else {
          await this.enterOnSuggestion();
        }
      },
      char: (evt) => {
        this.carousel.insertAtCursor(evt.sequence);
        // Immediate prompt redraw with existing suggestions
        this.render();
        // Async fetch of new suggestions
        this.queueUpdateSuggestions();
      },
      up: () => {
        if (this.carousel.shouldUpMoveMultilineCursor()) {
          this.carousel.moveMultilineCursorUp();
          this.render();
          return;
        }
        this.carousel.up();
        this.render();
      },
      down: () => {
        if (this.carousel.shouldDownMoveMultilineCursor()) {
          this.carousel.moveMultilineCursorDown();
          this.render();
          return;
        }
        this.carousel.down();
        this.render();
      },
      left: () => {
        this.carousel.moveCursorLeft();
        this.render();
      },
      right: () => {
        this.carousel.moveCursorRight();
        this.render();
      },
      "ctrl-left": () => {
        this.carousel.moveCursorWordLeft();
        this.render();
      },
      "ctrl-right": () => {
        this.carousel.moveCursorWordRight();
        this.render();
      },
      home: () => {
        this.carousel.moveCursorHome();
        this.render();
      },
      end: () => {
        this.carousel.moveCursorEnd();
        this.render();
      },
      delete: () => {
        this.carousel.deleteAtCursor();
        this.render();
        this.queueUpdateSuggestions();
      },
      tab: async () => {
        const completed = await this.tryAutocompleteFile();
        if (completed) return;
        this.toggleTopSuggester();
      },
      escape: () => {},
    };
  }

  async init() {
    await this.history.init();
    await this.ai.init();
    await this.files.init();
  }

  async run() {
    await this.init();
    this.keyboard.enableCapture();

    this.onKeyHandler = (evt: KeyEvent) => {
      void this.handleKey(evt);
    };
    this.keyboard.on("key", this.onKeyHandler);

    // Initial draw
    this.render();
    await this.carousel.updateSuggestions();
  }

  end() {
    if (this.onKeyHandler) {
      this.keyboard.off("key", this.onKeyHandler);
      this.onKeyHandler = undefined;
    }
    this.keyboard.disableCapture();
  }

  async handleKey(evt: KeyEvent) {
    const fn = this.handlers[evt.name];
    if (fn) {
      await fn(evt);
    }
  }

  private render() {
    this.carousel.render();
    // Cursor placement handled inside carousel render.
  }

  private async runCommand(cmd: string) {
    const { yellow, reset } = colors;
    if (!cmd) {
      // Log an empty line
      this.terminal.renderBlock([">"]);
      this.terminal.write("\n");
      return;
    }

    // Log command in yellow
    const width = process.stdout.columns || 80;
    const lines = [`${yellow}$ ${cmd}${reset}`];
    this.terminal.renderBlock(lines);
    // Ensure command output starts on the next line
    this.terminal.write("\n");

    this.keyboard.disableCapture();
    this.terminal.disableWrites();
    try {
      const storeInHistory = await runUserCommand(cmd);
      if (storeInHistory) {
        await this.broadcastCommand(cmd);
      }
    } finally {
      this.terminal.enableWrites();
      this.terminal.reset();
      this.keyboard.enableCapture();
    }
  }

  private async enterOnPrompt() {
    // Check for '\' line continuation
    const lineInfo = this.carousel.getInputLineInfoAtCursor();
    if (
      lineInfo.lineText.endsWith("\\") &&
      lineInfo.column === lineInfo.lineText.length
    ) {
      this.carousel.insertAtCursor("\n");
      this.render();
      this.queueUpdateSuggestions();
      return;
    }
    const rawInput = this.carousel.getInputBuffer();
    const cmd = collapseLineContinuations(rawInput).trim();
    await this.confirmCommandRun(cmd);
  }

  private async enterOnSuggestion() {
    const cmd = this.carousel.getCurrentRow().trim();
    await this.confirmCommandRun(cmd);
  }

  private async confirmCommandRun(cmd: string) {
    this.carousel.setInputBuffer("", 0);
    await this.runCommand(cmd);
    // Carousel should point to the prompt
    this.carousel.resetIndex();
    // After arbitrary output, reset render block tracking
    this.terminal.resetBlockTracking();
    // Render the prompt, without this we'd wait for the suggestions to call render
    // and it would appear slow
    this.render();
    this.queueUpdateSuggestions();
  }

  private exit() {
    // Clear terminal contents before shutting down to leave a clean screen.
    this.terminal.renderBlock([]);
    this.end();
    process.exit(0);
  }

  private async tryAutocompleteFile(): Promise<boolean> {
    const wordInfo = this.carousel.getWordInfoAtCursor();
    if (!wordInfo.prefix) return false;
    const match = await this.files.findUniqueMatch(wordInfo.prefix);
    if (!match) return false;
    const current = this.carousel.getRow(0);
    const before = current.slice(0, wordInfo.start);
    const after = current.slice(wordInfo.end);
    const next = `${before}${match}${after}`;
    this.carousel.setInputBuffer(next, wordInfo.start + match.length);
    this.render();
    this.queueUpdateSuggestions();
    return true;
  }

  private tryAcceptHighlightedFileSuggestion(): boolean {
    // After ENTER on a file suggestion, we want to place the match at the cursor
    const currentSuggester = this.carousel.getCurrentRowSuggester();
    if (currentSuggester !== this.files) return false;
    const suggestion = this.carousel.getCurrentRow();
    if (!suggestion) return false;
    const wordInfo = this.carousel.getWordInfoAtCursor();
    const current = this.carousel.getRow(0);
    const before = current.slice(0, wordInfo.start);
    const after = current.slice(wordInfo.end);
    const nextInput = `${before}${suggestion}${after}`;
    this.carousel.setInputBuffer(nextInput, wordInfo.start + suggestion.length);
    this.carousel.resetIndex();
    this.showHistorySuggestions();
    this.render();
    this.queueUpdateSuggestions();
    return true;
  }

  private toggleTopSuggester() {
    if (this.usingFileSuggestions) {
      this.showHistorySuggestions();
    } else {
      this.showFileSuggestions();
    }
    this.render();
    this.queueUpdateSuggestions();
  }

  private showHistorySuggestions() {
    if (!this.usingFileSuggestions) return;
    this.usingFileSuggestions = false;
    this.carousel.setTopSuggester(this.history);
  }

  private showFileSuggestions() {
    if (this.usingFileSuggestions) return;
    this.usingFileSuggestions = true;
    this.carousel.setTopSuggester(this.files);
  }

  private async broadcastCommand(cmd: string) {
    const listeners = this.suggesters
      .map((suggester) => suggester.onCommandRan?.(cmd))
      .filter(Boolean) as Promise<void>[];
    if (listeners.length === 0) return;
    try {
      await Promise.all(listeners);
    } catch (err: any) {
      logLine("suggester onCommandRan error: " + err?.message);
    }
  }
}
