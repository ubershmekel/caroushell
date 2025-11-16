import { promises as fs } from "fs";
import * as path from "path";
import readline from "readline";
import { listModels } from "./ai-suggester";

export type HelloConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function prompt(
  question: string,
  rl: readline.Interface
): Promise<string> {
  return await new Promise<string>((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

export async function runHelloNewUserFlow(
  configPath: string
): Promise<HelloConfig> {
  if (!isInteractive()) {
    throw new Error(
      `Missing config at ${configPath} and no interactive terminal is available.\n` +
        "Create the file manually or run Caroushell from a TTY."
    );
  }

  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });

  console.log("");
  console.log("Welcome to Caroushell!");
  console.log(
    `Let's set up AI suggestions. You'll need an API endpoint URL, a key, and model id. These will be stored at ${configPath}`
  );
  console.log("");
  console.log("Some example endpoints you can paste:");
  console.log("  - OpenRouter: https://openrouter.ai/api/v1");
  console.log("  - OpenAI:     https://api.openai.com/v1");
  console.log(
    "  - Google:     https://generativelanguage.googleapis.com/v1beta/openai"
  );
  console.log("");
  console.log("Press Ctrl+C any time to abort.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let apiUrl = "";
  while (!apiUrl) {
    const answer = (await prompt("API URL: ", rl)).trim();
    if (answer) {
      apiUrl = answer;
    } else {
      console.log("Please enter a URL (example: https://openrouter.ai/api/v1)");
    }
  }

  let apiKey = "";
  while (!apiKey) {
    const answer = (await prompt("API key: ", rl)).trim();
    if (answer) {
      apiKey = answer;
    } else {
      console.log(
        "Please enter an API key (the value stays local on this machine)."
      );
    }
  }

  const models = await listModels(apiUrl, apiKey);
  if (models.length > 0) {
    console.log("Here are a few example model ids.");
    for (const model of models.slice(0, 5)) {
      console.log(`  - ${model}`);
    }
  }

  let model = "";
  while (!model) {
    const answer = (
      await prompt(
        "Model (e.g. gpt-4o-mini, google/gemini-2.5-flash-lite): ",
        rl
      )
    ).trim();
    if (answer) {
      model = answer;
    } else {
      console.log(
        "Please enter a model name (example: mistralai/mistral-small-24b-instruct-2501)."
      );
    }
  }

  rl.close();

  const config: HelloConfig = {
    apiUrl,
    apiKey,
    model,
  };

  await fs.writeFile(
    configPath,
    JSON.stringify(config, null, 2) + "\n",
    "utf8"
  );

  console.log(`\nSaved config to ${configPath}`);
  console.log(
    "You can edit this file later if you want to switch providers.\n"
  );

  return config;
}
