import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
interface Config {
  GEMINI_API_KEY: string;
}

export function configFolder(subpath: string): string {
  const home = os.homedir();
  // Default path: ~/.caroushell/history
  return path.join(home, ".caroushell", subpath);
}

export async function getConfig(): Promise<Config> {
  // Load config from ~/.caroushell/config.json
  const configPath =
    process.env.CAROUSHELL_CONFIG_PATH || configFolder("config.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  return config;
}
