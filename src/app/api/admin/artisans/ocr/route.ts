import mongoose from "mongoose";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { isIdentityOcrConfigured, scheduleIdentityOcr } from "@/lib/identity-ocr";
import { connectToDatabase } from "@/lib/mongodb";
import { ArtisanProfile } from "@/models/artisan-profile";

// The GPU may need a few minutes to start; the reading continues after the response.
export const maxDuration = 300;

/** Lets an administrator (re)start the automatic reading of a pending identity document. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });

  try {
    await connectToDatabase();
    const admin = await getAuthenticatedUser(request);
    if (!admin) return Response.json({ error: "Connectez-vous pour accéder à l’administration." }, { status: 401 });
    if (admin.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (admin.role !== "ADMIN") return Response.json({ error: "Accès réservé à l’administration." }, { status: 403 });
    if (!isIdentityOcrConfigured()) return Response.json({ error: "La lecture automatique n’est pas configurée (IDENTITY_OCR_URL et IDENTITY_OCR_TOKEN)." }, { status: 503 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
    }
    const profileId = typeof body === "object" && body !== null && "profileId" in body ? body.profileId : null;
    if (typeof profileId !== "string" || !mongoose.Types.ObjectId.isValid(profileId)) {
      return Response.json({ error: "Le profil sélectionné est invalide." }, { status: 400 });
    }

    const profile = await ArtisanProfile.findOne({ _id: profileId, verificationStatus: "PENDING" }).select("identityDocument.fileId").lean();
    const fileId = profile?.identityDocument?.fileId;
    if (!profile || !fileId) return Response.json({ error: "Aucune pièce d’identité en attente pour ce profil." }, { status: 409 });

    await ArtisanProfile.updateOne(
      { _id: profile._id, "identityDocument.fileId": fileId },
      { $set: { identityOcr: { status: "PROCESSING", fileId } } },
    );
    scheduleIdentityOcr(profile._id, fileId);
    return Response.json({ identityOcr: { status: "PROCESSING" } }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Lancement de la lecture automatique impossible :", error);
    return Response.json({ error: "Impossible de lancer la lecture automatique." }, { status: 503 });
  }
}
