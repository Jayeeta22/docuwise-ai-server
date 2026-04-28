import { BlobServiceClient } from "@azure/storage-blob";
import { env } from "../config/env";

let containerClient: ReturnType<BlobServiceClient["getContainerClient"]> | null = null;

function getContainer() {
  if (!env.azureStorageConnectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set.");
  }
  if (!containerClient) {
    const service = BlobServiceClient.fromConnectionString(env.azureStorageConnectionString);
    containerClient = service.getContainerClient("documents");
  }
  return containerClient;
}

export async function ensureDocumentsContainer(): Promise<void> {
  const container = getContainer();
  await container.createIfNotExists();
}

export async function uploadUserDocument(
  blobPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  await ensureDocumentsContainer();
  const blockBlob = getContainer().getBlockBlobClient(blobPath);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
}

export async function downloadUserDocument(blobPath: string): Promise<Buffer> {
  const blob = getContainer().getBlockBlobClient(blobPath);
  const response = await blob.download();
  if (!response.readableStreamBody) {
    throw new Error("Blob download stream is empty.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
