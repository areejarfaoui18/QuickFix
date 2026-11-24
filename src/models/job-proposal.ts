import { model, models, Schema, type InferSchemaType } from "mongoose";

const proposalItemSchema = new Schema(
  {
    description: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
    amountCents: { type: Number, required: true, min: 0, max: 100_000_000, validate: Number.isInteger },
  },
  { _id: false },
);

const jobProposalSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: "JobPost", required: true, index: true },
    artisanId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    message: { type: String, required: true, trim: true, minlength: 20, maxlength: 1200 },
    items: { type: [proposalItemSchema], required: true },
    totalCents: { type: Number, required: true, min: 0, max: 100_000_000, validate: Number.isInteger },
    commissionCents: { type: Number, required: true, min: 0, validate: Number.isInteger },
    validUntil: { type: Date, required: true },
    status: { type: String, enum: ["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN"], default: "PENDING" },
  },
  { timestamps: true },
);

jobProposalSchema.index({ jobId: 1, artisanId: 1 }, { unique: true });

export type JobProposalDocument = InferSchemaType<typeof jobProposalSchema>;
export const JobProposal = models.MarketplaceBid ?? model("MarketplaceBid", jobProposalSchema);