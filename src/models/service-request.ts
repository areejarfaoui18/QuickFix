import { model, models, Schema, type InferSchemaType } from "mongoose";

const statusHistorySchema = new Schema(
  {
    status: { type: String, enum: ["EN_ATTENTE", "ACCEPTEE", "EN_COURS", "TERMINEE", "REFUSEE", "ANNULEE"], required: true },
    changedAt: { type: Date, required: true, default: Date.now },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const requestPhotoSchema = new Schema(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, maxlength: 150 },
    mimeType: { type: String, enum: ["image/jpeg", "image/png", "image/webp"], required: true },
    size: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
  },
  { _id: false },
);

const quoteItemSchema = new Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 200 },
    amount: { type: Number, required: true, min: 0, max: 1_000_000 },
  },
  { _id: false },
);

const serviceRequestSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    artisanId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    location: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
    },
    scheduledAt: { type: Date, required: true },
    budgetMin: { type: Number, min: 0 },
    budgetMax: { type: Number, min: 0 },
    propertyType: { type: String, enum: ["NON_PRECISE", "MAISON", "APPARTEMENT", "LOCAL_COMMERCIAL", "AUTRE"], default: "NON_PRECISE" },
    urgency: { type: String, enum: ["NORMALE", "URGENTE"], default: "NORMALE" },
    accessDetails: { type: String, trim: true, maxlength: 500, default: "" },
    photos: { type: [requestPhotoSchema], default: [] },
    status: {
      type: String,
      enum: ["EN_ATTENTE", "ACCEPTEE", "EN_COURS", "TERMINEE", "REFUSEE", "ANNULEE"],
      default: "EN_ATTENTE",
      index: true,
    },
    announcedPrice: { type: Number, min: 0 },
    quoteItems: { type: [quoteItemSchema], default: [] },
    quoteSentAt: { type: Date },
    quoteValidUntil: { type: Date },
    quoteAcceptedAt: { type: Date },
    statusHistory: { type: [statusHistorySchema], default: [] },
  },
  { timestamps: true },
);

serviceRequestSchema.index({ clientId: 1, createdAt: -1 });
serviceRequestSchema.index({ artisanId: 1, status: 1 });

export type ServiceRequestDocument = InferSchemaType<typeof serviceRequestSchema>;
export const ServiceRequest = models.ServiceRequest ?? model("ServiceRequest", serviceRequestSchema);
