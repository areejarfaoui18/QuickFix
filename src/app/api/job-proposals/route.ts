import mongoose from "mongoose";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { calculateCommissionCents } from "@/lib/marketplace";
import { connectToDatabase } from "@/lib/mongodb";
import { ArtisanProfile } from "@/models/artisan-profile";
import { JobPost } from "@/models/job-post";
import { JobProposal } from "@/models/job-proposal";
import { Review } from "@/models/review";
import { ServiceRequest } from "@/models/service-request";
import { User } from "@/models/user";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class WorkflowError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour consulter les propositions." }, { status: 401 });
    if (user.mustChangePassword || user.role !== "CLIENT") return Response.json({ error: "Accès non autorisé." }, { status: 403 });
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) return Response.json({ error: "Mission invalide." }, { status: 400 });
    if (!await JobPost.exists({ _id: jobId, clientId: user.id })) return Response.json({ error: "Mission introuvable." }, { status: 404 });

    const proposals = await JobProposal.find({ jobId }).sort({ createdAt: -1 }).limit(100).lean();
    const artisanIds = proposals.map((proposal) => proposal.artisanId);
    const [artisans, profiles, ratings] = await Promise.all([
      User.find({ _id: { $in: artisanIds }, role: "ARTISAN" }).select("name").lean(),
      ArtisanProfile.find({ userId: { $in: artisanIds } }).select("userId city category").lean(),
      Review.aggregate<{ _id: mongoose.Types.ObjectId; average: number; count: number }>([
        { $match: { artisanId: { $in: artisanIds }, isHidden: false } },
        { $group: { _id: "$artisanId", average: { $avg: "$rating" }, count: { $sum: 1 } } },
      ]),
    ]);
    const names = new Map(artisans.map((artisan) => [artisan._id.toString(), artisan.name]));
    const profileById = new Map(profiles.map((profile) => [profile.userId.toString(), profile]));
    const ratingById = new Map(ratings.map((rating) => [rating._id.toString(), rating]));
    return Response.json({ proposals: proposals.map((proposal) => {
      const artisanId = proposal.artisanId.toString();
      const profile = profileById.get(artisanId);
      const rating = ratingById.get(artisanId);
      return {
        id: proposal._id.toString(), artisanName: names.get(artisanId) ?? "Artisan", city: profile?.city ?? "",
        rating: rating?.average ?? null, reviews: rating?.count ?? 0, message: proposal.message,
        items: proposal.items, totalCents: proposal.totalCents, validUntil: proposal.validUntil,
        status: proposal.status, createdAt: proposal.createdAt,
      };
    }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Chargement des propositions impossible :", error);
    return Response.json({ error: "Impossible de charger les propositions." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour envoyer une proposition." }, { status: 401 });
    if (user.mustChangePassword || user.role !== "ARTISAN") return Response.json({ error: "Seul un artisan peut envoyer une proposition." }, { status: 403 });
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Proposition invalide." }, { status: 400 }); }
    if (!isRecord(body) || typeof body.jobId !== "string" || !mongoose.Types.ObjectId.isValid(body.jobId) || typeof body.message !== "string" || !Array.isArray(body.items)) {
      return Response.json({ error: "Proposition invalide." }, { status: 400 });
    }
    const jobId = body.jobId;
    const message = body.message.trim();
    if (message.length < 20 || message.length > 1200 || body.items.length < 1 || body.items.length > 20 || typeof body.validDays !== "number" || !Number.isInteger(body.validDays) || body.validDays < 1 || body.validDays > 90) {
      return Response.json({ error: "Vérifiez votre message, les postes et la durée de validité (1 à 90 jours)." }, { status: 400 });
    }
    const items: { description: string; amountCents: number }[] = [];
    for (const item of body.items) {
      if (!isRecord(item) || typeof item.description !== "string" || item.description.trim().length < 2 || item.description.trim().length > 200 || typeof item.amountCents !== "number" || !Number.isSafeInteger(item.amountCents) || item.amountCents < 0 || item.amountCents > 100_000_000) {
        return Response.json({ error: "Vérifiez chaque poste et son montant." }, { status: 400 });
      }
      items.push({ description: item.description.trim(), amountCents: item.amountCents });
    }
    const totalCents = items.reduce((total, item) => total + item.amountCents, 0);
    if (totalCents < 1 || totalCents > 100_000_000) return Response.json({ error: "Le total doit être compris entre 0,01 et 1 000 000 DT." }, { status: 400 });
    const validUntil = new Date(Date.now() + body.validDays * 86400000);
    const session = await mongoose.startSession();
    let proposalId = "";
    try {
      await session.withTransaction(async () => {
        const profile = await ArtisanProfile.findOne({ userId: user.id, verificationStatus: "VERIFIED", "identityDocument.fileId": { $exists: true }, isAvailable: true }).select("category").session(session);
        if (!profile) throw new WorkflowError("Votre profil doit être vérifié et disponible pour proposer un devis.", 403);
        const job = await JobPost.findOneAndUpdate(
          { _id: jobId, status: "OPEN", category: profile.category, scheduledAt: { $gt: new Date() } },
          { $inc: { proposalCount: 1 } }, { new: true, session },
        );
        if (!job) throw new WorkflowError("Cette mission n’est plus disponible dans votre spécialité.", 409);
        if (await JobProposal.exists({ jobId: job._id, artisanId: user.id }).session(session)) {
          throw new WorkflowError("Vous avez déjà envoyé une proposition pour cette mission.", 409);
        }
        const [proposal] = await JobProposal.create([{
          jobId: job._id, artisanId: user.id, message, items, totalCents,
          commissionCents: calculateCommissionCents(totalCents), validUntil,
        }], { session });
        proposalId = proposal.id;
      });
    } finally { await session.endSession(); }
    return Response.json({ id: proposalId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkflowError) return Response.json({ error: error.message }, { status: error.status });
    if (isRecord(error) && error.code === 11000) return Response.json({ error: "Vous avez déjà envoyé une proposition pour cette mission." }, { status: 409 });
    console.error("Envoi de la proposition impossible :", error);
    return Response.json({ error: "Impossible d’envoyer la proposition." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour choisir une proposition." }, { status: 401 });
    if (user.mustChangePassword || user.role !== "CLIENT") return Response.json({ error: "Seul le client peut choisir une proposition." }, { status: 403 });
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Proposition invalide." }, { status: 400 }); }
    if (!isRecord(body) || typeof body.jobId !== "string" || !mongoose.Types.ObjectId.isValid(body.jobId) || typeof body.proposalId !== "string" || !mongoose.Types.ObjectId.isValid(body.proposalId)) {
      return Response.json({ error: "Proposition invalide." }, { status: 400 });
    }
    const { jobId, proposalId } = body;
    const session = await mongoose.startSession();
    let serviceRequestId = "";
    try {
      await session.withTransaction(async () => {
        const now = new Date();
        const job = await JobPost.findOneAndUpdate(
          { _id: jobId, clientId: user.id, status: "OPEN", scheduledAt: { $gt: now } },
          { $set: { status: "ASSIGNED" } }, { new: true, session },
        );
        if (!job) throw new WorkflowError("Mission introuvable, expirée ou déjà attribuée.", 409);
        const proposal = await JobProposal.findOne({ _id: proposalId, jobId, status: "PENDING", validUntil: { $gt: now } }).session(session);
        if (!proposal) throw new WorkflowError("Cette proposition n’est plus disponible ou a expiré.", 409);
        const artisan = await User.exists({ _id: proposal.artisanId, role: "ARTISAN", isSuspended: false }).session(session);
        const profile = await ArtisanProfile.exists({ userId: proposal.artisanId, verificationStatus: "VERIFIED", "identityDocument.fileId": { $exists: true }, isAvailable: true, category: job.category }).session(session);
        if (!artisan || !profile) throw new WorkflowError("Cet artisan n’est plus disponible.", 409);
        const [serviceRequest] = await ServiceRequest.create([{
          clientId: user.id, artisanId: proposal.artisanId, category: job.category, description: job.description,
          address: job.address, scheduledAt: job.scheduledAt, budgetMin: job.budgetMin, budgetMax: job.budgetMax,
          status: "ACCEPTEE", announcedPrice: proposal.totalCents / 100,
          quoteItems: proposal.items.map((item: { description: string; amountCents: number }) => ({ description: item.description, amount: item.amountCents / 100 })),
          quoteSentAt: proposal.createdAt, quoteValidUntil: proposal.validUntil, quoteAcceptedAt: now,
          statusHistory: [{ status: "EN_ATTENTE", changedBy: user.id }, { status: "ACCEPTEE", changedBy: user.id }],
        }], { session });
        await JobProposal.updateOne({ _id: proposal._id, status: "PENDING" }, { $set: { status: "ACCEPTED" } }, { session });
        await JobProposal.updateMany({ jobId, _id: { $ne: proposal._id }, status: "PENDING" }, { $set: { status: "DECLINED" } }, { session });
        await JobPost.updateOne({ _id: job._id }, { $set: { serviceRequestId: serviceRequest._id } }, { session });
        serviceRequestId = serviceRequest.id;
      });
    } finally { await session.endSession(); }
    return Response.json({ serviceRequestId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkflowError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Attribution de mission impossible :", error);
    return Response.json({ error: "Impossible d’attribuer la mission." }, { status: 503 });
  }
}