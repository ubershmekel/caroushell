import { generateContent } from "./ai-suggester";

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("Warning: GEMINI_API_KEY is not set. The answer may be empty.");
  }
  const question = "What is the capital of France?";
  const answer = await generateContent(question);
  console.log(`Q: ${question}`);
  console.log(`A: ${answer.trim()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
