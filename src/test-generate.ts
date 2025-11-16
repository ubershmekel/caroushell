import { generateContent, listModels } from "./ai-suggester";
import { getConfig } from "./config";

async function main() {
  const config = await getConfig();
  if (!config.apiKey) {
    console.warn("Warning: no API key configured. The answer may be empty.");
  }

  const models = await listModels(config.apiUrl || "", config.apiKey || "");
  console.log("Available models:", models);

  const question = "What is the capital of France?";
  const answer = await generateContent(question, {
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    model: config.model,
  });
  console.log(`Q: ${question}`);
  console.log(`A: ${answer.trim()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
