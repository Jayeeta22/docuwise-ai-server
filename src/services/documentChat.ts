import { AzureOpenAI } from "openai";
import { env } from "../config/env";

const MAX_CONTEXT_CHARS = 14_000;

export async function chatAboutDocument(
  documentContext: string,
  userMessage: string,
  replyLanguage = "English",
): Promise<string> {
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
    documentContext.length > MAX_CONTEXT_CHARS
      ? `${documentContext.slice(0, MAX_CONTEXT_CHARS)}\n\n[Document truncated for model context.]`
      : documentContext;

  const completion = await client.chat.completions.create({
    model: env.azureOpenAiDeploymentChat,
    messages: [
      {
        role: "system",
        content:
          `You are DocLens AI, a helpful assistant. Answer using only the supplied document context. If the answer is not present, clearly say you cannot find it in the provided document context. Always answer in ${replyLanguage}.`,
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

export async function translateDocumentText(text: string, targetLanguage: string): Promise<string> {
  if (!env.azureOpenAiEndpoint || !env.azureOpenAiKey) {
    throw new Error("Azure OpenAI is not configured.");
  }

  const client = new AzureOpenAI({
    endpoint: env.azureOpenAiEndpoint,
    apiKey: env.azureOpenAiKey,
    apiVersion: env.azureOpenAiApiVersion,
    deployment: env.azureOpenAiDeploymentChat,
  });

  const sourceText =
    text.length > MAX_CONTEXT_CHARS
      ? `${text.slice(0, MAX_CONTEXT_CHARS)}\n\n[Document truncated for translation context.]`
      : text;

  const completion = await client.chat.completions.create({
    model: env.azureOpenAiDeploymentChat,
    messages: [
      {
        role: "system",
        content:
          "You are a professional translator. Preserve numeric values, invoice identifiers, dates, and monetary amounts exactly as written. Return only translated text.",
      },
      {
        role: "user",
        content: `Translate the following document text into ${targetLanguage}:\n\n${sourceText}`,
      },
    ],
    max_tokens: 1600,
    temperature: 0.1,
  });

  const translated = completion.choices[0]?.message?.content?.trim();
  if (!translated) {
    throw new Error("Empty translation response from model.");
  }
  return translated;
}
