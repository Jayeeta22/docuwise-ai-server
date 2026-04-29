import mongoose, { Schema } from "mongoose";

export type DocumentKeyValue = { key: string; value: string };
export type DocumentEntity = { text: string; category: string; confidenceScore: number };
export type DocumentCategory = "resume" | "invoice" | "receipt" | "general";

export type InvoiceLineItem = {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  amount?: number | string;
};

export type InvoiceFields = {
  invoiceNumber?: string;
  vendorName?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  subtotal?: number | string;
  tax?: number | string;
  total?: number | string;
  lineItems?: InvoiceLineItem[];
};

export type ReceiptLineItem = {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  amount?: number | string;
};

export type ReceiptFields = {
  merchantName?: string;
  receiptNumber?: string;
  transactionDate?: string;
  currency?: string;
  subtotal?: number | string;
  tax?: number | string;
  total?: number | string;
  lineItems?: ReceiptLineItem[];
};

export interface IDocument {
  userId: mongoose.Types.ObjectId;
  category: DocumentCategory;
  originalName: string;
  blobPath: string;
  contentType: string;
  sizeBytes: number;
  /** Full reading-order text from Document Intelligence (capped server-side). */
  extractedText: string;
  keyValuePairs: DocumentKeyValue[];
  /** Short text summary of tables for UI / search snippet. */
  tablesPreview: string;
  detectedLanguage: string;
  keyPhrases: string[];
  entities: DocumentEntity[];
  /** Populated when `category` is `invoice`. */
  invoiceFields?: InvoiceFields;
  /** Populated when `category` is `receipt`. */
  receiptFields?: ReceiptFields;
  createdAt: Date;
  updatedAt: Date;
}

const MAX_STORED_TEXT = 900_000;

const documentSchema = new Schema<IDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: {
      type: String,
      required: true,
      enum: ["resume", "invoice", "receipt", "general"],
      default: "general",
      index: true,
    },
    originalName: { type: String, required: true },
    blobPath: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    extractedText: { type: String, default: "" },
    keyValuePairs: {
      type: [
        {
          key: { type: String, required: true },
          value: { type: String, default: "" },
        },
      ],
      default: [],
    },
    tablesPreview: { type: String, default: "" },
    detectedLanguage: { type: String, default: "" },
    keyPhrases: { type: [String], default: [] },
    entities: {
      type: [
        {
          text: { type: String, required: true },
          category: { type: String, required: true },
          confidenceScore: { type: Number, required: true },
        },
      ],
      default: [],
    },
    invoiceFields: { type: Schema.Types.Mixed, default: undefined },
    receiptFields: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true },
);

export const DocumentModel = mongoose.model<IDocument>("Document", documentSchema);

export function capExtractedText(text: string): string {
  if (text.length <= MAX_STORED_TEXT) return text;
  return `${text.slice(0, MAX_STORED_TEXT)}\n\n[Truncated for storage limits.]`;
}
