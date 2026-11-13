"use client";

import { useState } from "react";
import Link from "next/link";

type VerificationState = {
  kind: "idle" | "success" | "error";
  message: string;
  role?: "CLIENT" | "ARTISAN";
};

export default function VerifyEmailPage() {
  const [verification, setVerification] = useState<VerificationState>({ kind: "idle", message: "" });
  const [loading, setLoading] = useState(false);

  async function verifyEmail() {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    setLoading(true);
    setVerification({ kind: "idle", message: "" });
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result: { message?: string; error?: string; role?: "CLIENT" | "ARTISAN" } = await response.json();
      if (!response.ok || !result.message || !result.role) {
        throw new Error(result.error ?? "Le lien de vérification est invalide.");
      }
      setVerification({ kind: "success", message: result.message, role: result.role });
    } catch (error) {
      setVerification({
        kind: "error",
        message: error instanceof Error ? error.message : "Impossible de vérifier l’adresse e-mail.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="verification-page">
      <section className="verification-card">
        <Link className="brand verification-brand" href="/"><span className="brand-mark">q<span>.</span></span><span>quickfix</span></Link>
        <p className="eyebrow">VÉRIFICATION DE L’ADRESSE</p>
        <h1>Confirmez votre e-mail</h1>
        {verification.kind === "idle" && <p>Appuyez sur le bouton pour confirmer l’adresse associée à votre compte QuickFix.</p>}
        {verification.message && <p className={verification.kind === "error" ? "form-error" : "verification-success"} role={verification.kind === "error" ? "alert" : "status"}>{verification.message}</p>}
        {verification.kind === "idle" || verification.kind === "error" ? (
          <button className="primary-button" disabled={loading} onClick={() => void verifyEmail()}>{loading ? "Vérification…" : "Confirmer mon adresse e-mail"}</button>
        ) : verification.role === "CLIENT" ? (
          <Link className="primary-button verification-link" href="/">Retour à QuickFix et connexion</Link>
        ) : (
          <Link className="primary-button verification-link" href="/">Retour à QuickFix</Link>
        )}
      </section>
    </main>
  );
}
