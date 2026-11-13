import mongoose from "mongoose";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { Report } from "@/models/report";
import { Review } from "@/models/review";
import { ServiceRequest } from "@/models/service-request";
import { User } from "@/models/user";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const admin = await getAuthenticatedUser(request);
    if (!admin) return Response.json({ error: "Connectez-vous pour accéder à l’administration." }, { status: 401 });
    if (admin.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (admin.role !== "ADMIN") return Response.json({ error: "Accès réservé à l’administration." }, { status: 403 });

    const [reviewDocs, reportDocs] = await Promise.all([
      Review.find().sort({ createdAt: -1 }).limit(200).lean(),
      Report.find({ targetType: "REQUEST" }).sort({ createdAt: -1 }).limit(200).lean(),
    ]);
    const requestIds = [...new Set([...reviewDocs.map((review) => review.requestId.toString()), ...reportDocs.map((report) => report.targetId.toString())])];
    const userIds = [...new Set([...reviewDocs.flatMap((review) => [review.clientId.toString(), review.artisanId.toString()]), ...reportDocs.map((report) => report.reporterId.toString())])];
    const [requests, users] = await Promise.all([
      ServiceRequest.find({ _id: { $in: requestIds } }).select("category description status").lean(),
      User.find({ _id: { $in: userIds } }).select("name email phone").lean(),
    ]);
    const requestsById = new Map(requests.map((item) => [item._id.toString(), item]));
    const usersById = new Map(users.map((item) => [item._id.toString(), item]));

    return Response.json({
      reviews: reviewDocs.map((review) => ({
        id: review._id.toString(),
        requestId: review.requestId.toString(),
        clientName: usersById.get(review.clientId.toString())?.name ?? "Client",
        artisanName: usersById.get(review.artisanId.toString())?.name ?? "Artisan",
        rating: review.rating,
        comment: review.comment,
        isHidden: review.isHidden,
        createdAt: review.createdAt,
        category: requestsById.get(review.requestId.toString())?.category ?? "",
      })),
      reports: reportDocs.map((report) => {
        const serviceRequest = requestsById.get(report.targetId.toString());
        const reporter = usersById.get(report.reporterId.toString());
        return {
          id: report._id.toString(),
          requestId: report.targetId.toString(),
          reporterName: reporter?.name ?? "Client",
          reporterEmail: reporter?.email ?? "",
          reporterPhone: reporter?.phone ?? "",
          reason: report.reason,
          status: report.status,
          resolutionNote: report.resolutionNote ?? "",
          createdAt: report.createdAt,
          category: serviceRequest?.category ?? "",
          requestStatus: serviceRequest?.status ?? "SUPPRIMEE",
          requestDescription: serviceRequest?.description ?? "",
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Chargement de la modération impossible :", error);
    return Response.json({ error: "Impossible de charger les avis et réclamations." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });

  try {
    await connectToDatabase();
    const admin = await getAuthenticatedUser(request);
    if (!admin) return Response.json({ error: "Connectez-vous pour accéder à l’administration." }, { status: 401 });
    if (admin.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (admin.role !== "ADMIN") return Response.json({ error: "Accès réservé à l’administration." }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
    }
    if (!isRecord(body) || typeof body.id !== "string" || !mongoose.Types.ObjectId.isValid(body.id)) {
      return Response.json({ error: "L’élément sélectionné est invalide." }, { status: 400 });
    }

    if (body.action === "resolve-report") {
      if (typeof body.note !== "string" || body.note.trim().length < 2 || body.note.trim().length > 1000) {
        return Response.json({ error: "Ajoutez une note de résolution de 2 à 1 000 caractères." }, { status: 400 });
      }
      const report = await Report.findOneAndUpdate(
        { _id: body.id, targetType: "REQUEST", status: { $in: ["OUVERT", "EN_COURS"] } },
        { $set: { status: "RESOLU", resolutionNote: body.note.trim(), resolvedBy: admin.id, resolvedAt: new Date() } },
        { new: true, runValidators: true },
      ).select("_id status");
      if (!report) return Response.json({ error: "Cette réclamation n’est plus ouverte ou est introuvable." }, { status: 404 });
      return Response.json({ id: report.id, status: report.status }, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.action === "set-review-visibility" && typeof body.isHidden === "boolean") {
      const review = await Review.findByIdAndUpdate(body.id, { $set: { isHidden: body.isHidden } }, { new: true }).select("_id isHidden");
      if (!review) return Response.json({ error: "Avis introuvable." }, { status: 404 });
      return Response.json({ id: review.id, isHidden: review.isHidden }, { headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({ error: "Action de modération invalide." }, { status: 400 });
  } catch (error) {
    console.error("Mise à jour de la modération impossible :", error);
    return Response.json({ error: "Impossible d’enregistrer cette décision." }, { status: 503 });
  }
}
