import { promises as fs } from 'fs';
import path from 'path';

export interface Suggester {
  init?(): Promise<void> | void;
  suggest(input: string, count: number): Promise<string[]>;
}

export class HistorySuggester implements Suggester {
  private filePath: string;
  private items: string[] = [];
  private maxItems = 1000;

  constructor(filePath?: string) {
    const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
    // Default path: ~/.caroushell/history
    this.filePath = filePath || path.join(home, '.caroushell', 'history');
  }

  async init() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    } catch {}
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      this.items = data.split(/\r?\n/).filter(Boolean);
    } catch {
      this.items = [];
    }
  }

  async add(command: string) {
    if (!command.trim()) return;
    // Deduplicate recent duplicate
    if (this.items[this.items.length - 1] !== command) {
      this.items.push(command);
      if (this.items.length > this.maxItems) this.items.shift();
      await fs.mkdir(path.dirname(this.filePath), { recursive: true }).catch(() => {});
      await fs.writeFile(this.filePath, this.items.join('\n'), 'utf8');
    }
  }

  async suggest(input: string, count: number): Promise<string[]> {
    if (!input) {
      return this.items.slice(-count).reverse();
    }
    const q = input.toLowerCase();
    const matched = [] as string[];
    for (let i = this.items.length - 1; i >= 0 && matched.length < count; i--) {
      const it = this.items[i];
      if (it.toLowerCase().includes(q)) matched.push(it);
    }
    return matched;
  }
}
