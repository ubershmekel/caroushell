import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Create a temporary test directory and return its canonical absolute path. */
export async function makeTempDirectory(prefix: string): Promise<string> {
  // On macOS, tmpdir() can return /var/folders/..., while /var is a symlink to
  // /private/var. After process.chdir(), process.cwd() returns /private/var/...
  // instead. Resolve the fixture path now so later path comparisons use the
  // same spelling for the same directory.
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}
