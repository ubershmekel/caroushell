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

  async suggest(carousel: Carousel, maxDisplayed: number): Promise<string[]> {
    const promptBuffer = carousel.getCurrentRow();
    await this.refreshFiles();
    if (!promptBuffer) {
      return this.files;
    }

    const cursor = carousel.getInputCursor();
    let left = cursor;
    while (left > 0 && !/\s/.test(promptBuffer[left - 1])) {
      left -= 1;
    }
    const query = promptBuffer.slice(left, cursor).toLowerCase();
    const filtered = query
      ? this.files.filter((file) => file.toLowerCase().includes(query))
      : this.files;

    return filtered.slice(0, maxDisplayed);
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
