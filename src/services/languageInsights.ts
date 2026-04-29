import { AzureKeyCredential, TextAnalyticsClient } from "@azure/ai-text-analytics";
import { env } from "../config/env";

export type LanguageInsightEntity = {
  text: string;
  category: string;
  confidenceScore: number;
};

export type LanguageInsights = {
  detectedLanguage: string;
  keyPhrases: string[];
  entities: LanguageInsightEntity[];
};

let client: TextAnalyticsClient | null = null;

function getClient(): TextAnalyticsClient | null {
  if (!env.azureLanguageEndpoint || !env.azureLanguageKey) {
    return null;
  }
  if (!client) {
    client = new TextAnalyticsClient(env.azureLanguageEndpoint, new AzureKeyCredential(env.azureLanguageKey));
  }
  return client;
}

export async function getLanguageInsights(text: string): Promise<LanguageInsights | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const languageClient = getClient();
  if (!languageClient) return null;

  const input = [trimmed.slice(0, 5_000)];

  const [detectResult] = await languageClient.detectLanguage(input);
  const detectedLanguage = !detectResult.error && detectResult.primaryLanguage?.iso6391Name
    ? detectResult.primaryLanguage.iso6391Name
    : "";

  const [keyPhraseResult] = await languageClient.extractKeyPhrases(input, detectedLanguage || undefined);
  const keyPhrases = !keyPhraseResult.error && keyPhraseResult.keyPhrases ? keyPhraseResult.keyPhrases : [];

  const [entityResult] = await languageClient.recognizeEntities(input, detectedLanguage || undefined);
  const entities = !entityResult.error && entityResult.entities
    ? entityResult.entities.slice(0, 20).map((entity) => ({
        text: entity.text,
        category: entity.category,
        confidenceScore: entity.confidenceScore ?? 0,
      }))
    : [];

  return { detectedLanguage, keyPhrases, entities };
}
