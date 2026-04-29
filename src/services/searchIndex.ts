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

export async function retrieveDocumentContext(
  query: string,
  userId: string,
  documentId: string,
): Promise<string[]> {
  const search = getClient();
  if (!search) return [];

  const results = await search.search(query, {
    top: 3,
    filter: `userId eq '${userId.replace(/'/g, "''")}' and documentId eq '${documentId.replace(/'/g, "''")}'`,
    select: ["content"],
  });

  const snippets: string[] = [];
  for await (const item of results.results) {
    const content = item.document.content?.trim();
    if (content) snippets.push(content.slice(0, 2_500));
  }
  return snippets;
}

export async function deleteDocumentRow(documentId: string): Promise<void> {
  const search = getClient();
  if (!search) return;
  await search.deleteDocuments([
    { id: documentId, documentId: "", userId: "", title: "", content: "" },
  ]);
}
