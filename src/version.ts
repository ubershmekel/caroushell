import { readFileSync } from "fs";
import { resolve } from "path";

let version: string | undefined;

/** Caroushell's version from package.json (one level up from both src/ and dist/). */
export function getVersion(): string {
  if (version === undefined) {
    const pkgJsonPath = resolve(__dirname, "..", "package.json");
    version = String(JSON.parse(readFileSync(pkgJsonPath, "utf8")).version);
  }
  return version;
}
