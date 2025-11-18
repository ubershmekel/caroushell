import { promises as fs } from "fs";
import type { Carousel, Suggester } from "./carousel";

const maxFileAiLines = 10;

export class FileSuggester implements Suggester {
  prefix = "📂";
  private files: string[] = [];

  async init() {
    await this.refreshFiles();
  }

  private async refreshFiles() {
    try {
      const entries = await fs.readdir(process.cwd());
      this.files = entries.sort((a, b) => a.localeCompare(b));
    } catch {
      this.files = [];
    }
  }

  private async getMatchingFiles(queryRaw: string): Promise<string[]> {
    await this.refreshFiles();
    const query = queryRaw.trim().toLowerCase();
    if (!query) {
      return [...this.files];
    }
    return this.files.filter(
      (file) => file.toLowerCase().indexOf(query.toLowerCase()) === 0
    );
  }

  async suggest(carousel: Carousel, maxDisplayed: number): Promise<string[]> {
    const { prefix } = carousel.getWordInfoAtCursor();
    const matches = await this.getMatchingFiles(prefix);
    return matches;
  }

  async findUniqueMatch(prefix: string): Promise<string | null> {
    const normalized = prefix.trim();
    if (!normalized) return null;
    const matches = await this.getMatchingFiles(normalized);
    return matches.length === 1 ? matches[0] : null;
  }

  descriptionForAi(): string {
    const filesForAi = this.files.slice(0, maxFileAiLines);
    const list =
      filesForAi.length > 0 ? filesForAi.join("\n") : "(directory is empty)";
    return `# File context

The current directory is ${process.cwd()}.

The files in the current directory are:

${list}`;
  }
}
