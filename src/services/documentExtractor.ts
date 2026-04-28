import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer";
import { FormRecognizerFeature } from "@azure/ai-form-recognizer";
import type { DocumentKeyValuePair } from "@azure/ai-form-recognizer";
import { env } from "../config/env";
import type { DocumentKeyValue } from "../models/Document.model";

function mapKeyValuePairs(pairs: DocumentKeyValuePair[] | undefined): DocumentKeyValue[] {
  if (!pairs?.length) return [];
  const out: DocumentKeyValue[] = [];
  for (const pair of pairs) {
    const key = pair.key?.content?.trim() ?? "";
    const value = pair.value?.content?.trim() ?? "";
    if (key || value) {
      out.push({ key: key || "(field)", value });
    }
  }
  return out.slice(0, 200);
}

function summarizeTables(content: string): string {
  return content.length > 2000 ? `${content.slice(0, 2000)}…` : content;
}

export async function extractFromBuffer(buffer: Buffer): Promise<{
  text: string;
  keyValuePairs: DocumentKeyValue[];
  tablesPreview: string;
}> {
  if (!env.azureDocumentIntelligenceEndpoint || !env.azureDocumentIntelligenceKey) {
    throw new Error("Document Intelligence is not configured.");
  }

  const client = new DocumentAnalysisClient(
    env.azureDocumentIntelligenceEndpoint,
    new AzureKeyCredential(env.azureDocumentIntelligenceKey),
  );

  let poller;
  try {
    poller = await client.beginAnalyzeDocument("prebuilt-layout", buffer, {
      features: [FormRecognizerFeature.KeyValuePairs],
    });
  } catch (error) {
    const e = error as Error & { code?: string; statusCode?: number };
    // Some Document Intelligence resources reject KeyValuePairs on layout with 400 InvalidArgument.
    // Retry without optional features so OCR/table extraction still succeeds.
    if (e.code === "InvalidArgument" || e.statusCode === 400) {
      poller = await client.beginAnalyzeDocument("prebuilt-layout", buffer);
    } else {
      throw error;
    }
  }

  const result = await poller.pollUntilDone();

  const text = result.content ?? "";
  const keyValuePairs = mapKeyValuePairs(result.keyValuePairs);

  let tablesPreview = "";
  if (result.tables?.length) {
    const lines: string[] = [];
    for (const table of result.tables.slice(0, 5)) {
      const rowCount = table.rowCount;
      const colCount = table.columnCount;
      lines.push(`Table ${table.rowCount}x${colCount}`);
      for (let r = 0; r < Math.min(rowCount, 8); r++) {
        const cells = table.cells
          .filter((c) => c.rowIndex === r)
          .sort((a, b) => a.columnIndex - b.columnIndex)
          .map((c) => c.content.trim())
          .join(" | ");
        if (cells) lines.push(cells);
      }
    }
    tablesPreview = summarizeTables(lines.join("\n"));
  }

  return { text, keyValuePairs, tablesPreview };
}
