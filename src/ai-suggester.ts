import type { Carousel, Suggester } from "./carousel";
import { logLine } from "./logs";
import { getConfig } from "./config";

type GeminiCandidate = {
  content?: { parts?: { text?: string }[] };
};

export type GenerateContentOptions = {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

type BuildRequestArgs = {
  apiKey: string;
  apiUrl: string;
  model: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
};

type BuiltRequest = {
  // provider: Provider;
  url: string;
  init: RequestInit;
};

export async function generateContent(
  prompt: string,
  options?: GenerateContentOptions
): Promise<string> {
  const apiKey =
    options?.apiKey ||
    process.env.CAROUSHELL_API_KEY ||
    process.env.GEMINI_API_KEY;
  const apiUrl = options?.apiUrl || process.env.CAROUSHELL_API_URL;
  const model =
    options?.model || process.env.CAROUSHELL_MODEL || process.env.OPENAI_MODEL;
  const temperature = options?.temperature ?? 0.3;
  const maxOutputTokens = options?.maxOutputTokens ?? 256;

  if (!apiKey) {
    logLine("AI generation skipped: missing API key");
    return "";
  }
  if (!apiUrl) {
    logLine("AI generation skipped: missing API URL");
    return "";
  }
  if (!model) {
    logLine("AI generation skipped: missing model");
    return "";
  }
  if (!prompt.trim()) {
    logLine("AI generation skipped: empty prompt");
    return "";
  }

  try {
    const start = Date.now();
    const request = buildRequest({
      apiKey,
      apiUrl,
      model,
      prompt,
      temperature,
      maxOutputTokens,
    });
    const res = await fetch(request.url, request.init);
    if (!res.ok) {
      return "ai fetch error: " + res.statusText;
    }
    const out = await extractText(await res.json()); //, request.provider);
    const text = typeof out === "string" ? out : "";
    const duration = Date.now() - start;
    try {
      await logLine(`AI duration: ${duration} ms`);
    } catch {
      // best-effort logging; ignore failures
    }
    return text;
  } catch (err: any) {
    return "ai error: " + err.message;
  }
}

interface ListModelsResponse {
  object: string;
  data: ListModelsModel[];
}

export interface ListModelsModel {
  id: string;
  canonical_slug: string;
  hugging_face_id: string;
  name: string;
  created: number;
  description: string;
  context_length: number;
  architecture: any[];
  pricing: any[];
  top_provider: any[];
  per_request_limits: any;
  supported_parameters: any[];
  default_parameters: {};
}

export async function listModels(
  apiUrl: string,
  apiKey: string
): Promise<string[]> {
  const url = apiUrl.replace("/chat/completions", "") + "/models";
  const res = await fetch(url, { headers: headers(apiKey) });
  const models: ListModelsResponse = await res.json();
  return models.data.map((m) => m.id);
}

function headers(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": "https://github.com/ubershmekel/caroushell",
    "X-Title": "Caroushell",
  };
}

function buildRequest(args: BuildRequestArgs): BuiltRequest {
  return {
    url: args.apiUrl + "/chat/completions",
    init: {
      method: "POST",
      headers: headers(args.apiKey),
      body: JSON.stringify({
        model: args.model,
        temperature: args.temperature,
        max_tokens: args.maxOutputTokens,
        messages: [
          {
            role: "system",
            content:
              "You are a shell assistant that suggests terminal command completions.",
          },
          { role: "user", content: args.prompt },
        ],
      }),
    },
  };
}

async function extractText(json: any, provider?: Provider): Promise<string> {
  const typed = json as {
    choices?: { message?: { content?: string } }[];
  };
  return typed?.choices?.[0]?.message?.content || "";
}

export class AISuggester implements Suggester {
  prefix = "🤖";
  private apiKey: string | undefined;
  private apiUrl: string | undefined;
  private model: string | undefined;

  constructor(opts?: { apiKey?: string; apiUrl?: string; model?: string }) {
    this.apiKey = opts?.apiKey;
    this.apiUrl = opts?.apiUrl;
    this.model = opts?.model;
  }

  async init() {
    const config = await getConfig();
    this.apiKey =
      this.apiKey ||
      config.apiKey ||
      config.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY;
    this.apiUrl =
      this.apiUrl || config.apiUrl || process.env.CAROUSHELL_API_URL;
    this.model = this.model || config.model || process.env.CAROUSHELL_MODEL;

    // If the user provided only a Gemini key, default the URL/model accordingly.
    if (!this.apiUrl && config.GEMINI_API_KEY) {
      this.apiUrl =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
    }
    if (!this.model && config.GEMINI_API_KEY) {
      this.model = "gemini-2.5-flash-lite";
    }
  }

  descriptionForAi(): string {
    return "";
  }

  async suggest(carousel: Carousel, maxDisplayed: number): Promise<string[]> {
    if (!this.apiKey || !this.apiUrl || !this.model) {
      logLine("AI generation skipped: missing API configuration");
      return [];
    }

    const descriptions = [];
    for (const suggester of carousel.getSuggesters()) {
      const desc = suggester.descriptionForAi();
      if (desc) {
        descriptions.push(desc);
      }
    }

    const prompt = `You are a shell assistant. Given a partial shell input, suggest ${maxDisplayed}\
useful, concise shell commands that the user might run next.\
Return one suggestion per line, no numbering, no extra text.
Return the whole suggestion, not just what remains to type out.

The current line is: "${carousel.getCurrentRow()}

${descriptions.join("\n\n")}
`;

    logLine(prompt);

    const text = await generateContent(prompt, {
      apiKey: this.apiKey,
      apiUrl: this.apiUrl,
      model: this.model,
      temperature: 0.3,
      maxOutputTokens: 128,
    });

    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, maxDisplayed);

    logLine(`AI lines: ${lines.length}`);
    return lines;
  }
}
