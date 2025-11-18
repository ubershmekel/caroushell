import { Terminal, colors } from "./terminal";
import { Keyboard, KeyEvent } from "./keyboard";
import { Carousel } from "./carousel";
import { HistorySuggester } from "./history-suggester";
import { AISuggester } from "./ai-suggester";
import { FileSuggester } from "./file-suggester";
import { runUserCommand } from "./spawner";

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  // Debounce function to limit the rate at which a function can fire
  let t: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export class App {
  terminal: Terminal;
  keyboard: Keyboard;
  carousel: Carousel;

  private history: HistorySuggester;
  private ai: AISuggester;
  private files: FileSuggester;
  private handlers: Record<string, (evt: KeyEvent) => void | Promise<void>>;
  private queueUpdateSuggestions: () => void;
  private usingFileSuggestions = false;

  constructor() {
    this.terminal = new Terminal();
    this.keyboard = new Keyboard();
    this.history = new HistorySuggester();
    this.ai = new AISuggester();
    this.files = new FileSuggester();
    this.carousel = new Carousel({
      top: this.history,
      bottom: this.ai,
      topRows: 2,
      bottomRows: 2,
      terminal: this.terminal,
    });

    this.queueUpdateSuggestions = debounce(async () => {
      await this.carousel.updateSuggestions();
    }, 300);

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
        const cmd = this.carousel.getCurrentRow().trim();
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
      },
      char: (evt) => {
        this.carousel.insertAtCursor(evt.sequence);
        // Immediate prompt redraw with existing suggestions
        this.render();
        // Async fetch of new suggestions
        this.queueUpdateSuggestions();
      },
      up: () => {
        this.carousel.up();
        this.render();
      },
      down: () => {
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
      tab: () => {
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
    this.keyboard.start();

    this.keyboard.on("key", (evt: KeyEvent) => {
      void this.handleKey(evt);
    });

    // Initial draw
    this.render();
    await this.carousel.updateSuggestions();
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

    this.keyboard.pause();
    try {
      const storeInHistory = await runUserCommand(cmd);
      if (storeInHistory) {
        await this.history.add(cmd);
      }
    } finally {
      this.keyboard.resume();
    }
  }

  private exit() {
    // Clear terminal contents before shutting down to leave a clean screen.
    this.terminal.renderBlock([]);
    this.keyboard.stop();
    process.exit(0);
  }

  private toggleTopSuggester() {
    this.usingFileSuggestions = !this.usingFileSuggestions;
    const next = this.usingFileSuggestions ? this.files : this.history;
    this.carousel.setTopSuggester(next);
    this.render();
    this.queueUpdateSuggestions();
  }
}
