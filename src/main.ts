#!/usr/bin/env node
import { App } from "./app";
import { ensureLogFolderExists, logLine } from "./logs";

async function main() {
  await ensureLogFolderExists();
  logLine("Caroushell started");
  const app = new App();
  await app.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
