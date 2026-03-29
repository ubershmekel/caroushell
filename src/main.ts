#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve } from "path";
import { App } from "./app";
import { AISuggester } from "./ai-suggester";
import { NullSuggester } from "./carousel";
import { runHelloNewUserFlow } from "./hello-new-user";
import { ensureLogFolderExists, logLine } from "./logs";
import { doesConfigExist, getConfigPath, getConfig } from "./config";
import { buildPromptLine0 } from "./prompt";

function shouldPrintVersion(): boolean {
  return process.argv.includes("--version");
}

function printVersion() {
  const pkgJsonPath = resolve(__dirname, "..", "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  console.log("caroushell version:", pkgJson.version);
}

async function main() {
  if (shouldPrintVersion()) {
    printVersion();
    return;
  }
  await ensureLogFolderExists();
  logLine("Caroushell started");
  if (!(await doesConfigExist())) {
    await runHelloNewUserFlow(getConfigPath());
  }
  const config = await getConfig();
  const bottomPanel =
    config.apiUrl && config.apiKey && config.model
      ? new AISuggester()
      : new NullSuggester();
  const app = new App({ bottomPanel, promptLine0: buildPromptLine0(config) });
  await app.run();
}

main().catch((err) => {
  console.error("Caroushell uncaught error:");
  console.error(err);
  process.exit(1);
});
