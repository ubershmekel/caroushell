import { promises as fs } from "fs";
import * as path from "path";
import readline from "readline";
import { listModels } from "./ai-suggester";

const preferredModels = ["gemini-2.5-flash-lite", "gpt-4o-mini"];

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

function findShortestMatches(
  models: string[],
  preferredList: string[]
): string[] {
  const matches: string[] = [];
  for (const pref of preferredList) {
    const hits = models.filter((modelId) => modelId.includes(pref));
    if (hits.length) {
      const shortest = hits.reduce((best, candidate) =>
        candidate.length < best.length ? candidate : best
      );
      matches.push(shortest);
    }
  }
  return [...new Set(matches)];
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
        "Please enter an API key. The value is stored in the local config file."
      );
    }
  }

  const models = await listModels(apiUrl, apiKey);
  if (models.length > 0) {
    const preferred = findShortestMatches(models, preferredModels);

    console.log(
      "Here are a few example model ids from your api service. Choose a fast and cheap model because AI suggestions happen as you type."
    );
    for (const model of models.slice(0, 5)) {
      console.log(`  - ${model}`);
    }

    if (preferred.length) {
      console.log("Recommended models from your provider:");
      for (const model of preferred) {
        console.log(`  - ${model}`);
      }
    }
  }

  let model = "";
  while (!model) {
    const answer = (await prompt("Model id: ", rl)).trim();
    if (answer) {
      model = answer;
    } else {
      console.log(
        "Please enter a model id (example: google/gemini-2.5-flash-lite, mistralai/mistral-small-24b-instruct-2501)."
      );
    }
  }

  rl.close();

  const config: HelloConfig = {
    apiUrl,
    apiKey,
    model,
  };

  const tomlBody = Object.entries(config)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join("\n");

  await fs.writeFile(configPath, tomlBody + "\n", "utf8");

  console.log(`\nSaved config to ${configPath}`);
  console.log(
    "You can edit this file later if you want to switch providers.\n"
  );

  return config;
}
