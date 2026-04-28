import mongoose, { Schema } from "mongoose";

export type DocumentKeyValue = { key: string; value: string };

export interface IDocument {
  userId: mongoose.Types.ObjectId;
  originalName: string;
  blobPath: string;
  contentType: string;
  sizeBytes: number;
  /** Full reading-order text from Document Intelligence (capped server-side). */
  extractedText: string;
  keyValuePairs: DocumentKeyValue[];
  /** Short text summary of tables for UI / search snippet. */
  tablesPreview: string;
  createdAt: Date;
  updatedAt: Date;
}

const MAX_STORED_TEXT = 900_000;

const documentSchema = new Schema<IDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
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
  },
  { timestamps: true },
);

export const DocumentModel = mongoose.model<IDocument>("Document", documentSchema);

export function capExtractedText(text: string): string {
  if (text.length <= MAX_STORED_TEXT) return text;
  return `${text.slice(0, MAX_STORED_TEXT)}\n\n[Truncated for storage limits.]`;
}
