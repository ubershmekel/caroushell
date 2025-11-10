import type { Suggester } from "./history-suggester";

type GeminiCandidate = {
  content?: { parts?: { text?: string }[] };
};

export class AISuggester implements Suggester {
  private apiKey: string | undefined;
  private model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.apiKey = opts?.apiKey || process.env.GEMINI_API_KEY;
    this.model = opts?.model || "gemini-2.5-flash-lite";
  }

  async suggest(input: string, count: number): Promise<string[]> {
    if (!this.apiKey || !input.trim()) return [];

    const prompt = `You are a shell assistant. Given a partial shell input, suggest ${count} useful, concise shell commands that the user might run next. Return one suggestion per line, no numbering, no extra text. Partial input: "${input}"`;

    try {
      const fetchImpl: any = (globalThis as any).fetch;
      if (!fetchImpl) return [];
      const res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
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
              temperature: 0.3,
              maxOutputTokens: 128,
            },
          }),
        }
      );
      if (!res.ok) return [] as string[];
      const json = (await res.json()) as any as {
        candidates?: GeminiCandidate[];
      };
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, count);
    } catch {
      return [];
    }
  }
}
