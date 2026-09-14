import { promises as fs } from "fs";
import path from "path";
import type { Carousel, Suggester } from "./carousel";
import { expandHomePath } from "./path-utils";

/**
 * Lists folders to cd into, filtered by the prompt input. A plain query is a
 * case-insensitive substring match against the current directory's folders
 * (prefix matches first); a query with a separator like "src/ut" lists the
 * folders inside "src". Enter on a row navigates to its literal path.
 */
export class PathNavigatorSuggester implements Suggester {
  prefix = "📁";
  private latestSuggestions: string[] = [];
  private destinations = new Map<string, string>();

  async init() {}

  latest(): string[] {
    return this.latestSuggestions;
  }

  async refreshSuggestions(carousel: Carousel): Promise<void> {
    const query = carousel.getInputBuffer();
    const suggestions = await this.getMatchingFolders(query);
    // Drop stale results if the input changed while reading the disk.
    if (query !== carousel.getInputBuffer()) return;
    this.latestSuggestions = suggestions;
    carousel.render();
  }

  async getMatchingFolders(queryRaw: string): Promise<string[]> {
    const query = queryRaw.trim();
    const lastSeparator = Math.max(
      query.lastIndexOf("/"),
      query.lastIndexOf("\\"),
    );
    const dirDisplay = query.slice(0, lastSeparator + 1);
    const needle = query.slice(lastSeparator + 1).toLowerCase();
    const dirPath = path.resolve(process.cwd(), expandHomePath(dirDisplay));
    const folders = await this.readFolders(dirPath);
    if (!folders) return [];
    const prefixed = folders.filter((name) =>
      name.toLowerCase().startsWith(needle),
    );
    const contained = folders.filter(
      (name) =>
        !name.toLowerCase().startsWith(needle) &&
        name.toLowerCase().includes(needle),
    );
    const names = [...prefixed, ...contained];
    if (!needle && path.dirname(dirPath) !== dirPath) names.unshift("..");
    const rows = names.map((name) => `${dirDisplay}${name}`);
    for (const [index, row] of rows.entries()) {
      this.destinations.set(row, path.resolve(dirPath, names[index]));
    }
    return rows;
  }

  /** Sorted folder names in dirPath, or null when it can't be read. */
  private async readFolders(dirPath: string): Promise<string[] | null> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const folders = await Promise.all(
        entries.map(async (entry) => {
          if (entry.isDirectory()) return entry.name;
          if (!entry.isSymbolicLink()) return null;
          const stat = await fs
            .stat(path.join(dirPath, entry.name))
            .catch(() => null);
          return stat?.isDirectory() ? entry.name : null;
        }),
      );
      return folders
        .filter((name): name is string => name !== null)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return null;
    }
  }

  accept(row: string) {
    return { changeDirectory: this.destinations.get(row) ?? path.resolve(row) };
  }

  descriptionForAi(): string {
    return "";
  }
}
