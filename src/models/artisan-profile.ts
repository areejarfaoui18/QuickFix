import { deleteModel, model, models, Schema, type InferSchemaType } from "mongoose";

const artisanProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    bio: { type: String, trim: true, maxlength: 1200, default: "" },
    indicativePriceMin: { type: Number, min: 0 },
    indicativePriceMax: { type: Number, min: 0 },
    isAvailable: { type: Boolean, default: true },
    verificationStatus: { type: String, enum: ["PENDING", "VERIFIED", "REJECTED"], default: "PENDING" },
    identityDocument: {
      fileId: { type: Schema.Types.ObjectId },
      mimeType: { type: String, enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"] },
      size: { type: Number, min: 1, max: 5 * 1024 * 1024 },
    },
    // Automatic reading of the document. It only helps the administrator; it never decides.
    identityOcr: {
      status: { type: String, enum: ["PROCESSING", "DONE", "FAILED"] },
      fileId: { type: Schema.Types.ObjectId },
      documentType: { type: String, enum: ["TUNISIAN_CIN", "PASSPORT", "DRIVING_LICENSE", "RESIDENCE_PERMIT", "OTHER_ID", "NOT_AN_ID"] },
      readable: { type: Boolean },
      fullName: { type: String, trim: true, maxlength: 120 },
      fullNameLatin: { type: String, trim: true, maxlength: 120 },
      documentNumber: { type: String, trim: true, maxlength: 40 },
      birthDate: { type: String, maxlength: 10 },
      expiryDate: { type: String, maxlength: 10 },
      nameMatch: { type: String, enum: ["MATCH", "PARTIAL", "MISMATCH", "UNKNOWN"] },
      processedAt: { type: Date },
    },
    verificationReason: { type: String, trim: true, maxlength: 500 },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
    verifiedAt: { type: Date },
  },
  { timestamps: true },
);

export type ArtisanProfileDocument = InferSchemaType<typeof artisanProfileSchema>;
if (models.ArtisanProfile && ["identityDocument.fileId", "identityDocument.mimeType", "identityDocument.size", "identityOcr.status"].some((path) => !models.ArtisanProfile.schema.path(path))) {
  deleteModel("ArtisanProfile");
}
export const ArtisanProfile = models.ArtisanProfile ?? model("ArtisanProfile", artisanProfileSchema);
