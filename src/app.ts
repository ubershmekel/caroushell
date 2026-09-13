import { Terminal, colors } from "./terminal";
import { Keyboard, KeyEvent } from "./keyboard";
import {
  Carousel,
  NullSuggester,
  Suggester,
  wrapDisplayLine,
} from "./carousel";
import { HistorySuggester } from "./history-suggester";
import { FileSuggester } from "./file-suggester";
import { runUserCommand } from "./spawner";
import { logLine } from "./logs";
import { CaroushellMenu } from "./menu";
import { getVersion } from "./version";

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
  promptLine0?: () => string;
};

/** Remove backslash-newline pairs before passing multiline input to the shell. */
function collapseLineContinuations(input: string): string {
  return input.replace(/\\\r?\n/g, "");
}

export class App {
  terminal: Terminal;
  keyboard: Keyboard;
  carousel: Carousel;

  private history: Suggester;
  private bottomSuggester: Suggester;
  private files: FileSuggesterLike;
  private suggesters: Suggester[];
  private handlers: Partial<
    Record<KeyEvent["name"], (evt: KeyEvent) => void | Promise<void>>
  >;
  /**
   * Ask the visible suggesters to recompute for the current input without
   * waiting. Each suggester redraws the carousel itself when its results
   * arrive, so key handlers stay responsive even when e.g. the AI is slow.
   */
  private queueUpdateSuggestions: () => void;
  /** The "Off" choice in the menu: a suggester that shows no rows. */
  private off = new NullSuggester();
  /**
   * The panels the user chose in the menu (History by default on top).
   * These are the "home" panels that Tab completion temporarily replaces.
   */
  private selectedTop: Suggester;
  private selectedBottom: Suggester;
  /**
   * Which panel is temporarily showing file completions after Tab, or null
   * when both panels show the user's selection. Usually "top"; "bottom" when
   * the top panel is Off but the bottom one isn't, so files appear where the
   * user is already looking.
   */
  private completionPanel: "top" | "bottom" | null = null;
  /** The open settings menu (Alt+M or `.menu`); while set it receives all keys. */
  private menu: CaroushellMenu<Suggester> | null = null;
  private onKeyHandler?: (evt: KeyEvent) => void;
  private onProcessExit = () => this.end();

  constructor(deps: AppDeps = {}) {
    this.terminal = deps.terminal ?? new Terminal();
    this.keyboard = deps.keyboard ?? new Keyboard();
    this.history = deps.topPanel ?? new HistorySuggester();
    this.bottomSuggester = deps.bottomPanel ?? new NullSuggester();
    this.files = deps.files ?? new FileSuggester();
    this.selectedTop = this.history;
    this.selectedBottom = this.bottomSuggester;
    this.suggesters = deps.suggesters ?? [
      this.history,
      this.bottomSuggester,
      this.files,
    ];
    this.carousel = new Carousel({
      top: this.history,
      bottom: this.bottomSuggester,
      terminal: this.terminal,
      promptLine0: deps.promptLine0,
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
        if (this.completionPanel) this.restorePanels();
        else this.showFileSuggestions();
        this.render();
        this.queueUpdateSuggestions();
      },
      "alt-m": () => this.openMenu(),
      escape: () => {
        this.restorePanels();
        this.render();
        this.queueUpdateSuggestions();
      },
    };
  }

  /** Initialize each configured suggester before requesting suggestions. */
  async init() {
    for (const s of this.suggesters) {
      await s.init();
    }
  }

  /**
   * Initialize suggestions, attach input and exit listeners, and draw the prompt.
   * Resolves after the initial suggestion update; keyboard events keep the app
   * interactive afterward. If terminal setup or the first update fails, release
   * terminal and keyboard state before propagating the error.
   */
  async run() {
    await this.init();
    this.onKeyHandler = (evt: KeyEvent) => {
      void this.handleKey(evt);
    };
    this.keyboard.on("key", this.onKeyHandler);
    process.once("exit", this.onProcessExit);

    try {
      this.keyboard.enableCapture();
      this.terminal.reset();
      // Initial draw
      this.render();
      await this.carousel.updateSuggestions();
    } catch (err) {
      this.end();
      throw err;
    }
  }

  /**
   * Release terminal state, detach listeners, and stop capturing keyboard input.
   * Used for startup failures and process exit; does not terminate the process.
   */
  end() {
    process.off("exit", this.onProcessExit);
    this.terminal.release();
    if (this.onKeyHandler) {
      this.keyboard.off("key", this.onKeyHandler);
      this.onKeyHandler = undefined;
    }
    this.keyboard.disableCapture();
  }

  /** Dispatch a recognized key and wait for any asynchronous handler to finish. */
  async handleKey(evt: KeyEvent) {
    if (this.menu) {
      const result = this.menu.handleKey(evt);
      if (result?.action === "select") {
        if (result.panel === "top") this.selectedTop = result.value;
        else this.selectedBottom = result.value;
        this.restorePanels();
      }
      if (result) this.closeMenu();
      this.render();
      return;
    }
    const fn = this.handlers[evt.name];
    if (fn) {
      await fn(evt);
    }
  }

  private render() {
    this.carousel.render();
    // Cursor placement handled inside carousel render.
  }

  /**
   * Echo and execute a command while giving it control of terminal input/output.
   * Notify suggesters before execution and, when eligible, afterward for history.
   * Restore carousel terminal writes and keyboard capture even if execution fails.
   * Empty commands only print a prompt marker.
   */
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
    const lines = wrapDisplayLine(`${yellow}$ ${cmd}${reset}`, width).lines;
    this.terminal.renderBlock(lines);
    // Ensure command output starts on the next line
    this.terminal.write("\n");

    this.terminal.release();
    this.keyboard.disableCapture();
    this.terminal.disableWrites();
    try {
      await this.preBroadcastCommand(cmd);
      const storeInHistory = await runUserCommand(cmd);
      if (storeInHistory) {
        await this.broadcastCommand(cmd);
      }
    } finally {
      this.terminal.enableWrites();
      this.keyboard.enableCapture();
      this.terminal.reset();
    }
  }

  /** Insert a continued line at a trailing backslash, or submit the prompt. */
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
    if (cmd === ".menu") {
      this.carousel.clearInput();
      this.openMenu();
      return;
    }
    await this.confirmCommandRun(cmd);
  }

  private async enterOnSuggestion() {
    const cmd = this.carousel.getCurrentRow().trim();
    await this.confirmCommandRun(cmd);
  }

  /** Clear submitted input, run the command, then redraw and refresh suggestions. */
  private async confirmCommandRun(cmd: string) {
    this.carousel.setInputBuffer("", 0);
    this.restorePanels();
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

  /** Clear the carousel, release input and terminal state, and exit successfully. */
  private exit() {
    // Clear terminal contents before shutting down to leave a clean screen.
    this.terminal.renderBlock([]);
    this.end();
    process.exit(0);
  }

  private async tryAutocompleteFile(): Promise<boolean> {
    const wordInfo = this.carousel.getWordInfoAtCursor();
    if (!wordInfo.prefix) return false;
    const input = this.carousel.getInputBuffer();
    const match = await this.files.findUniqueMatch(wordInfo.prefix);
    if (this.menu || input !== this.carousel.getInputBuffer()) return true;
    if (!match) return false;
    const current = this.carousel.getRow(0);
    const before = current.slice(0, wordInfo.start);
    const after = current.slice(wordInfo.end);
    const next = `${before}${match}${after}`;
    this.carousel.setInputBuffer(next, wordInfo.start + match.length);
    this.restorePanels();
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
    this.restorePanels();
    this.render();
    this.queueUpdateSuggestions();
    return true;
  }

  /** Suggesters the menu offers for each panel. AI is listed only when configured. */
  private sources() {
    const choices = [
      { label: "History", value: this.history },
      { label: "Files", value: this.files },
    ];
    if (!(this.bottomSuggester instanceof NullSuggester)) {
      choices.push({ label: "AI", value: this.bottomSuggester });
    }
    choices.push({ label: "Off", value: this.off });
    return choices;
  }

  /** Show the settings menu in place of the carousel, dropping any Tab completion first. */
  private openMenu() {
    this.restorePanels();
    this.menu = new CaroushellMenu(
      this.sources(),
      { top: this.selectedTop, bottom: this.selectedBottom },
      getVersion(),
    );
    this.carousel.setOverlay(() => this.menu!.lines());
    this.render();
  }

  /** Hide the menu and refresh suggestions, since the panels may have changed. */
  private closeMenu() {
    this.menu = null;
    this.carousel.setOverlay(null);
    this.queueUpdateSuggestions();
  }

  /**
   * Leave Tab completion mode: put the user's menu-selected suggesters back
   * into both panels. Safe to call when not in completion mode.
   */
  private restorePanels() {
    this.completionPanel = null;
    this.carousel.setPanels(this.selectedTop, this.selectedBottom);
  }

  /**
   * Enter Tab completion mode: swap file suggestions into one panel (see
   * completionPanel) while leaving the other panel as the user selected it.
   */
  private showFileSuggestions() {
    if (this.completionPanel) return;
    this.completionPanel =
      this.selectedTop instanceof NullSuggester &&
      !(this.selectedBottom instanceof NullSuggester)
        ? "bottom"
        : "top";
    this.carousel.setPanels(
      this.completionPanel === "top" ? this.files : this.selectedTop,
      this.completionPanel === "bottom" ? this.files : this.selectedBottom,
    );
  }

  private async preBroadcastCommand(cmd: string) {
    const listeners = this.suggesters
      .map((suggester) => suggester.onCommandWillRun?.(cmd))
      .filter(Boolean) as Promise<void>[];
    if (listeners.length === 0) return;
    try {
      await Promise.all(listeners);
    } catch (err: any) {
      logLine("suggester onCommandWillRun error: " + err?.message);
    }
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
