"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AppUser } from "@/components/auth-dialog";

type AccountProfile = {
  name: string;
  email: string;
  phone: string;
  role: AppUser["role"];
  artisan: {
    category: string;
    city: string;
    bio: string;
    indicativePriceMin: number | null;
    indicativePriceMax: number | null;
  } | null;
};

export type IdentityVerification = {
  status: "PENDING" | "VERIFIED" | "REJECTED";
  reason: string;
  hasDocument: boolean;
};

export function AccountPanel({ user, onPasswordChanged, verification, verificationError, onOpenVerification }: {
  user: AppUser;
  onPasswordChanged: () => void;
  verification: IdentityVerification | null;
  verificationError: string;
  onOpenVerification: () => void;
}) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/account", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result: { profile?: AccountProfile; error?: string } = await response.json();
        if (!response.ok || !result.profile) throw new Error(result.error ?? "Impossible de charger votre profil.");
        setProfile(result.profile);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Chargement du profil impossible :", loadError);
        setProfileError(loadError instanceof Error ? loadError.message : "Impossible de charger votre profil.");
      });
    return () => controller.abort();
  }, []);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Impossible de changer le mot de passe.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      onPasswordChanged();
      setMessage("Mot de passe modifié. Les autres sessions ont été fermées.");
    } catch (submitError) {
      console.error("Changement de mot de passe impossible :", submitError);
      setError("Le service est momentanément indisponible. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="account-panel">
      <p className="eyebrow">VOTRE ESPACE QUICKFIX</p>
      <h1>Mon profil</h1>
      <div className="account-summary"><span className="avatar avatar-small sage">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.role === "ARTISAN" ? "Compte artisan" : user.role === "ADMIN" ? "Compte administrateur" : "Compte client"}</small></span></div>
      <section className="account-details">
        <div className="account-section-heading"><div><h2>Mes coordonnées</h2><p>Les informations associées à votre compte QuickFix.</p></div></div>
        {profileError ? <p className="form-error" role="alert">{profileError}</p> : !profile ? <p className="form-hint" role="status">Chargement de vos coordonnées…</p> : (
          <>
            <dl className="account-contact-grid">
              <div><dt>Nom complet</dt><dd>{profile.name}</dd></div>
              <div><dt>Adresse e-mail</dt><dd>{profile.email}</dd></div>
              <div><dt>Téléphone</dt><dd>{profile.phone || "Non renseigné"}</dd></div>
              {profile.artisan && <><div><dt>Profession</dt><dd>{profile.artisan.category}</dd></div><div><dt>Ville d’intervention</dt><dd>{profile.artisan.city}</dd></div></>}
            </dl>
            {profile.artisan?.bio && <div className="account-artisan-bio"><strong>Présentation professionnelle</strong><p>{profile.artisan.bio}</p></div>}
            {profile.artisan && (profile.artisan.indicativePriceMin !== null || profile.artisan.indicativePriceMax !== null) && <p className="account-price-range"><strong>Tarif indicatif</strong> {profile.artisan.indicativePriceMin ?? "—"} – {profile.artisan.indicativePriceMax ?? "—"} DT</p>}
          </>
        )}
      </section>
      {user.role === "ARTISAN" && <section className="account-security" aria-labelledby="identity-title">
        <h2 id="identity-title">Vérification d’identité</h2>
        {user.mustChangePassword ? <p>Changez d’abord votre mot de passe temporaire.</p> : verificationError && !verification ? <p className="form-error" role="alert">{verificationError}</p> : !verification ? <p role="status">Chargement de votre dossier…</p> : <>
          {verification.status === "VERIFIED" && verification.hasDocument ? <p className="success-message">Identité approuvée. Votre profil peut recevoir des demandes lorsqu’il est disponible.</p> : verification.status === "PENDING" && verification.hasDocument ? <p role="status">Pièce d’identité envoyée. En attente de vérification par l’administration.</p> : <>
            {verification.status === "REJECTED" && <p className="form-error">Vérification refusée{verification.reason ? ` : ${verification.reason}` : "."}</p>}
            <p>Envoyez une pièce d’identité pour que l’administration puisse examiner votre profil avant publication.</p>
            <button className="primary-button" onClick={onOpenVerification}>{verification.status === "REJECTED" ? "Envoyer une nouvelle pièce" : "Envoyer une pièce d’identité"}</button>
          </>}
        </>}
      </section>}
      <details className="account-security" open={user.mustChangePassword || undefined}>
        <summary>Sécurité du compte</summary>
        <p>{user.mustChangePassword ? "Pour des raisons de sécurité, changez votre mot de passe temporaire avant de continuer." : "Choisissez un mot de passe unique d’au moins 12 caractères."}</p>
        <form className="dialog-form" onSubmit={changePassword}>
          <label>Mot de passe actuel<input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>Nouveau mot de passe<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="success-message" role="status">{message}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Modification…" : "Changer le mot de passe"}</button>
        </form>
      </details>
    </section>
  );
}
