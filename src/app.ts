import { Terminal, colors } from "./terminal";
import { Keyboard, KeyEvent } from "./keyboard";
import { Carousel } from "./carousel";
import { HistorySuggester } from "./history-suggester";
import { AISuggester } from "./ai-suggester";
import { spawn } from "child_process";

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

  constructor() {
    this.terminal = new Terminal();
    this.keyboard = new Keyboard();
    this.history = new HistorySuggester();
    this.ai = new AISuggester();
    this.carousel = new Carousel({
      top: this.history,
      bottom: this.ai,
      topRows: 2,
      bottomRows: 2,
      terminal: this.terminal,
    });
  }

  async init() {
    await this.history.init();
    await this.ai.init();
  }

  async run() {
    await this.init();
    this.keyboard.start();

    const updateSuggestions = debounce(async () => {
      await this.carousel.updateSuggestions();
    }, 300);

    const handlers: Record<string, (evt: KeyEvent) => void | Promise<void>> = {
      "ctrl-c": () => {
        if (
          this.carousel.isPromptRowSelected() &&
          !this.carousel.hasInput()
        ) {
          this.exit();
          return;
        }
        this.carousel.clearInput();
        this.render();
        updateSuggestions();
      },
      "ctrl-d": () => {
        if (
          this.carousel.isPromptRowSelected() &&
          !this.carousel.hasInput()
        ) {
          this.exit();
          return;
        }
        this.carousel.deleteAtCursor();
        this.render();
        updateSuggestions();
      },
      "ctrl-u": () => {
        this.carousel.deleteToLineStart();
        this.render();
        updateSuggestions();
      },
      backspace: () => {
        this.carousel.deleteBeforeCursor();
        // Immediate prompt redraw with existing suggestions
        this.render();
        // Async fetch of new suggestions
        updateSuggestions();
      },
      enter: async () => {
        const cmd = this.carousel.getCurrentRow().trim();
        this.carousel.setInputBuffer("", 0);
        await this.runCommand(cmd);
        this.carousel.resetIndex();
        updateSuggestions();
      },
      char: (evt) => {
        this.carousel.insertAtCursor(evt.sequence);
        // Immediate prompt redraw with existing suggestions
        this.render();
        // Async fetch of new suggestions
        updateSuggestions();
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
        updateSuggestions();
      },
      escape: () => {},
    };

    this.keyboard.on("key", async (evt: KeyEvent) => {
      const fn = handlers[evt.name];
      if (fn) await fn(evt);
    });

    // Initial draw
    this.render();
    await this.carousel.updateSuggestions();
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
      this.terminal.resetBlockTracking();
      return;
    }

    // Log command in yellow
    const width = process.stdout.columns || 80;
    const lines = [`${yellow}$ ${cmd}${reset}`];
    this.terminal.renderBlock(lines);
    // Ensure command output starts on the next line
    this.terminal.write("\n");

    await this.history.add(cmd);

    // Spawn shell
    const isWin = process.platform === "win32";
    const proc = spawn(
      isWin ? "cmd.exe" : "/bin/bash",
      [isWin ? "/c" : "-lc", cmd],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    await new Promise<void>((resolve) => {
      proc.stdout.on("data", (d) => process.stdout.write(d));
      proc.stderr.on("data", (d) => process.stderr.write(d));
      proc.on("close", () => resolve());
    });

    // After arbitrary output, reset render block tracking
    this.terminal.resetBlockTracking();
  }

  private exit() {
    this.keyboard.stop();
    process.exit(0);
  }
}
