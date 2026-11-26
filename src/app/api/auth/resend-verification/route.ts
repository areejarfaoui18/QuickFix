import { sendVerificationEmail } from "@/lib/email-verification";
import { hasSameOrigin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
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
    return Response.json({ error: "Renseignez l’adresse e-mail du compte." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.email !== "string") {
    return Response.json({ error: "Renseignez l’adresse e-mail du compte." }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return Response.json({ error: "L’adresse e-mail n’est pas valide." }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const user = await User.findOne({ email }).select("name role emailVerified");
    if (!user || user.emailVerified || (user.role !== "CLIENT" && user.role !== "ARTISAN")) {
      return Response.json({ message: "Si le compte existe et attend une vérification, un lien sera envoyé." });
    }
    await sendVerificationEmail({ email, requestUrl: request.url });
    return Response.json({ message: "Un nouveau lien de vérification a été envoyé." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible d’envoyer le lien de vérification.";
    const status = message.includes("attendez une minute") ? 429 : 503;
    if (status === 503) console.error("Renvoi de l’e-mail de vérification impossible :", error);
    return Response.json({ error: message }, { status });
  }
}
