import { hashEmailVerificationToken } from "@/lib/email-verification";
import { hasSameOrigin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { User } from "@/models/user";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });

  try {
    await connectToDatabase();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Le lien de vérification est invalide." }, { status: 400 });
    }
    if (!isRecord(body) || typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) {
      return Response.json({ error: "Le lien de vérification est invalide." }, { status: 400 });
    }

    const tokenFilter = {
      emailVerificationTokenHash: hashEmailVerificationToken(body.token),
      emailVerificationExpiresAt: { $gt: new Date() },
      emailVerified: false,
      role: { $in: ["CLIENT", "ARTISAN"] },
    };
    const pendingUser = await User.findOne(tokenFilter).select("role");
    if (!pendingUser) {
      return Response.json({ error: "Ce lien est expiré ou a déjà été utilisé. Demandez un nouveau lien de vérification." }, { status: 400 });
    }

    const user = await User.findOneAndUpdate(
      { ...tokenFilter, _id: pendingUser._id, role: pendingUser.role },
      {
        $set: { emailVerified: true, ...(pendingUser.role === "CLIENT" ? { isSuspended: false, suspensionReason: "" } : {}) },
        $unset: {
          emailVerificationTokenHash: 1,
          emailVerificationExpiresAt: 1,
          emailVerificationSentAt: 1,
        },
      },
      { new: true },
    ).select("name role");
    if (!user) {
      return Response.json({ error: "Ce lien est expiré ou a déjà été utilisé. Demandez un nouveau lien de vérification." }, { status: 400 });
    }

    if (user.role === "CLIENT") {
      return Response.json({ verified: true, role: "CLIENT", message: "Adresse confirmée. Vous pouvez maintenant vous connecter à QuickFix." });
    }

    return Response.json({
      verified: true,
      role: "ARTISAN",
      message: "Adresse confirmée. Votre compte reste suspendu jusqu’à la validation de votre profil par l’administration.",
    });
  } catch (error) {
    console.error("Vérification d’adresse e-mail impossible :", error);
    return Response.json({ error: "Impossible de vérifier l’adresse e-mail pour le moment." }, { status: 503 });
  }
}
