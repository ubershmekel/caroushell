#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve } from "path";
import { App } from "./app";
import { runHelloNewUserFlow } from "./hello-new-user";
import { ensureLogFolderExists, logLine } from "./logs";
import { doesConfigExist, getConfigPath } from "./config";

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
  const app = new App();
  await app.run();
}

main().catch((err) => {
  console.error("Caroushell uncaught error:");
  console.error(err);
  process.exit(1);
});
