import mongoose from "mongoose";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { Review } from "@/models/review";
import { ServiceRequest } from "@/models/service-request";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });

  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour laisser un avis." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT") return Response.json({ error: "Seul le client peut noter l’artisan." }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Les informations de l’avis sont invalides." }, { status: 400 });
    }
    if (!isRecord(body) || typeof body.requestId !== "string" || !mongoose.Types.ObjectId.isValid(body.requestId) ||
        typeof body.rating !== "number" || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 ||
        typeof body.comment !== "string" || body.comment.trim().length > 1200) {
      return Response.json({ error: "Choisissez une note de 1 à 5 étoiles et un commentaire de 1 200 caractères maximum." }, { status: 400 });
    }

    const serviceRequest = await ServiceRequest.findOne({
      _id: body.requestId,
      clientId: user.id,
      status: "TERMINEE",
    }).select("_id clientId artisanId");
    if (!serviceRequest) {
      return Response.json({ error: "Seule une demande terminée vous appartenant peut recevoir un avis." }, { status: 400 });
    }
    if (await Review.exists({ requestId: serviceRequest._id })) {
      return Response.json({ error: "Un avis a déjà été envoyé pour cette demande." }, { status: 409 });
    }

    const review = await Review.create({
      requestId: serviceRequest._id,
      clientId: user.id,
      artisanId: serviceRequest.artisanId,
      rating: body.rating,
      comment: body.comment.trim(),
    });
    return Response.json({ review: { id: review.id, rating: review.rating, comment: review.comment } }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return Response.json({ error: "Un avis a déjà été envoyé pour cette demande." }, { status: 409 });
    }
    console.error("Envoi de l’avis impossible :", error);
    return Response.json({ error: "Impossible d’envoyer votre avis pour le moment." }, { status: 503 });
  }
}
