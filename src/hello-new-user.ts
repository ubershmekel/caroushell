import { promises as fs } from "fs";
import * as path from "path";
import readline from "readline";
import { listModels } from "./ai-suggester";

const preferredModels = ["gemini-2.5-flash-lite", "gpt-4o-mini"];
const defaultPromptTemplate = "$> ";
const promptPresets = [
  { key: "1", label: "Minimal", template: defaultPromptTemplate },
  { key: "2", label: "Hostname", template: "{hostname} > " },
  { key: "3", label: "Hostname + short path", template: "{hostname} {short-directory} > " },
  { key: "4", label: "Path", template: "{directory} > " },
] as const;

export type HelloConfig = {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  noAi?: boolean;
  prompt?: string;
};

type HelloPrompter = {
  ask(question: string): Promise<string>;
  close(): void;
};

type HelloTerminal = {
  createPrompter(): HelloPrompter;
  isInteractive(): boolean;
};

type HelloFlowDeps = {
  fsOps?: Pick<typeof fs, "mkdir" | "writeFile">;
  listModelsFn?: (apiUrl: string, apiKey: string) => Promise<string[]>;
  logFn?: (...args: any[]) => void;
  terminal?: HelloTerminal;
};

function serializeToml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  const sections: Array<[string, Record<string, unknown>]> = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && typeof value === "object" && value !== null) {
      sections.push([key, value as Record<string, unknown>]);
    } else if (value !== undefined) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }
  for (const [section, values] of sections) {
    lines.push(`\n[${section}]`);
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) {
        lines.push(`${key} = ${JSON.stringify(value)}`);
      }
    }
  }
  return lines.join("\n");
}

async function askPromptConfig(
  prompter: HelloPrompter,
  logFn: (...args: any[]) => void,
): Promise<string | undefined> {
  logFn("Choose a shell prompt style.");
  for (const preset of promptPresets) {
    logFn(`  ${preset.key}. ${preset.label}: ${preset.template}`);
  }
  logFn("");
  logFn("You can customize this later in the config file with these tokens:");
  logFn("  {hostname}");
  logFn("  {directory}");
  logFn("  {short-directory}");
  logFn(`Press Enter to keep the default prompt: ${defaultPromptTemplate}`);

  while (true) {
    const answer = (await prompter.ask("Prompt style [1-4]: ")).trim();
    if (!answer || answer === "1") {
      return undefined;
    }

    const preset = promptPresets.find((candidate) => candidate.key === answer);
    if (preset) {
      return preset.template;
    }

    logFn("Choose 1, 2, 3, or 4.");
  }
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function prompt(
  question: string,
  rl: readline.Interface,
): Promise<string> {
  return await new Promise<string>((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

function createReadlineTerminal(): HelloTerminal {
  return {
    createPrompter() {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return {
        ask(question: string) {
          return prompt(question, rl);
        },
        close() {
          rl.close();
        },
      };
    },
    isInteractive,
  };
}

function findShortestMatches(
  models: string[],
  preferredList: string[],
): string[] {
  const matches: string[] = [];
  for (const pref of preferredList) {
    const hits = models.filter((modelId) => modelId.includes(pref));
    if (hits.length) {
      const shortest = hits.reduce((best, candidate) =>
        candidate.length < best.length ? candidate : best,
      );
      matches.push(shortest);
    }
  }
  return [...new Set(matches)];
}

export async function runHelloNewUserFlow(
  configPath: string,
  deps: HelloFlowDeps = {},
): Promise<HelloConfig | null> {
  const fileSystem = deps.fsOps ?? fs;
  const listModelsFn = deps.listModelsFn ?? listModels;
  const logFn = deps.logFn ?? console.log;
  const terminal = deps.terminal ?? createReadlineTerminal();

  if (!terminal.isInteractive()) {
    throw new Error(
      `Missing config at ${configPath} and no interactive terminal is available.\n` +
        "Create the file manually or run Caroushell from a TTY.",
    );
  }

  const dir = path.dirname(configPath);
  await fileSystem.mkdir(dir, { recursive: true });

  logFn("");
  logFn("Welcome to Caroushell!");
  logFn("");

  const prompter = terminal.createPrompter();

  const promptConfig = await askPromptConfig(prompter, logFn);

  const wantsAi = (await prompter.ask("Do you want to set up AI auto-complete? (y/n): "))
    .trim()
    .toLowerCase();

  if (wantsAi !== "y" && wantsAi !== "yes") {
    prompter.close();
    const config: HelloConfig = { noAi: true, prompt: promptConfig };
    await fileSystem.writeFile(configPath, serializeToml(config) + "\n", "utf8");
    logFn(
      "\nSkipping AI setup. You can set it up later by editing " + configPath,
    );
    logFn("");
    return null;
  }

  logFn(
    `\nLet's set up AI suggestions. You'll need an API endpoint URL, a key, and model id. These will be stored at ${configPath}`,
  );
  logFn("");
  logFn("Some example endpoints you can paste:");
  logFn("  - OpenRouter: https://openrouter.ai/api/v1");
  logFn("  - OpenAI:     https://api.openai.com/v1");
  logFn(
    "  - Google:     https://generativelanguage.googleapis.com/v1beta/openai",
  );
  logFn("");
  logFn("Press Ctrl+C any time to abort.\n");

  let apiUrl = "";
  while (!apiUrl) {
    const answer = (await prompter.ask("API URL: ")).trim();
    if (answer) {
      apiUrl = answer;
    } else {
      logFn("Please enter a URL (example: https://openrouter.ai/api/v1)");
    }
  }

  let apiKey = "";
  while (!apiKey) {
    const answer = (await prompter.ask("API key: ")).trim();
    if (answer) {
      apiKey = answer;
    } else {
      logFn(
        "Please enter an API key. The value is stored in the local config file.",
      );
    }
  }

  const models = await listModelsFn(apiUrl, apiKey);
  if (models.length > 0) {
    const preferred = findShortestMatches(models, preferredModels);

    logFn(
      "Here are a few example model ids from your api service. Choose a fast and cheap model because AI suggestions happen as you type.",
    );
    for (const model of models.slice(0, 5)) {
      logFn(`  - ${model}`);
    }

    if (preferred.length) {
      logFn("Recommended models from your provider:");
      for (const model of preferred) {
        logFn(`  - ${model}`);
      }
    }
  }

  let model = "";
  while (!model) {
    const answer = (await prompter.ask("Model id: ")).trim();
    if (answer) {
      model = answer;
    } else {
      logFn(
        "Please enter a model id (example: google/gemini-2.5-flash-lite, mistralai/mistral-small-24b-instruct-2501).",
      );
    }
  }

  prompter.close();

  const config: HelloConfig = {
    apiUrl,
    apiKey,
    model,
    prompt: promptConfig,
  };

  await fileSystem.writeFile(configPath, serializeToml(config) + "\n", "utf8");

  logFn(`\nSaved config to ${configPath}`);
  logFn(
    "You can edit this file later if you want to switch providers.\n",
  );

  return config;
}
