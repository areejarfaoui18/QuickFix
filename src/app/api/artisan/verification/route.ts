import mongoose from "mongoose";
import { Readable } from "node:stream";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { isIdentityOcrConfigured, scheduleIdentityOcr } from "@/lib/identity-ocr";
import { detectAttachmentType, getIdentityDocumentBucket, MAX_ATTACHMENT_SIZE, uploadIdentityDocument } from "@/lib/message-attachments";
import { connectToDatabase } from "@/lib/mongodb";
import { ArtisanProfile } from "@/models/artisan-profile";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour accéder à la vérification." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });

    if (user.role === "ARTISAN") {
      const profile = await ArtisanProfile.findOne({ userId: user.id })
        .select("verificationStatus verificationReason identityDocument.fileId")
        .lean();
      if (!profile) return Response.json({ error: "Profil artisan introuvable." }, { status: 404 });
      return Response.json({
        status: profile.verificationStatus,
        reason: profile.verificationReason ?? "",
        hasDocument: Boolean(profile.identityDocument?.fileId),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    if (user.role !== "ADMIN") return Response.json({ error: "Accès réservé à l’administration." }, { status: 403 });
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!profileId || !mongoose.Types.ObjectId.isValid(profileId)) return Response.json({ error: "Profil invalide." }, { status: 400 });
    const profile = await ArtisanProfile.findById(profileId).select("identityDocument").lean();
    const document = profile?.identityDocument;
    if (!document?.fileId || !document.mimeType || !document.size) return Response.json({ error: "Pièce d’identité introuvable." }, { status: 404 });

    const bucket = getIdentityDocumentBucket();
    if (!(await bucket.find({ _id: document.fileId }).next())) return Response.json({ error: "Pièce d’identité introuvable." }, { status: 404 });
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
    const extension = extensions[document.mimeType];
    if (!extension) return Response.json({ error: "Format de pièce d’identité invalide." }, { status: 404 });
    return new Response(Readable.toWeb(bucket.openDownloadStream(document.fileId)) as ReadableStream, {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Length": String(document.size),
        "Content-Disposition": `attachment; filename=piece-identite.${extension}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    console.error("Accès à la vérification impossible :", error);
    return Response.json({ error: "Impossible d’accéder à la vérification." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });

  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour envoyer votre pièce d’identité." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "ARTISAN") return Response.json({ error: "Cette vérification est réservée aux artisans." }, { status: 403 });

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_ATTACHMENT_SIZE + 1024 * 1024) {
      return Response.json({ error: "La pièce d’identité ne doit pas dépasser 5 Mo." }, { status: 413 });
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "Le fichier envoyé est invalide." }, { status: 400 });
    }
    const files = form.getAll("document");
    if (files.length !== 1 || !(files[0] instanceof File) || files[0].size === 0 || files[0].size > MAX_ATTACHMENT_SIZE) {
      return Response.json({ error: "Choisissez une pièce d’identité de 5 Mo maximum." }, { status: 400 });
    }

    const profile = await ArtisanProfile.findOne({ userId: user.id }).select("verificationStatus identityDocument.fileId").lean();
    if (!profile) return Response.json({ error: "Profil artisan introuvable." }, { status: 404 });
    if (profile.verificationStatus !== "REJECTED" && profile.identityDocument?.fileId) {
      return Response.json({ error: "Votre pièce d’identité a déjà été envoyée." }, { status: 409 });
    }

    const buffer = Buffer.from(await files[0].arrayBuffer());
    const mimeType = detectAttachmentType(buffer);
    if (!mimeType) return Response.json({ error: "Utilisez un fichier JPG, PNG, WebP ou PDF valide." }, { status: 415 });

    const previousFileId = profile.identityDocument?.fileId;
    const fileId = await uploadIdentityDocument(buffer, mimeType);
    const ocrEnabled = isIdentityOcrConfigured();
    let updated;
    try {
      updated = await ArtisanProfile.findOneAndUpdate(
        {
          _id: profile._id,
          userId: user.id,
          verificationStatus: profile.verificationStatus,
          "identityDocument.fileId": previousFileId ?? { $exists: false },
        },
        {
          $set: {
            identityDocument: { fileId, mimeType, size: buffer.length },
            verificationStatus: "PENDING",
            verificationReason: "",
            ...(ocrEnabled ? { identityOcr: { status: "PROCESSING", fileId } } : {}),
          },
          $unset: { verifiedBy: 1, verifiedAt: 1, ...(ocrEnabled ? {} : { identityOcr: 1 }) },
        },
        { new: true, runValidators: true },
      );
    } catch (error) {
      await getIdentityDocumentBucket().delete(fileId);
      throw error;
    }
    if (!updated) {
      await getIdentityDocumentBucket().delete(fileId);
      return Response.json({ error: "Votre dossier a changé. Actualisez la page et réessayez." }, { status: 409 });
    }
    if (String(updated.identityDocument?.fileId) !== String(fileId)) {
      await getIdentityDocumentBucket().delete(fileId);
      return Response.json({ error: "La pièce d’identité n’a pas pu être enregistrée. Réessayez." }, { status: 503 });
    }
    if (previousFileId) {
      try {
        await getIdentityDocumentBucket().delete(previousFileId);
      } catch (error) {
        console.error("Suppression de l’ancienne pièce d’identité impossible :", error);
      }
    }
    scheduleIdentityOcr(profile._id, fileId);
    return Response.json({ status: "PENDING", hasDocument: true }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Envoi de la pièce d’identité impossible :", error);
    return Response.json({ error: "Impossible d’envoyer la pièce d’identité." }, { status: 503 });
  }
}