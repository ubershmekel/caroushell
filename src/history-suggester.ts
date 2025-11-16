import { promises as fs } from "fs";
import path from "path";
import type { Carousel, Suggester } from "./carousel";
import { configFolder } from "./config";

export class HistorySuggester implements Suggester {
  prefix = "⌛";
  private filePath: string;
  private items: string[] = [];
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
      this.items = data.split(/\r?\n/).filter(Boolean);
    } catch {
      this.items = [];
    }
  }

  async add(command: string) {
    if (!command.trim()) return;
    if (this.items[this.items.length - 1] === command) {
      // Deduplicate recent duplicate
      return;
    }
    this.items.push(command);
    if (this.items.length > this.maxItems) this.items.shift();
    await fs
      .mkdir(path.dirname(this.filePath), { recursive: true })
      .catch(() => {});
    await fs.writeFile(this.filePath, this.items.join("\n"), "utf8");
  }

  async suggest(carousel: Carousel, maxDisplayed: number): Promise<string[]> {
    const input = carousel.getCurrentRow();
    if (!input) {
      // this.items 0 index is oldest
      return this.items.reverse();
    }
    const q = input.toLowerCase();
    const matched = [] as string[];
    // iterate in reverse so we skip older duplicates
    const seen = new Set<string>();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.toLowerCase().includes(q) && !seen.has(it)) {
        seen.add(it);
        matched.push(it);
      }
    }
    return matched.reverse();
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
}
