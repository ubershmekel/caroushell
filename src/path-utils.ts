import os from "node:os";
import path from "node:path";

export function expandHomePath(input: string): string {
  const tildeIndex = findHomeMarkerIndex(input);
  if (tildeIndex === -1) {
    return input;
  }

  const prefix = input.slice(0, tildeIndex);
  const suffix = input.slice(tildeIndex + 1);
  const normalizedSuffix = suffix.replace(/^[\\/]/, "");
  const expandedHome =
    normalizedSuffix === ""
      ? os.homedir()
      : path.resolve(os.homedir(), normalizedSuffix.replace(/[\\/]/g, path.sep));

  return prefix + expandedHome;
}

function findHomeMarkerIndex(input: string): number {
  if (input === "~" || input.startsWith("~/") || input.startsWith("~\\")) {
    return 0;
  }

  const equalsTilde = input.indexOf("=~");
  if (equalsTilde === -1) {
    return -1;
  }

  const tildeIndex = equalsTilde + 1;
  const next = input[tildeIndex + 1];
  if (next === undefined || next === "/" || next === "\\") {
    return tildeIndex;
  }
  return -1;
}
