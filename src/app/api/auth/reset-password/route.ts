import { hasSameOrigin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { hashPassword } from "@/lib/password";
import { hashPasswordResetToken } from "@/lib/password-reset";
import { User } from "@/models/user";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.token !== "string" || typeof body.password !== "string") {
    return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(body.token)) {
    return Response.json({ error: "Ce lien de réinitialisation est invalide ou expiré." }, { status: 400 });
  }
  if (body.password.length < 12 || body.password.length > 128 || Buffer.byteLength(body.password, "utf8") > 256) {
    return Response.json({ error: "Le mot de passe doit contenir entre 12 et 128 caractères." }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const user = await User.findOneAndUpdate(
      {
        passwordResetTokenHash: hashPasswordResetToken(body.token),
        passwordResetExpiresAt: { $gt: new Date() },
        isSuspended: false,
      },
      {
        $set: { passwordHash: await hashPassword(body.password), mustChangePassword: false },
        $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1, passwordResetSentAt: 1 },
      },
      { new: true },
    );
    if (!user) return Response.json({ error: "Ce lien de réinitialisation est invalide ou expiré." }, { status: 400 });
    return Response.json({ message: "Votre mot de passe a été réinitialisé. Vous pouvez maintenant vous connecter." });
  } catch (error) {
    console.error("Réinitialisation du mot de passe impossible :", error);
    return Response.json({ error: "Impossible de réinitialiser le mot de passe pour le moment." }, { status: 503 });
  }
}
