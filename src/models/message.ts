import { model, models, Schema, type InferSchemaType } from "mongoose";

const attachmentSchema = new Schema(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, maxlength: 150 },
    mimeType: { type: String, enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"], required: true },
    size: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, trim: true, maxlength: 2000, default: "" },
    attachment: { type: attachmentSchema },
    quoteMessageRequestId: { type: Schema.Types.ObjectId, ref: "ServiceRequest" },
    quoteRequestId: { type: Schema.Types.ObjectId, ref: "ServiceRequest" },
    readAt: { type: Date },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ conversationId: 1, senderId: 1, readAt: 1 });
messageSchema.index({ quoteMessageRequestId: 1 }, { unique: true, sparse: true });
messageSchema.index({ quoteRequestId: 1 }, { unique: true, sparse: true });

export type MessageDocument = InferSchemaType<typeof messageSchema>;
export const Message = models.Message ?? model("Message", messageSchema);
