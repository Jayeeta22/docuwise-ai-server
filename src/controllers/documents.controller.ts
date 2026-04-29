import type { Request, Response } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { assertDocumentPipelineConfigured, isDocumentPipelineConfigured } from "../config/env";
import { env } from "../config/env";
import { ChatUsageModel } from "../models/ChatUsage.model";
import {
  capExtractedText,
  DocumentModel,
  type DocumentCategory,
  type InvoiceFields,
  type ReceiptFields,
} from "../models/Document.model";
import { deleteUserDocument, downloadUserDocument, uploadUserDocument } from "../services/azureBlob";
import { chatAboutDocument, translateDocumentText } from "../services/documentChat";
import { extractFromBuffer } from "../services/documentExtractor";
import { getLanguageInsights } from "../services/languageInsights";
import { deleteDocumentRow, indexDocumentRow, retrieveDocumentContext } from "../services/searchIndex";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

const allowedMime = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/tiff",
  "image/bmp",
]);

const allowedCategories = new Set<DocumentCategory>(["resume", "invoice", "receipt", "general"]);

function formatServiceError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const e = error as Error & {
    code?: string;
    statusCode?: number;
    details?: { error?: { code?: string; message?: string } };
  };

  const details = [
    e.code ? `code=${e.code}` : "",
    typeof e.statusCode === "number" ? `status=${e.statusCode}` : "",
    e.details?.error?.code ? `serviceCode=${e.details.error.code}` : "",
  ].filter(Boolean);

  const detailText = details.length ? ` (${details.join(", ")})` : "";
  const serviceMsg = e.details?.error?.message?.trim();
  const base = serviceMsg || e.message || fallback;
  return `${base}${detailText}`;
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, "_").slice(0, 180) || "document";
}

function getMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function getUsageSnapshot(): Promise<{ limit: number; used: number; remaining: number; monthKey: string }> {
  const monthKey = getMonthKey(new Date());
  const usage = await ChatUsageModel.findOne({
    scope: "global",
    monthKey,
  })
    .select("chatCount")
    .lean();
  const used = usage?.chatCount ?? 0;
  const limit = Math.max(1, env.monthlyChatLimit || 20);
  return { limit, used, remaining: Math.max(0, limit - used), monthKey };
}

export const uploadMiddleware = upload.single("file");

export const listDocuments = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;

  const requestedCategoryRaw = req.query.category;
  const requestedCategory =
    typeof requestedCategoryRaw === "string" ? requestedCategoryRaw.trim().toLowerCase() : undefined;

  const filter: { userId: mongoose.Types.ObjectId; category?: DocumentCategory } = {
    userId: new mongoose.Types.ObjectId(userId),
  };

  if (requestedCategory && allowedCategories.has(requestedCategory as DocumentCategory)) {
    filter.category = requestedCategory as DocumentCategory;
  }

  const docs = await DocumentModel.find(filter)
    .sort({ createdAt: -1 })
    .select("originalName contentType sizeBytes createdAt category")
    .lean();

  res.json({
    documents: docs.map((d) => ({
      id: String(d._id),
      originalName: d.originalName,
      contentType: d.contentType,
      sizeBytes: d.sizeBytes,
      category: d.category,
      createdAt: d.createdAt,
    })),
  });
};

export const getDocument = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: "Invalid document id." });
    return;
  }

  const doc = await DocumentModel.findOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();

  if (!doc) {
    res.status(404).json({ message: "Document not found." });
    return;
  }

  res.json({
    document: {
      id: String(doc._id),
      originalName: doc.originalName,
      contentType: doc.contentType,
      sizeBytes: doc.sizeBytes,
      category: doc.category,
      extractedText: doc.extractedText,
      keyValuePairs: doc.keyValuePairs,
      tablesPreview: doc.tablesPreview,
      invoiceFields: doc.invoiceFields,
      receiptFields: doc.receiptFields,
      detectedLanguage: doc.detectedLanguage,
      keyPhrases: doc.keyPhrases,
      entities: doc.entities,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    },
  });
};

export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  if (!isDocumentPipelineConfigured()) {
    res.status(503).json({
      message:
        "Document pipeline is not configured on the server. Set Azure Blob, Document Intelligence, and OpenAI env vars (see docs/NEXT_PHASE_IMPLEMENTATION.md).",
    });
    return;
  }

  assertDocumentPipelineConfigured();

  const userId = req.userId!;
  const file = req.file;
  if (!file?.buffer) {
    res.status(400).json({ message: "Missing file field (multipart form name: file)." });
    return;
  }

  const contentType = file.mimetype || "application/octet-stream";
  if (!allowedMime.has(contentType)) {
    res.status(400).json({ message: `Unsupported file type: ${contentType}` });
    return;
  }

  const originalName = safeFileName(file.originalname || "upload");
  const blobPath = `${userId}/${randomUUID()}-${originalName}`;

  const requestedCategoryRaw = (req.body as { category?: unknown }).category ?? "general";
  const requestedCategory = String(requestedCategoryRaw).trim().toLowerCase();
  if (!allowedCategories.has(requestedCategory as DocumentCategory)) {
    res.status(400).json({ message: "Invalid category. Use resume, invoice, general (and receipts are auto-detected)." });
    return;
  }
  const category = requestedCategory as DocumentCategory;

  try {
    await uploadUserDocument(blobPath, file.buffer, contentType);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[documents.upload] Blob upload failed", e);
    res.status(502).json({ message: `Blob upload failed: ${formatServiceError(e, "Unknown blob error")}` });
    return;
  }

  let extractedText = "";
  let keyValuePairs: { key: string; value: string }[] = [];
  let tablesPreview = "";
  let detectedLanguage = "";
  let keyPhrases: string[] = [];
  let entities: Array<{ text: string; category: string; confidenceScore: number }> = [];
  let finalCategory: DocumentCategory = category;
  let invoiceFields: InvoiceFields | undefined = undefined;
  let receiptFields: ReceiptFields | undefined = undefined;

  try {
    const extracted = await extractFromBuffer(file.buffer, category);
    extractedText = capExtractedText(extracted.text);
    keyValuePairs = extracted.keyValuePairs;
    tablesPreview = extracted.tablesPreview;
    finalCategory = extracted.finalCategory ?? category;
    invoiceFields = extracted.invoiceFields;
    receiptFields = extracted.receiptFields;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[documents.upload] Document analysis failed", e);
    res
      .status(502)
      .json({ message: `Document analysis failed: ${formatServiceError(e, "Unknown analysis error")}` });
    return;
  }

  try {
    const insights = await getLanguageInsights(extractedText);
    if (insights) {
      detectedLanguage = insights.detectedLanguage;
      keyPhrases = insights.keyPhrases;
      entities = insights.entities;
    }
  } catch {
    /* optional language service */
  }

  const doc = await DocumentModel.create({
    userId: new mongoose.Types.ObjectId(userId),
    category: finalCategory,
    originalName,
    blobPath,
    contentType,
    sizeBytes: file.size,
    extractedText,
    keyValuePairs,
    tablesPreview,
    detectedLanguage,
    keyPhrases,
    entities,
    invoiceFields,
    receiptFields,
  });

  void indexDocumentRow({
    id: String(doc._id),
    documentId: String(doc._id),
    userId,
    title: originalName,
    content: extractedText.slice(0, 32_000),
  }).catch(() => {
    /* optional search */
  });

  res.status(201).json({
    document: {
      id: String(doc._id),
      originalName: doc.originalName,
      contentType: doc.contentType,
      sizeBytes: doc.sizeBytes,
      category: doc.category,
      createdAt: doc.createdAt,
    },
  });
};

export const chatDocument = async (req: Request, res: Response): Promise<void> => {
  if (!isDocumentPipelineConfigured()) {
    res.status(503).json({ message: "OpenAI is not configured on the server." });
    return;
  }

  const userId = req.userId!;
  const { id } = req.params;
  const documentId = String(id);
  const message = String((req.body as { message?: string })?.message ?? "").trim();
  const replyLanguage = String((req.body as { replyLanguage?: string })?.replyLanguage ?? "English").trim() || "English";

  if (!mongoose.isValidObjectId(documentId)) {
    res.status(400).json({ message: "Invalid document id." });
    return;
  }
  if (!message) {
    res.status(400).json({ message: "message is required." });
    return;
  }

  const usageSnapshot = await getUsageSnapshot();
  if (usageSnapshot.used >= usageSnapshot.limit) {
    res.status(429).json({
      message: "For your project, monthly chat limit exceeded.",
      usage: usageSnapshot,
    });
    return;
  }

  const doc = await DocumentModel.findOne({
    _id: documentId,
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();

  if (!doc) {
    res.status(404).json({ message: "Document not found." });
    return;
  }

  try {
    const snippets = await retrieveDocumentContext(message, userId, documentId);
    const fallbackContext = doc.extractedText.slice(0, 8_000);
    const searchContext = snippets.join("\n\n---\n\n");
    const combinedContext = searchContext || fallbackContext;
    const reply = await chatAboutDocument(combinedContext, message, replyLanguage);
    await ChatUsageModel.updateOne(
      {
        scope: "global",
        monthKey: usageSnapshot.monthKey,
      },
      { $inc: { chatCount: 1 } },
      { upsert: true },
    );

    const usage = await getUsageSnapshot();
    res.json({ reply, usage });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat failed";
    res.status(502).json({ message: msg });
  }
};

export const getChatUsage = async (_req: Request, res: Response): Promise<void> => {
  const usage = await getUsageSnapshot();
  res.json(usage);
};

export const translateDocument = async (req: Request, res: Response): Promise<void> => {
  if (!isDocumentPipelineConfigured()) {
    res.status(503).json({ message: "Translation service is not configured on the server." });
    return;
  }

  const userId = req.userId!;
  const documentId = String(req.params.id);
  const targetLanguage = String((req.body as { targetLanguage?: string })?.targetLanguage ?? "").trim();

  if (!mongoose.isValidObjectId(documentId)) {
    res.status(400).json({ message: "Invalid document id." });
    return;
  }
  if (!targetLanguage) {
    res.status(400).json({ message: "targetLanguage is required." });
    return;
  }

  const doc = await DocumentModel.findOne({
    _id: documentId,
    userId: new mongoose.Types.ObjectId(userId),
  })
    .select("extractedText tablesPreview")
    .lean();

  if (!doc) {
    res.status(404).json({ message: "Document not found." });
    return;
  }
  if (!doc.extractedText?.trim()) {
    res.status(400).json({ message: "No extracted text available for translation." });
    return;
  }

  try {
    const [translatedExtractedText, translatedTablesPreview] = await Promise.all([
      translateDocumentText(doc.extractedText, targetLanguage),
      doc.tablesPreview?.trim() ? translateDocumentText(doc.tablesPreview, targetLanguage) : Promise.resolve(""),
    ]);
    res.json({ translatedExtractedText, translatedTablesPreview, targetLanguage });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Translation failed";
    res.status(502).json({ message: msg });
  }
};

export const getDocumentFile = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: "Invalid document id." });
    return;
  }

  const doc = await DocumentModel.findOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(userId),
  }).select("blobPath originalName contentType").lean();

  if (!doc) {
    res.status(404).json({ message: "Document not found." });
    return;
  }

  try {
    const file = await downloadUserDocument(doc.blobPath);
    res.setHeader("Content-Type", doc.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.originalName}"`);
    res.send(file);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Blob download failed";
    res.status(502).json({ message: msg });
  }
};

export const deleteDocument = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const documentId = String(req.params.id);

  if (!mongoose.isValidObjectId(documentId)) {
    res.status(400).json({ message: "Invalid document id." });
    return;
  }

  const doc = await DocumentModel.findOne({
    _id: documentId,
    userId: new mongoose.Types.ObjectId(userId),
  })
    .select("blobPath")
    .lean();

  if (!doc) {
    res.status(404).json({ message: "Document not found." });
    return;
  }

  await DocumentModel.deleteOne({ _id: documentId, userId: new mongoose.Types.ObjectId(userId) });

  await Promise.allSettled([
    deleteUserDocument(doc.blobPath),
    deleteDocumentRow(documentId),
  ]);

  res.json({ success: true });
};
