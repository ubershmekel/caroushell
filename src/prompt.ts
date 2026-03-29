import * as os from "os";

import type { Config } from "./config";

function normalizeCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/");
  const home = os.homedir().replace(/\\/g, "/");
  if (normalized === home) return "~";
  if (normalized.startsWith(home + "/")) {
    return "~" + normalized.slice(home.length);
  }
  return normalized;
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  return parts
    .map((part, i) => {
      if (i === parts.length - 1) return part;
      if (part === "" || part === "~") return part;
      return part[0];
    })
    .join("/");
}

function getCurrentUsername(): string {
  return process.env.USERNAME || process.env.USER || os.userInfo().username;
}

export function buildPromptLine0(config: Config): () => string {
  return () => {
    const normalized = normalizeCwd(process.cwd());
    const username = getCurrentUsername();
    const template = config.prompt ?? "$> ";
    return template
      .replace(/\{hostname\}/g, os.hostname())
      .replace(/\{directory\}/g, normalized)
      .replace(/\{short-directory\}/g, shortenPath(normalized))
      .replace(/\{user\}/g, username);
  };
}
