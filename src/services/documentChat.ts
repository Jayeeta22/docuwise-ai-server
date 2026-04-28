import { AzureOpenAI } from "openai";
import { env } from "../config/env";

const MAX_CONTEXT_CHARS = 14_000;

export async function chatAboutDocument(extractedText: string, userMessage: string): Promise<string> {
  if (!env.azureOpenAiEndpoint || !env.azureOpenAiKey) {
    throw new Error("Azure OpenAI is not configured.");
  }

  const client = new AzureOpenAI({
    endpoint: env.azureOpenAiEndpoint,
    apiKey: env.azureOpenAiKey,
    apiVersion: env.azureOpenAiApiVersion,
    deployment: env.azureOpenAiDeploymentChat,
  });

  const context =
    extractedText.length > MAX_CONTEXT_CHARS
      ? `${extractedText.slice(0, MAX_CONTEXT_CHARS)}\n\n[Document truncated for model context.]`
      : extractedText;

  const completion = await client.chat.completions.create({
    model: env.azureOpenAiDeploymentChat,
    messages: [
      {
        role: "system",
        content:
          "You are DocLens AI, a helpful assistant. Answer using only the document text provided in the user message. If the answer is not in the document, say you cannot find it in the document.",
      },
      {
        role: "user",
        content: `Document:\n---\n${context}\n---\n\nQuestion: ${userMessage}`,
      },
    ],
    max_tokens: 1024,
    temperature: 0.3,
  });

  const reply = completion.choices[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("Empty response from model.");
  }
  return reply;
}
