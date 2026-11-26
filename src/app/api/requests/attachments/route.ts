import mongoose from "mongoose";
import { Readable } from "node:stream";
import { getRequestAttachmentBucket } from "@/lib/message-attachments";
import { getAuthenticatedUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { ServiceRequest } from "@/models/service-request";

const requestPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
type StoredRequestPhoto = { fileId: mongoose.Types.ObjectId; name: string; mimeType: string; size: number };

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour consulter cette photo." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT" && user.role !== "ARTISAN") {
      return Response.json({ error: "Cette photo est réservée au client et à l’artisan concernés." }, { status: 403 });
    }

    const params = new URL(request.url).searchParams;
    const requestId = params.get("requestId");
    const fileId = params.get("fileId");
    if (!requestId || !fileId || !mongoose.Types.ObjectId.isValid(requestId) || !mongoose.Types.ObjectId.isValid(fileId)) {
      return Response.json({ error: "La photo demandée est invalide." }, { status: 400 });
    }

    const ownership = user.role === "CLIENT" ? { clientId: user.id } : { artisanId: user.id };
    const serviceRequest = await ServiceRequest.findOne({
      _id: requestId,
      ...ownership,
      "photos.fileId": new mongoose.Types.ObjectId(fileId),
    }).select("photos");
    const photo = serviceRequest?.photos.find((item: StoredRequestPhoto) => item.fileId.toString() === fileId);
    if (!photo || !requestPhotoTypes.has(photo.mimeType)) {
      return Response.json({ error: "Photo introuvable." }, { status: 404 });
    }

    const bucket = getRequestAttachmentBucket();
    const file = await bucket.find({ _id: new mongoose.Types.ObjectId(fileId) }).next();
    if (!file) return Response.json({ error: "Le fichier est introuvable dans le stockage." }, { status: 404 });

    return new Response(Readable.toWeb(bucket.openDownloadStream(new mongoose.Types.ObjectId(fileId))) as ReadableStream, {
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Length": String(photo.size),
        "Content-Disposition": `inline; filename="request-photo"; filename*=UTF-8''${encodeURIComponent(photo.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Téléchargement de photo de demande impossible :", error);
    return Response.json({ error: "Impossible de télécharger cette photo." }, { status: 503 });
  }
}
