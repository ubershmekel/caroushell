import { promises as fs } from "fs";
import path from "path";
import type { Carousel, Suggester } from "./carousel";
import { configFolder } from "./config";

const maxFileAiLines = 10;

export class FileSuggester implements Suggester {
  prefix = "📂";
  files: string[] = [];
  async init() {}
  async suggest(carousel: Carousel, maxDisplayed: number): Promise<string[]> {
    const promptBuffer = carousel.getCurrentRow();
    this.files = await fs.readdir(process.cwd());
    if (!promptBuffer) {
      return this.files;
    }

    // go left from the cursor until you see whitespace
    const cursor = carousel.getInputCursor();
    let left = cursor;
    while (left > 0 && !/\s/.test(promptBuffer[left - 1])) {
      left--;
    }
    const query = promptBuffer.slice(left, cursor).toLowerCase();

    return this.files.filter((f) => f.toLowerCase().indexOf(query)).sort();
  }

  descriptionForAi(): string {
    return `# File context

The current directory is ${process.cwd()}.

Thefiles in the current directory are:

${this.files.slice(0, maxFileAiLines).join("\n")}`;
  }
}
