import { hasSameOrigin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { requestPasswordReset } from "@/lib/password-reset";

const SUCCESS_MESSAGE = "Si un compte actif correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.";

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
    await requestPasswordReset({ email, requestUrl: request.url });
  } catch (error) {
    console.error("Demande de réinitialisation impossible :", error);
  }
  return Response.json({ message: SUCCESS_MESSAGE });
}
