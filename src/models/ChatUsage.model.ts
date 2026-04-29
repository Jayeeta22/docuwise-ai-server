import mongoose, { Schema } from "mongoose";

export interface IChatUsage {
  userId: mongoose.Types.ObjectId;
  monthKey: string;
  chatCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const chatUsageSchema = new Schema<IChatUsage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    monthKey: { type: String, required: true },
    chatCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

chatUsageSchema.index({ userId: 1, monthKey: 1 }, { unique: true });

export const ChatUsageModel = mongoose.model<IChatUsage>("ChatUsage", chatUsageSchema);
