import { promises as fs } from "fs";
import os from "os";
import path from "path";
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
    const query = queryRaw.trim();
    const { dirDisplay, fragment, dirPath } = this.parseQuery(query);
    const entries = await this.readDirectory(dirPath);
    const needle = fragment.toLowerCase();
    return entries
      .filter((entry) => entry.toLowerCase().startsWith(needle))
      .map((entry) => `${dirDisplay}${entry}`);
  }

  private async readDirectory(dirPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dirPath);
      return entries.sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  private parseQuery(query: string) {
    const lastForward = query.lastIndexOf("/");
    const lastBackward = query.lastIndexOf("\\");
    const lastSeparator = Math.max(lastForward, lastBackward);
    if (lastSeparator === -1) {
      return {
        dirDisplay: "",
        fragment: query,
        dirPath: process.cwd(),
      };
    }
    const dirDisplay = query.slice(0, lastSeparator + 1);
    const fragment = query.slice(lastSeparator + 1);
    return {
      dirDisplay,
      fragment,
      dirPath: this.resolveDirectory(dirDisplay),
    };
  }

  private resolveDirectory(dirDisplay: string): string {
    if (!dirDisplay) {
      return process.cwd();
    }
    if (dirDisplay.startsWith("~")) {
      const rest = dirDisplay.slice(1);
      const normalizedRest = rest.replace(/^[\\/]/, "");
      return path.resolve(
        os.homedir(),
        normalizedRest.replace(/\//g, path.sep)
      );
    }
    const converted = dirDisplay.replace(/\//g, path.sep);
    return path.resolve(process.cwd(), converted);
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
