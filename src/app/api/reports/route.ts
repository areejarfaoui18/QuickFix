import mongoose from "mongoose";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { Report } from "@/models/report";
import { ServiceRequest } from "@/models/service-request";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });

  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour envoyer une réclamation." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT") return Response.json({ error: "Seul un client peut envoyer une réclamation." }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Les informations de la réclamation sont invalides." }, { status: 400 });
    }
    if (!isRecord(body) || typeof body.requestId !== "string" || !mongoose.Types.ObjectId.isValid(body.requestId) ||
        typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.trim().length > 1200) {
      return Response.json({ error: "La réclamation doit contenir entre 10 et 1 200 caractères." }, { status: 400 });
    }

    const serviceRequest = await ServiceRequest.findOne({ _id: body.requestId, clientId: user.id }).select("_id");
    if (!serviceRequest) return Response.json({ error: "Cette demande est introuvable dans votre compte." }, { status: 404 });
    const openReport = await Report.exists({
      reporterId: user.id,
      targetType: "REQUEST",
      targetId: serviceRequest._id,
      status: { $in: ["OUVERT", "EN_COURS"] },
    });
    if (openReport) return Response.json({ error: "Une réclamation est déjà en cours pour cette demande." }, { status: 409 });

    const report = await Report.create({
      reporterId: user.id,
      targetType: "REQUEST",
      targetId: serviceRequest._id,
      reason: body.reason.trim(),
    });
    return Response.json({ report: { id: report.id, status: report.status } }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Envoi de la réclamation impossible :", error);
    return Response.json({ error: "Impossible d’envoyer votre réclamation pour le moment." }, { status: 503 });
  }
}
