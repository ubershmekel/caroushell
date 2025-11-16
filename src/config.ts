import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

export interface Config {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  GEMINI_API_KEY?: string;
}

const GEMINI_DEFAULT_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite";

export function configFolder(subpath: string): string {
  const home = os.homedir();
  // Default path: ~/.caroushell/<subpath>
  return path.join(home, ".caroushell", subpath);
}

export function getConfigPath(): string {
  return process.env.CAROUSHELL_CONFIG_PATH || configFolder("config.json");
}

async function readConfigFile(): Promise<Config> {
  const configPath = getConfigPath();
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw);
}

export async function doesConfigExist(): Promise<boolean> {
  const configPath = getConfigPath();
  try {
    await fs.access(configPath);
    const raw = await readConfigFile();
    if (!raw) return false;
    return true;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return false;
    }
    // detect empty json file syntax error
    if (err instanceof SyntaxError) {
      return false;
    }
    throw err;
  }
}

export async function getConfig(): Promise<Config> {
  const configPath = getConfigPath();
  const raw = await readConfigFile();
  const envApiKey =
    process.env.CAROUSHELL_API_KEY || process.env.GEMINI_API_KEY || undefined;
  const envApiUrl = process.env.CAROUSHELL_API_URL || undefined;
  const envModel = process.env.CAROUSHELL_MODEL || undefined;
  const geminiApiKey =
    raw.GEMINI_API_KEY || process.env.GEMINI_API_KEY || undefined;

  const resolved = {
    ...raw,
    apiUrl: raw.apiUrl || envApiUrl,
    apiKey: raw.apiKey || raw.GEMINI_API_KEY || envApiKey,
    model: raw.model || envModel,
  };

  // If the user only supplied a Gemini key, assume the Gemini defaults.
  if (!resolved.apiUrl && geminiApiKey) {
    resolved.apiUrl = GEMINI_DEFAULT_API_URL;
  }
  if (!resolved.model && geminiApiKey) {
    resolved.model = GEMINI_DEFAULT_MODEL;
  }

  if (!resolved.apiUrl || !resolved.apiKey || !resolved.model) {
    throw new Error(
      `Config at ${configPath} is missing required fields. Please include apiUrl, apiKey, and model (or just GEMINI_API_KEY).`
    );
  }

  return resolved;
}

function isGeminiUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("generativelanguage.googleapis.com") ||
    lower.includes("gemini")
  );
}
