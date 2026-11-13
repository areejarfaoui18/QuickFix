import { model, models, Schema, type InferSchemaType } from "mongoose";

const conversationSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    artisanId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    lastMessageText: { type: String, trim: true, maxlength: 2000, default: "" },
    lastMessageSenderId: { type: Schema.Types.ObjectId, ref: "User" },
    lastMessageAt: { type: Date },
  },
  { timestamps: true },
);

conversationSchema.index({ clientId: 1, artisanId: 1 }, { unique: true });
conversationSchema.index({ clientId: 1, lastMessageAt: -1 });
conversationSchema.index({ artisanId: 1, lastMessageAt: -1 });

export type ConversationDocument = InferSchemaType<typeof conversationSchema>;
export const Conversation = models.Conversation ?? model("Conversation", conversationSchema);
