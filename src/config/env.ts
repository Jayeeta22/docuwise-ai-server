import dotenv from "dotenv";

dotenv.config();

const required = ["MONGODB_URI", "JWT_SECRET"] as const;
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env variable: ${key}`);
  }
}

const trim = (value: string | undefined): string => (typeof value === "string" ? value.trim() : "");

const firstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const normalized = trim(value);
    if (normalized) return normalized;
  }
  return "";
};

export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  mongodbUri: process.env.MONGODB_URI as string,
  mongodbUriFallback: process.env.MONGODB_URI_FALLBACK,
  jwtSecret: process.env.JWT_SECRET as string,

  /** Azure Blob — connection string from Storage account → Access keys */
  azureStorageConnectionString: firstNonEmpty(
    process.env.AZURE_STORAGE_CONNECTION_STRING,
    process.env.AZURE_STORAGE_ENDPOINT,
  ),
  /** Document Intelligence — endpoint URL (no trailing slash) + key */
  azureDocumentIntelligenceEndpoint: trim(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT).replace(/\/+$/, ""),
  azureDocumentIntelligenceKey: trim(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY),
  /** Azure OpenAI — resource endpoint, key, chat deployment name (e.g. gpt-4o-mini) */
  azureOpenAiEndpoint: trim(process.env.AZURE_OPENAI_ENDPOINT).replace(/\/+$/, ""),
  azureOpenAiKey: trim(process.env.AZURE_OPENAI_API_KEY),
  azureOpenAiDeploymentChat: firstNonEmpty(
    process.env.AZURE_OPENAI_DEPLOYMENT_CHAT,
    process.env.AZURE_DEPLOYMENT,
  ) || "gpt-4o-mini",
  azureOpenAiApiVersion: firstNonEmpty(
    process.env.AZURE_OPENAI_API_VERSION,
    process.env.AZURE_API_VERSION,
  ) || "2024-02-01",
  /** Optional Cognitive Search — create index in portal first (see docs) */
  azureSearchEndpoint: firstNonEmpty(
    process.env.AZURE_SEARCH_ENDPOINT,
    process.env.AZURE_AISEARCH_ENDPOINT,
  ).replace(/\/+$/, ""),
  azureSearchAdminKey: trim(process.env.AZURE_SEARCH_ADMIN_KEY),
  azureSearchIndexName: trim(process.env.AZURE_SEARCH_INDEX_NAME),
  /** Optional Azure Language service for document insights */
  azureLanguageEndpoint: firstNonEmpty(
    process.env.AZURE_LANGUAGE_ENDPOINT,
    process.env.AZURE_TEXT_ANALYTICS_ENDPOINT,
  ).replace(/\/+$/, ""),
  azureLanguageKey: firstNonEmpty(
    process.env.AZURE_LANGUAGE_KEY,
    process.env.AZURE_TEXT_ANALYTICS_KEY,
  ),
  monthlyChatLimit: Number(process.env.MONTHLY_CHAT_LIMIT ?? 20),
};

export function isDocumentPipelineConfigured(): boolean {
  return Boolean(
    env.azureStorageConnectionString &&
      env.azureDocumentIntelligenceEndpoint &&
      env.azureDocumentIntelligenceKey &&
      env.azureOpenAiEndpoint &&
      env.azureOpenAiKey,
  );
}

export function assertDocumentPipelineConfigured(): void {
  if (!isDocumentPipelineConfigured()) {
    throw new Error(
      "Document upload is not configured. Set AZURE_STORAGE_CONNECTION_STRING, AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, AZURE_DOCUMENT_INTELLIGENCE_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_API_KEY.",
    );
  }
}
