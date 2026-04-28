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
