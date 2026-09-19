import { Terminal, colors } from "./terminal";
import { Keyboard, KeyEvent } from "./keyboard";
import {
  Carousel,
  NullSuggester,
  Suggester,
  SuggestionAction,
  wrapDisplayLine,
} from "./carousel";
import { HistorySuggester } from "./history-suggester";
import { FileSuggester } from "./file-suggester";
import { PathNavigatorSuggester } from "./path-navigator-suggester";
import { changeDirectory, runUserCommand } from "./spawner";
import { logLine } from "./logs";
import { CaroushellMenu, Panel, SuggesterKey } from "./menu";
import { getVersion } from "./version";

/** Tab completion inserts file rows, so Files must say how Enter accepts them. */
type FileSuggesterLike = Suggester & {
  accept(row: string): SuggestionAction;
  findUniqueMatch(prefix: string): Promise<string | null>;
};

/** Receives keys: the prompt normally, the menu while it's open. */
type KeyTarget = { handleKey(evt: KeyEvent): void | Promise<void> };

type AppDeps = {
  terminal?: Terminal;
  keyboard?: Keyboard;
  history?: Suggester;
  files?: FileSuggesterLike;
  folders?: Suggester;
  /** The configured AI suggester; the menu shows AI as disabled without it. */
  ai?: Suggester;
  /** Starting panels. Defaults to History on top and AI (or Off) below. */
  panels?: Partial<Record<Panel, SuggesterKey>>;
  /** Suggesters to init and notify about commands. Defaults to all of them. */
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

  private files: FileSuggesterLike;
  /** Every panel choice by key; "ai" is an Off suggester when AI isn't configured. */
  private panelSuggesters: Record<SuggesterKey, Suggester>;
  private aiConfigured: boolean;
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
  /**
   * The panels the user chose in the menu. These are the "home" panels that
   * Tab completion temporarily replaces.
   */
  private selected: Record<Panel, SuggesterKey>;
  /**
   * Which panel is temporarily showing file completions after Tab, or null
   * when both panels show the user's selection. Usually "top"; "bottom" when
   * the top panel is Off but the bottom one isn't, so files appear where the
   * user is already looking.
   */
  private completionPanel: Panel | null = null;
  private promptKeys: KeyTarget = {
    handleKey: async (evt) => {
      await this.handlers[evt.name]?.(evt);
    },
  };
  /** The prompt, or the settings menu (Alt+M or `.menu`) while it's open. */
  private keyTarget: KeyTarget = this.promptKeys;
  private onKeyHandler?: (evt: KeyEvent) => void;
  private onProcessExit = () => this.end();

  constructor(deps: AppDeps = {}) {
    this.terminal = deps.terminal ?? new Terminal();
    this.keyboard = deps.keyboard ?? new Keyboard();
    this.files = deps.files ?? new FileSuggester();
    this.aiConfigured = !!deps.ai;
    this.panelSuggesters = {
      history: deps.history ?? new HistorySuggester(),
      files: this.files,
      folders: deps.folders ?? new PathNavigatorSuggester(),
      ai: deps.ai ?? new NullSuggester(),
      off: new NullSuggester(),
    };
    this.selected = {
      top: deps.panels?.top ?? "history",
      bottom: deps.panels?.bottom ?? (this.aiConfigured ? "ai" : "off"),
    };
    this.suggesters = deps.suggesters ?? Object.values(this.panelSuggesters);
    this.carousel = new Carousel({
      top: this.panelSuggesters[this.selected.top],
      bottom: this.panelSuggesters[this.selected.bottom],
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
        const suggester = this.carousel.getCurrentRowSuggester();
        if (!suggester) {
          await this.enterOnPrompt();
          return;
        }
        const row = this.carousel.getCurrentRow();
        const action = (row && suggester.accept?.(row)) || { run: row.trim() };
        if ("insert" in action) {
          this.carousel.replaceWordAtCursor(action.insert);
          this.restorePanels();
          this.render();
          this.queueUpdateSuggestions();
        } else {
          await this.confirmAction(action);
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
    await this.keyTarget.handleKey(evt);
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
      this.terminal.printPermanent([">"]);
      return;
    }

    // Log command in yellow; its output starts on the next line
    const width = process.stdout.columns || 80;
    const lines = wrapDisplayLine(`${yellow}$ ${cmd}${reset}`, width).lines;
    this.terminal.printPermanent(lines);

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
    await this.confirmAction({ run: cmd });
  }

  /** Clear submitted input, run the command, then redraw and refresh suggestions. */
  private async confirmAction(
    action: Exclude<SuggestionAction, { insert: string }>,
  ) {
    this.carousel.setInputBuffer("", 0);
    this.restorePanels();
    if ("changeDirectory" in action) {
      try {
        changeDirectory(action.changeDirectory);
      } catch (err: any) {
        this.terminal.printPermanent([`cd: ${err.message}`]);
      }
    } else {
      await this.runCommand(action.run);
    }
    // Carousel should point to the prompt
    this.carousel.resetIndex();
    // Render the prompt, without this we'd wait for the suggestions to call render
    // and it would appear slow
    this.render();
    this.queueUpdateSuggestions();
  }

  /** Clear the carousel, release input and terminal state, and exit successfully. */
  private exit() {
    // Clear terminal contents before shutting down to leave a clean screen.
    this.terminal.printTemporary([]);
    this.end();
    process.exit(0);
  }

  private async tryAutocompleteFile(): Promise<boolean> {
    const wordInfo = this.carousel.getWordInfoAtCursor();
    if (!wordInfo.prefix) return false;
    const input = this.carousel.getInputBuffer();
    const cursor = this.carousel.getInputCursor();
    const selectedRow = this.carousel.getSelectedRowIndex();
    const match = await this.files.findUniqueMatch(wordInfo.prefix);
    if (this.keyTarget !== this.promptKeys) return true;
    if (input !== this.carousel.getInputBuffer()) return true;
    if (cursor !== this.carousel.getInputCursor()) return true;
    if (selectedRow !== this.carousel.getSelectedRowIndex()) return true;
    if (!match) return false;
    this.carousel.replaceWordAtCursor(match);
    this.restorePanels();
    this.render();
    this.queueUpdateSuggestions();
    return true;
  }

  /**
   * Show the settings menu in place of the carousel, dropping any Tab
   * completion first. Keys go to the menu until it closes.
   */
  private openMenu() {
    this.restorePanels();
    const menu = new CaroushellMenu({
      selected: { ...this.selected },
      disabled: this.aiConfigured
        ? {}
        : { ai: "(disabled until you set apiUrl, apiKey, model in config)" },
      version: getVersion(),
      onSelect: (panel, key) => {
        this.selected[panel] = key;
        this.closeMenu();
      },
      onClose: () => this.closeMenu(),
    });
    this.keyTarget = {
      handleKey: (evt) => {
        menu.handleKey(evt);
        this.render();
      },
    };
    this.carousel.setOverlay(() => menu.lines());
    this.render();
  }

  /** Hand keys back to the prompt and show the (possibly changed) panels. */
  private closeMenu() {
    this.keyTarget = this.promptKeys;
    this.carousel.setOverlay(null);
    this.restorePanels();
    this.queueUpdateSuggestions();
  }

  /** Put the suggesters for the selected keys, plus any Tab completion, into the carousel. */
  private applyPanels() {
    const suggesterFor = (panel: Panel) =>
      panel === this.completionPanel
        ? this.files
        : this.panelSuggesters[this.selected[panel]];
    this.carousel.setPanels(suggesterFor("top"), suggesterFor("bottom"));
  }

  /** Leave Tab completion mode. Safe to call when not in completion mode. */
  private restorePanels() {
    this.completionPanel = null;
    this.applyPanels();
  }

  /**
   * Enter Tab completion mode: swap file suggestions into one panel (see
   * completionPanel) while leaving the other panel as the user selected it.
   */
  private showFileSuggestions() {
    if (this.completionPanel) return;
    const { top, bottom } = this.selected;
    this.completionPanel = top === "off" && bottom !== "off" ? "bottom" : "top";
    this.applyPanels();
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
