"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setSubmitting(true);
    try {
      const token = new URLSearchParams(window.location.search).get("token") ?? "";
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result: { message?: string; error?: string } = await response.json();
      if (!response.ok || !result.message) {
        setError(result.error ?? "Impossible de réinitialiser le mot de passe.");
        return;
      }
      setMessage(result.message);
      setPassword("");
      setConfirmation("");
    } catch (submitError) {
      console.error("Réinitialisation du mot de passe impossible :", submitError);
      setError("Le service est momentanément indisponible. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="verification-page">
      <section className="verification-card">
        <Link className="brand verification-brand" href="/"><span className="brand-mark">q<span>.</span></span><span>quickfix</span></Link>
        <p className="eyebrow">SÉCURITÉ DU COMPTE</p>
        <h1>Réinitialisez votre mot de passe</h1>
        {message ? <>
          <p className="verification-success" role="status">{message}</p>
          <Link className="primary-button verification-link" href="/">Retour à la connexion</Link>
        </> : <form className="dialog-form" onSubmit={submit}>
          <label>Nouveau mot de passe<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Confirmer le nouveau mot de passe<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <small className="form-hint">Le mot de passe doit contenir au moins 12 caractères.</small>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Réinitialisation…" : "Réinitialiser mon mot de passe"}</button>
        </form>}
      </section>
    </main>
  );
}
