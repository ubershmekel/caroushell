import type { Carousel, Suggester } from "./carousel";
import { logLine } from "./logs";
import { getConfig } from "./config";

type GeminiCandidate = {
  content?: { parts?: { text?: string }[] };
};

export type GenerateContentOptions = {
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export async function generateContent(
  prompt: string,
  options?: GenerateContentOptions
): Promise<string> {
  const apiKey = options?.apiKey || process.env.GEMINI_API_KEY;
  const model = options?.model || "gemini-2.5-flash-lite";
  const temperature = options?.temperature ?? 0.3;
  const maxOutputTokens = options?.maxOutputTokens ?? 256;

  if (!apiKey) {
    logLine("AI generation skipped: missing API key");
    return "";
  }
  if (!prompt.trim()) {
    logLine("AI generation skipped: empty prompt");
    return "";
  }

  try {
    const start = Date.now();
    const fetchImpl: any = (globalThis as any).fetch;
    if (!fetchImpl) return "";
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens,
          },
        }),
      }
    );
    if (!res.ok) return "";
    const json = (await res.json()) as any as {
      candidates?: GeminiCandidate[];
    };
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const out = typeof text === "string" ? text : "";
    const duration = Date.now() - start;
    // Log duration and each non-empty line of the AI text
    try {
      await logLine(`AI duration: ${duration} ms`);
      if (out.trim()) {
        const lines = out
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        // .map((s) => `AI text: ${s}`);
        // await logLines(lines);
      }
    } catch {
      // best-effort logging; ignore failures
    }
    return out;
  } catch {
    return "";
  }
}

export class AISuggester implements Suggester {
  prefix = "🤖";
  private apiKey: string | undefined;
  private model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.apiKey = opts?.apiKey;
    this.model = opts?.model || "gemini-2.5-flash-lite";
  }

  async init() {
    this.apiKey =
      this.apiKey ||
      (await getConfig()).GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY;
  }

  descriptionForAi(): string {
    return "";
  }

  async suggest(carousel: Carousel, maxDisplayed: number): Promise<string[]> {
    if (!this.apiKey) {
      logLine("AI generation skipped: missing API key");
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

The current line is: "${carousel.getCurrentRow()}

${descriptions.join("\n\n")}
`;

    logLine(prompt);

    const text = await generateContent(prompt, {
      apiKey: this.apiKey,
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
