#!/usr/bin/env node
import { get } from "http";
import { App } from "./app";
import { runHelloNewUserFlow } from "./hello-new-user";
import { ensureLogFolderExists, logLine } from "./logs";
import { doesConfigExist, getConfigPath } from "./config";

async function main() {
  await ensureLogFolderExists();
  logLine("Caroushell started");
  if (!(await doesConfigExist())) {
    await runHelloNewUserFlow(getConfigPath());
  }
  const app = new App();
  await app.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
