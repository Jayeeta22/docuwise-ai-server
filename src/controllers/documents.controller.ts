import type { Request, Response } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { assertDocumentPipelineConfigured, isDocumentPipelineConfigured } from "../config/env";
import { capExtractedText, DocumentModel } from "../models/Document.model";
import { downloadUserDocument, uploadUserDocument } from "../services/azureBlob";
import { chatAboutDocument } from "../services/documentChat";
import { extractFromBuffer } from "../services/documentExtractor";
import { indexDocumentRow } from "../services/searchIndex";

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

export const uploadMiddleware = upload.single("file");

export const listDocuments = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const docs = await DocumentModel.find({ userId: new mongoose.Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .select("originalName contentType sizeBytes createdAt")
    .lean();

  res.json({
    documents: docs.map((d) => ({
      id: String(d._id),
      originalName: d.originalName,
      contentType: d.contentType,
      sizeBytes: d.sizeBytes,
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
      extractedText: doc.extractedText,
      keyValuePairs: doc.keyValuePairs,
      tablesPreview: doc.tablesPreview,
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

  try {
    const extracted = await extractFromBuffer(file.buffer);
    extractedText = capExtractedText(extracted.text);
    keyValuePairs = extracted.keyValuePairs;
    tablesPreview = extracted.tablesPreview;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[documents.upload] Document analysis failed", e);
    res
      .status(502)
      .json({ message: `Document analysis failed: ${formatServiceError(e, "Unknown analysis error")}` });
    return;
  }

  const doc = await DocumentModel.create({
    userId: new mongoose.Types.ObjectId(userId),
    originalName,
    blobPath,
    contentType,
    sizeBytes: file.size,
    extractedText,
    keyValuePairs,
    tablesPreview,
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
  const message = String((req.body as { message?: string })?.message ?? "").trim();

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: "Invalid document id." });
    return;
  }
  if (!message) {
    res.status(400).json({ message: "message is required." });
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

  try {
    const reply = await chatAboutDocument(doc.extractedText, message);
    res.json({ reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat failed";
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
