import { model, models, Schema, type InferSchemaType } from "mongoose";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplace";

const jobPostSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, minlength: 5, maxlength: 120 },
    category: { type: String, required: true, enum: MARKETPLACE_CATEGORIES },
    city: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    description: { type: String, required: true, trim: true, minlength: 20, maxlength: 2000 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    scheduledAt: { type: Date, required: true },
    budgetMin: { type: Number, min: 0, max: 1_000_000 },
    budgetMax: { type: Number, min: 0, max: 1_000_000 },
    status: { type: String, enum: ["OPEN", "ASSIGNED", "CANCELLED"], default: "OPEN", index: true },
    proposalCount: { type: Number, min: 0, default: 0 },
    serviceRequestId: { type: Schema.Types.ObjectId, ref: "ServiceRequest" },
  },
  { timestamps: true },
);

jobPostSchema.index({ status: 1, category: 1, createdAt: -1 });
jobPostSchema.index({ clientId: 1, createdAt: -1 });

export type JobPostDocument = InferSchemaType<typeof jobPostSchema>;
export const JobPost = models.JobPost ?? model("JobPost", jobPostSchema);