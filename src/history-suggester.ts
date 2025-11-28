import { promises as fs } from "fs";
import path from "path";
import type { Carousel, Suggester } from "./carousel";
import { configFolder } from "./config";

export class HistorySuggester implements Suggester {
  prefix = "⌛";
  private filePath: string;
  private items: string[] = [];
  private filteredItems: string[] = [];
  private maxItems = 1000;

  constructor(filePath?: string) {
    const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
    // Default path: ~/.caroushell/history
    this.filePath = filePath || configFolder("history");
  }

  async init() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    } catch {}
    try {
      const data = await fs.readFile(this.filePath, "utf8");
      this.items = this.parseHistory(data);
      this.filteredItems = this.items;
    } catch {
      this.items = [];
      this.filteredItems = [];
    }
  }

  async add(command: string) {
    if (!command.trim()) return;
    if (this.items[0] === command) {
      // Deduplicate recent duplicate
      return;
    }
    this.items.unshift(command);
    if (this.items.length > this.maxItems) this.items.pop();
    await fs
      .mkdir(path.dirname(this.filePath), { recursive: true })
      .catch(() => {});
    await fs.appendFile(
      this.filePath,
      this.serializeHistoryEntry(command),
      "utf8"
    );
  }

  latest(): string[] {
    return this.filteredItems;
  }

  async refreshSuggestions(
    carousel: Carousel,
    maxDisplayed: number
  ): Promise<void> {
    const input = carousel.getCurrentRow();
    let suggestedItems = this.items;
    if (input) {
      // filter by input substring
      const q = input.toLowerCase();
      suggestedItems = [];
      // iterate from newest to oldest so we skip older duplicates
      const seen = new Set<string>();
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        if (it.toLowerCase().includes(q) && !seen.has(it)) {
          seen.add(it);
          suggestedItems.push(it);
        }
      }
    }
    this.filteredItems = suggestedItems;
    carousel.render();
  }

  descriptionForAi(): string {
    const lines = [];
    const maxHistoryLines = 20;
    const start = Math.max(0, this.items.length - maxHistoryLines);
    const end = this.items.length - 1;
    const reverseSlice = this.items.slice(start, end).reverse();
    if (reverseSlice.length > 0) {
      lines.push(`The most recent command is: "${reverseSlice[0]}"`);
    }
    if (reverseSlice.length > 1) {
      lines.push("The most recent commands are (from recent to oldest):");
      for (let i = 0; i < reverseSlice.length; i++) {
        lines.push(`  ${i + 1}. ${reverseSlice[i]}`);
      }
    }
    return lines.join("\n");
  }

  private parseHistory(data: string): string[] {
    const entries: string[] = [];
    let currentLines: string[] = [];

    const flush = () => {
      if (currentLines.length > 0) {
        entries.push(currentLines.join("\n"));
        currentLines = [];
      }
    };

    const rows = data.split(/\n/);
    for (const rawLine of rows) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith("+")) {
        currentLines.push(line.slice(1));
      } else {
        flush();
      }
    }
    flush();
    return entries.slice(-this.maxItems).reverse();
  }

  private serializeHistoryEntry(command: string): string {
    const timestamp = new Date().toISOString();
    const lines = command.split("\n").map((line) => `+${line}`);
    return `\n# ${timestamp}\n${lines.join("\n")}\n`;
  }
}
