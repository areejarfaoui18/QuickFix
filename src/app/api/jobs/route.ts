import mongoose from "mongoose";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { canonicalCity } from "@/lib/cities";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplace";
import { connectToDatabase } from "@/lib/mongodb";
import { ArtisanProfile } from "@/models/artisan-profile";
import { JobPost } from "@/models/job-post";
import { JobProposal } from "@/models/job-proposal";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour consulter les missions." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT" && user.role !== "ARTISAN") return Response.json({ error: "Ce compte ne peut pas consulter les missions." }, { status: 403 });

    if (user.role === "CLIENT") {
      const jobs = await JobPost.find({ clientId: user.id })
        .select("title category city description scheduledAt budgetMin budgetMax status proposalCount createdAt serviceRequestId")
        .sort({ createdAt: -1 }).limit(100).lean();
      return Response.json({ jobs: jobs.map((job) => ({
        id: job._id.toString(), title: job.title, category: job.category, city: job.city,
        description: job.description, scheduledAt: job.scheduledAt, budgetMin: job.budgetMin ?? null,
        budgetMax: job.budgetMax ?? null, status: job.status, proposalCount: job.proposalCount,
        createdAt: job.createdAt, serviceRequestId: job.serviceRequestId?.toString() ?? null,
      })) }, { headers: { "Cache-Control": "no-store" } });
    }

    const profile = await ArtisanProfile.findOne({ userId: user.id })
      .select("category isAvailable verificationStatus identityDocument.fileId").lean();
    const eligible = Boolean(profile?.verificationStatus === "VERIFIED" && profile.identityDocument?.fileId && profile.isAvailable);
    const ownProposals = await JobProposal.find({ artisanId: user.id }).select("jobId status totalCents commissionCents validUntil").lean();
    const proposalByJob = new Map(ownProposals.map((proposal) => [proposal.jobId.toString(), proposal]));
    const jobs = await JobPost.find({
      $or: [
        ...(eligible ? [{ status: "OPEN", category: profile?.category, scheduledAt: { $gt: new Date() } }] : []),
        { _id: { $in: ownProposals.map((proposal) => proposal.jobId) } },
      ],
    }).select("title category city description scheduledAt budgetMin budgetMax status createdAt")
      .sort({ createdAt: -1 }).limit(100).lean();
    return Response.json({ jobs: jobs.map((job) => {
      const proposal = proposalByJob.get(job._id.toString());
      return {
        id: job._id.toString(), title: job.title, category: job.category, city: job.city,
        description: job.description, scheduledAt: job.scheduledAt, budgetMin: job.budgetMin ?? null,
        budgetMax: job.budgetMax ?? null, status: job.status, createdAt: job.createdAt,
        myProposal: proposal ? { status: proposal.status, totalCents: proposal.totalCents, commissionCents: proposal.commissionCents, validUntil: proposal.validUntil } : null,
      };
    }), eligible }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Chargement des missions impossible :", error);
    return Response.json({ error: "Impossible de charger les missions." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour publier une mission." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT") return Response.json({ error: "Seul un client peut publier une mission." }, { status: 403 });

    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 }); }
    if (!isRecord(body)) return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const category = typeof body.category === "string" ? body.category : "";
    const city = canonicalCity(body.city) ?? "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const scheduledAt = typeof body.scheduledAt === "string" ? new Date(body.scheduledAt) : new Date(Number.NaN);
    const budgetMin = body.budgetMin === null || body.budgetMin === undefined ? undefined : body.budgetMin;
    const budgetMax = body.budgetMax === null || body.budgetMax === undefined ? undefined : body.budgetMax;
    if (title.length < 5 || title.length > 120 || city.length < 2 || city.length > 80 || description.length < 20 || description.length > 2000 || !address || address.length > 300) {
      return Response.json({ error: "Vérifiez le titre, la ville (à choisir dans la liste), la description et l’adresse." }, { status: 400 });
    }
    if (!MARKETPLACE_CATEGORIES.includes(category as (typeof MARKETPLACE_CATEGORIES)[number])) return Response.json({ error: "Choisissez une catégorie valide." }, { status: 400 });
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() || scheduledAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
      return Response.json({ error: "Choisissez une date future dans l’année à venir." }, { status: 400 });
    }
    if ([budgetMin, budgetMax].some((amount) => amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000))) {
      return Response.json({ error: "Vérifiez la fourchette de budget." }, { status: 400 });
    }
    if (typeof budgetMin === "number" && typeof budgetMax === "number" && budgetMin > budgetMax) {
      return Response.json({ error: "Le budget maximum doit être supérieur ou égal au minimum." }, { status: 400 });
    }

    const job = await JobPost.create({ clientId: user.id, title, category, city, description, address, scheduledAt, budgetMin, budgetMax });
    return Response.json({ id: job.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Publication de mission impossible :", error);
    return Response.json({ error: "Impossible de publier la mission." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour annuler une mission." }, { status: 401 });
    if (user.mustChangePassword || user.role !== "CLIENT") return Response.json({ error: "Seul le client peut annuler une mission." }, { status: 403 });
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Mission invalide." }, { status: 400 }); }
    if (!isRecord(body) || typeof body.id !== "string" || !mongoose.Types.ObjectId.isValid(body.id)) {
      return Response.json({ error: "Mission invalide." }, { status: 400 });
    }
    const jobId = body.id;
    const session = await mongoose.startSession();
    let cancelled = false;
    try {
      await session.withTransaction(async () => {
        const job = await JobPost.findOneAndUpdate(
          { _id: jobId, clientId: user.id, status: "OPEN" },
          { $set: { status: "CANCELLED" } }, { new: true, session },
        );
        if (!job) return;
        await JobProposal.updateMany({ jobId: job._id, status: "PENDING" }, { $set: { status: "DECLINED" } }, { session });
        cancelled = true;
      });
    } finally { await session.endSession(); }
    if (!cancelled) return Response.json({ error: "Cette mission est introuvable ou n’est plus ouverte." }, { status: 409 });
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Annulation de mission impossible :", error);
    return Response.json({ error: "Impossible d’annuler la mission." }, { status: 503 });
  }
}