import { Terminal } from "./terminal";
import { Keyboard, KeyEvent } from "./keyboard";
import { Carousel } from "./carousel";
import { HistorySuggester } from "./history-suggester";
import { AISuggester } from "./ai-suggester";
import { spawn } from "child_process";

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
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

  private inputBuffer = "";
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
    });
  }

  async init() {
    await this.history.init?.();
  }

  async run() {
    await this.init();
    this.terminal.hideCursor();
    this.keyboard.start();

    const updateSuggestions = debounce(async () => {
      await this.carousel.update(this.inputBuffer);
      this.render();
    }, 120);

    const handlers: Record<string, (evt: KeyEvent) => void | Promise<void>> = {
      "ctrl-c": () => this.exit(),
      "ctrl-d": () => {
        if (this.inputBuffer.length === 0) this.exit();
      },
      backspace: () => {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        // Immediate prompt redraw with existing suggestions
        this.render();
        // Async fetch of new suggestions
        updateSuggestions();
      },
      enter: async () => {
        const cmd = this.inputBuffer.trim();
        this.inputBuffer = "";
        await this.runCommand(cmd);
        updateSuggestions();
      },
      char: (evt) => {
        this.inputBuffer += evt.sequence;
        // Immediate prompt redraw with existing suggestions
        this.render();
        // Async fetch of new suggestions
        // updateSuggestions();
      },
      up: () => {},
      down: () => {},
      left: () => {},
      right: () => {},
      home: () => {},
      end: () => {},
      delete: () => {},
      escape: () => {},
    };

    this.keyboard.on("key", async (evt: KeyEvent) => {
      const fn = handlers[evt.name];
      if (fn) await fn(evt);
    });

    // Initial draw
    await this.carousel.update("");
    this.render();
  }

  private render() {
    const { yellow, reset } = this.terminal.color;
    const promptText = `$ ` + this.inputBuffer;
    this.carousel.render(this.terminal, promptText);
    // Ensure cursor is at end position (last line, end of prompt)
    // Nothing additional needed since we render full block each time.
  }

  private async runCommand(cmd: string) {
    const { yellow, reset } = this.terminal.color;
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
    this.terminal.showCursor();
    process.exit(0);
  }
}
