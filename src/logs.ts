import { promises as fs } from "fs";
import * as path from "path";
import { configFolder } from "./config";

function getLogDir(): string {
  return configFolder("logs");
}

function getLogFilePath(d = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return path.join(getLogDir(), `${mm}-${dd}.txt`);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function timestamp(date = new Date()): string {
  // local time iso string

  return date.toISOString();
}

export async function logLine(
  message: string,
  when = new Date()
): Promise<void> {
  const dir = getLogDir();
  await ensureDir(dir);
  const file = getLogFilePath(when);
  const line = `[${timestamp(when)}] ${message}\n`;
  await fs.appendFile(file, line, "utf8");
}

// Ensure the ~/.caroushell/logs folder exists early in app startup
export async function ensureLogFolderExists(): Promise<string> {
  const dir = getLogDir();
  await ensureDir(dir);
  return dir;
}
