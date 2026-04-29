import mongoose, { Schema } from "mongoose";

export interface IChatUsage {
  scope: "global";
  monthKey: string;
  chatCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const chatUsageSchema = new Schema<IChatUsage>(
  {
    scope: { type: String, required: true, default: "global", enum: ["global"], index: true },
    monthKey: { type: String, required: true },
    chatCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

chatUsageSchema.index({ scope: 1, monthKey: 1 }, { unique: true });

export const ChatUsageModel = mongoose.model<IChatUsage>("ChatUsage", chatUsageSchema);
