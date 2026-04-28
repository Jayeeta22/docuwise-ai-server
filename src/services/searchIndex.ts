import { AzureKeyCredential, SearchClient } from "@azure/search-documents";
import { env } from "../config/env";

export type SearchDoc = {
  id: string;
  documentId: string;
  userId: string;
  title: string;
  content: string;
};

let client: SearchClient<SearchDoc> | null = null;

function getClient(): SearchClient<SearchDoc> | null {
  if (!env.azureSearchEndpoint || !env.azureSearchAdminKey || !env.azureSearchIndexName) {
    return null;
  }
  if (!client) {
    client = new SearchClient<SearchDoc>(
      env.azureSearchEndpoint,
      env.azureSearchIndexName,
      new AzureKeyCredential(env.azureSearchAdminKey),
    );
  }
  return client;
}

/** Upserts a chunk of searchable text. Index schema must exist (see implementation guide). */
export async function indexDocumentRow(doc: SearchDoc): Promise<void> {
  const search = getClient();
  if (!search) return;
  await search.mergeOrUploadDocuments([doc]);
}
