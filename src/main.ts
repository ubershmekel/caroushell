#!/usr/bin/env node
import { App } from "./app";
import { AISuggester } from "./ai-suggester";
import { runHelloNewUserFlow } from "./hello-new-user";
import { ensureLogFolderExists, logLine } from "./logs";
import { doesConfigExist, getConfigPath, getConfig } from "./config";
import { buildPromptLine0 } from "./prompt";
import { getVersion } from "./version";

function shouldPrintVersion(): boolean {
  return process.argv.includes("--version");
}

function printVersion() {
  console.log("caroushell version:", getVersion());
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
  const ai =
    config.apiUrl && config.apiKey && config.model
      ? new AISuggester()
      : undefined;
  const app = new App({
    ai,
    // Without AI, the bottom panel navigates folders instead of sitting empty.
    panels: { bottom: ai ? "ai" : "folders" },
    promptLine0: buildPromptLine0(config),
  });
  await app.run();
}

main().catch((err) => {
  console.error("Caroushell uncaught error:");
  console.error(err);
  process.exit(1);
});
