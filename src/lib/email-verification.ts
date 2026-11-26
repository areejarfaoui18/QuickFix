import { createHash, randomBytes } from "node:crypto";
import { User } from "@/models/user";

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getApplicationUrl(requestUrl: string): string {
  const configuredUrl = process.env.APP_URL;
  if (configuredUrl) {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
      throw new Error("APP_URL doit utiliser HTTPS en production.");
    }
    return url.origin;
  }
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL doit être configurée en production.");
  return new URL(requestUrl).origin;
}

export function assertVerificationEmailConfigured(requestUrl: string): void {
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.RESEND_FROM_EMAIL?.trim()) {
    throw new Error("Configurez RESEND_API_KEY et RESEND_FROM_EMAIL avant d’activer l’inscription par e-mail.");
  }
  getApplicationUrl(requestUrl);
}

export async function sendVerificationEmail(options: {
  email: string;
  requestUrl: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const sender = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !sender) {
    throw new Error("La configuration Resend est incomplète. Configurez RESEND_API_KEY et RESEND_FROM_EMAIL.");
  }
  const applicationUrl = getApplicationUrl(options.requestUrl);

  const user = await User.findOne({ email: options.email, emailVerified: false })
    .select("name role +emailVerificationSentAt");
  if (!user || (user.role !== "CLIENT" && user.role !== "ARTISAN")) {
    throw new Error("Le compte en attente de vérification est introuvable.");
  }
  if (user.emailVerificationSentAt && Date.now() - user.emailVerificationSentAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new Error("Un e-mail vient d’être envoyé. Attendez une minute avant d’en demander un autre.");
  }

  const token = randomBytes(32).toString("base64url");
  user.emailVerificationTokenHash = hashToken(token);
  user.emailVerificationExpiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
  user.emailVerificationSentAt = new Date();
  await user.save();

  const verificationUrl = new URL("/verify-email", applicationUrl);
  verificationUrl.searchParams.set("token", token);
  const isArtisan = user.role === "ARTISAN";
  const nextStep = isArtisan
    ? "Après confirmation de votre e-mail, votre compte restera en attente jusqu’à la validation de votre profil par l’administration."
    : "Après confirmation de votre e-mail, vous pourrez vous connecter à QuickFix.";
  const greetingName = user.name.replace(/[<>&"]/g, "");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender,
        to: options.email,
        subject: "Confirmez votre adresse e-mail — QuickFix",
        html: `<div style="font-family:Arial,sans-serif;color:#344139;line-height:1.6"><h1 style="color:#286b52">QuickFix</h1><p>Bonjour ${greetingName},</p><p>Confirmez votre adresse e-mail en cliquant sur le bouton ci-dessous. Le lien expire dans 24 heures.</p><p><a href="${verificationUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#286b52;color:#fff;text-decoration:none">Confirmer mon adresse e-mail</a></p><p>${nextStep}</p><p>Si vous n’avez pas créé de compte QuickFix, ignorez ce message.</p></div>`,
        text: `Bonjour ${user.name},\n\nConfirmez votre adresse e-mail en ouvrant ce lien (valable 24 heures) :\n${verificationUrl}\n\n${nextStep}\n\nSi vous n’avez pas créé de compte QuickFix, ignorez ce message.`,
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Resend a renvoyé le statut HTTP ${response.status}.`);
    }
  } catch (error) {
    await clearVerificationToken(user.id);
    throw new Error("Impossible d’envoyer l’e-mail avec Resend. Vérifiez RESEND_API_KEY, RESEND_FROM_EMAIL et la configuration du domaine.", { cause: error });
  }
}

async function clearVerificationToken(userId: string): Promise<void> {
  await User.updateOne(
    { _id: userId, emailVerified: false },
    { $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1, emailVerificationSentAt: 1 } },
  );
}

export function hashEmailVerificationToken(token: string): string {
  return hashToken(token);
}
