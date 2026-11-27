import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { User } from "@/models/user";

const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getApplicationUrl(requestUrl: string): string {
  const configuredUrl = process.env.APP_URL?.trim();
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

function getSmtpConfiguration() {
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_APP_PASSWORD?.trim();
  if (!user || !password) {
    throw new Error("La configuration Gmail est incomplète. Configurez SMTP_USER et SMTP_APP_PASSWORD.");
  }
  return { user, password };
}

export function hashPasswordResetToken(token: string): string {
  return hashToken(token);
}

export async function requestPasswordReset(options: { email: string; requestUrl: string }): Promise<void> {
  const user = await User.findOne({ email: options.email, isSuspended: false })
    .select("name email +passwordResetSentAt");
  if (!user || (user.passwordResetSentAt && Date.now() - user.passwordResetSentAt.getTime() < RESEND_COOLDOWN_MS)) {
    return;
  }

  const token = randomBytes(32).toString("base64url");
  user.passwordResetTokenHash = hashToken(token);
  user.passwordResetExpiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
  user.passwordResetSentAt = new Date();
  await user.save();

  const { user: smtpUser, password } = getSmtpConfiguration();
  const resetUrl = new URL("/reset-password", getApplicationUrl(options.requestUrl));
  resetUrl.searchParams.set("token", token);
  const greetingName = user.name.replace(/[<>&"]/g, "");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: smtpUser, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
  });

  try {
    await transport.sendMail({
      from: `QuickFix <${smtpUser}>`,
      to: user.email,
      subject: "Réinitialisez votre mot de passe — QuickFix",
      html: `<div style="font-family:Arial,sans-serif;color:#344139;line-height:1.6"><h1 style="color:#286b52">QuickFix</h1><p>Bonjour ${greetingName},</p><p>Vous avez demandé la réinitialisation de votre mot de passe. Ce lien expire dans une heure.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#286b52;color:#fff;text-decoration:none">Réinitialiser mon mot de passe</a></p><p>Si vous n’avez pas fait cette demande, ignorez cet e-mail.</p></div>`,
      text: `Bonjour ${user.name},\n\nVous avez demandé la réinitialisation de votre mot de passe. Ce lien expire dans une heure :\n${resetUrl}\n\nSi vous n’avez pas fait cette demande, ignorez cet e-mail.`,
    });
  } catch (error) {
    await User.updateOne(
      { _id: user.id, passwordResetTokenHash: hashToken(token) },
      { $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1, passwordResetSentAt: 1 } },
    );
    throw new Error("Impossible d’envoyer l’e-mail de réinitialisation. Vérifiez la configuration Gmail.", { cause: error });
  }
}
