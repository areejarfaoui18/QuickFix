"use client";

import { useState, type FormEvent } from "react";
import type { IdentityVerification } from "@/components/account-panel";

type IdentityVerificationPanelProps = {
  verification: IdentityVerification | null;
  verificationError: string;
  onVerificationChanged: (verification: IdentityVerification) => void;
  onRefreshVerification: () => void;
  onBack: () => void;
};

export function IdentityVerificationPanel({ verification, verificationError, onVerificationChanged, onRefreshVerification, onBack }: IdentityVerificationPanelProps) {
  const [identityFile, setIdentityFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);

  async function submitIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identityFile || !verification || (verification.hasDocument && verification.status !== "REJECTED")) return;
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.set("document", identityFile);
      const response = await fetch("/api/artisan/verification", { method: "POST", body: formData });
      const result: { status?: IdentityVerification["status"]; hasDocument?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.status) {
        if (response.status === 409) onRefreshVerification();
        throw new Error(result.error ?? "Impossible d’envoyer la pièce d’identité.");
      }
      onVerificationChanged({ status: result.status, hasDocument: Boolean(result.hasDocument), reason: "" });
      setIdentityFile(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Impossible d’envoyer la pièce d’identité.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="account-panel">
      <button className="text-link" onClick={onBack}>Retour au profil</button>
      <h1>Vérification d’identité</h1>
      {verificationError && !verification ? <p className="form-error" role="alert">{verificationError}</p> : !verification ? <p role="status">Chargement de votre dossier…</p> : verification.status === "VERIFIED" && verification.hasDocument ? <p className="success-message">Votre identité a été approuvée.</p> : verification.status === "PENDING" && verification.hasDocument ? <p role="status">Votre pièce d’identité a été envoyée et attend la vérification de l’administration.</p> : <>
        {verification.status === "REJECTED" && <p className="form-error">Vérification refusée{verification.reason ? ` : ${verification.reason}` : "."} Envoyez une nouvelle pièce pour demander une nouvelle vérification.</p>}
        <form className="dialog-form" onSubmit={submitIdentity}>
          <label>Pièce d’identité (JPG, PNG, WebP ou PDF, 5 Mo maximum)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={(event) => setIdentityFile(event.target.files?.[0] ?? null)} /></label>
          {uploadError && <p className="form-error" role="alert">{uploadError}</p>}
          <button className="primary-button" type="submit" disabled={uploading || !identityFile}>{uploading ? "Envoi…" : "Envoyer pour vérification"}</button>
        </form>
      </>}
    </section>
  );
}