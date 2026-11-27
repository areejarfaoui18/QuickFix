"use client";

import { useState, type FormEvent } from "react";
import { tunisianCities } from "@/lib/cities";

export type AppUser = {
  id: string;
  name: string;
  role: "CLIENT" | "ARTISAN" | "ADMIN";
  mustChangePassword: boolean;
};

type AuthDialogProps = {
  initialMode: "login" | "register";
  onClose: () => void;
  onSuccess: (user: AppUser, registered?: boolean) => void;
};

export function AuthDialog({ initialMode, onClose, onSuccess }: AuthDialogProps) {
  const [mode, setMode] = useState<"login" | "register" | "forgot-password">(initialMode);
  const [accountRole, setAccountRole] = useState<"CLIENT" | "ARTISAN" | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode === "register" && !accountRole) {
      setError("Choisissez Client ou Artisan pour continuer.");
      return;
    }
    setSubmitting(true);

    try {
      const response = await fetch(`/api/auth/${mode === "register" ? "register" : mode === "login" ? "login" : "forgot-password"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "register"
          ? { name, phone, email, password, role: accountRole, category, city, bio }
          : mode === "login" ? { email, password } : { email }),
      });
      const result: { user?: AppUser; message?: string; error?: string } = await response.json();
      if (mode === "forgot-password") {
        if (!response.ok || !result.message) {
          setError(result.error ?? "Impossible de traiter la demande.");
          return;
        }
        setNotice(result.message);
        return;
      }
      if (!response.ok || !result.user) {
        setError(result.error ?? "Impossible de traiter la demande.");
        return;
      }
      onSuccess(result.user, mode === "register");
    } catch (submitError) {
      console.error("Authentification impossible :", submitError);
      setError("Le service est momentanément indisponible. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`artisan-modal auth-modal ${mode === "register" ? "auth-register-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" onClick={onClose} aria-label="Fermer">×</button>
        <p className="eyebrow">VOTRE ESPACE QUICKFIX</p>
        <h2 id="auth-title">{mode === "register" ? "Créer un compte" : mode === "forgot-password" ? "Mot de passe oublié" : "Connexion"}</h2>
        <p className="modal-description">{mode === "register" ? "Choisissez votre espace pour créer un compte adapté à vos besoins." : mode === "forgot-password" ? "Saisissez votre adresse e-mail pour recevoir un lien de réinitialisation." : "Connectez-vous pour retrouver votre espace QuickFix."}</p>
        <form className="dialog-form" onSubmit={submit}>
          {mode === "register" && (
            <fieldset className="account-role-picker">
              <legend>Quel espace souhaitez-vous rejoindre ?</legend>
              <button type="button" className={accountRole === "CLIENT" ? "account-role-option active" : "account-role-option"} aria-pressed={accountRole === "CLIENT"} onClick={() => setAccountRole("CLIENT")}>
                <span className="account-role-icon" aria-hidden="true">⌂</span>
                <span className="account-role-copy"><strong>Client</strong><small>Je cherche un professionnel</small></span>
                <span className="account-role-check" aria-hidden="true">{accountRole === "CLIENT" ? "✓" : ""}</span>
              </button>
              <button type="button" className={accountRole === "ARTISAN" ? "account-role-option active" : "account-role-option"} aria-pressed={accountRole === "ARTISAN"} onClick={() => setAccountRole("ARTISAN")}>
                <span className="account-role-icon" aria-hidden="true">✦</span>
                <span className="account-role-copy"><strong>Artisan</strong><small>Je propose mes services</small></span>
                <span className="account-role-check" aria-hidden="true">{accountRole === "ARTISAN" ? "✓" : ""}</span>
              </button>
            </fieldset>
          )}
          {mode === "register" && accountRole && <>
            <label>Nom complet<input autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>Téléphone {accountRole === "ARTISAN" ? "" : "(facultatif)"}<input autoComplete="tel" required={accountRole === "ARTISAN"} minLength={accountRole === "ARTISAN" ? 6 : undefined} maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            {accountRole === "ARTISAN" && <>
              <label>Filière
                <select required value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">Choisir une filière</option>
                  {["Plomberie", "Électricité", "Climatisation", "Peinture", "Ménage", "Serrurerie"].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>Ville<select required value={city} onChange={(event) => setCity(event.target.value)}><option value="" disabled>Choisir une ville</option>{tunisianCities.map((cityName) => <option key={cityName} value={cityName}>{cityName}</option>)}</select></label>
              <label>Présentation (facultative)<textarea rows={3} maxLength={1200} value={bio} onChange={(event) => setBio(event.target.value)} /></label>
            </>}
          </>}
          {(mode === "login" || mode === "forgot-password" || accountRole) && <>
            <label>Adresse e-mail<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            {mode !== "forgot-password" && <label>Mot de passe<input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={mode === "register" ? 12 : undefined} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          </>}
          {mode === "register" && accountRole && <small className="form-hint">{accountRole === "ARTISAN" ? "Votre compte sera créé immédiatement. Envoyez ensuite votre pièce d’identité dans votre profil pour demander la vérification." : "Votre compte client sera prêt immédiatement."} Le mot de passe doit contenir au moins 12 caractères.</small>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="form-hint" role="status">{notice}</p>}
          <button className="primary-button" type="submit" disabled={submitting || (mode === "register" && !accountRole)}>{submitting ? "Patientez…" : mode === "register" ? "Créer mon compte" : mode === "forgot-password" ? "Envoyer le lien" : "Se connecter"}</button>
        </form>
        {mode === "forgot-password" ? (
          <button className="auth-switch" onClick={() => { setError(""); setNotice(""); setMode("login"); }}>Retour à la connexion</button>
        ) : <>
          {mode === "login" && <button className="auth-switch" onClick={() => { setError(""); setNotice(""); setMode("forgot-password"); }}>Mot de passe oublié ?</button>}
          <button className="auth-switch" onClick={() => { setError(""); setNotice(""); setMode(mode === "register" ? "login" : "register"); }}>
            {mode === "register" ? "Déjà un compte ? Se connecter" : "Pas encore de compte ? S’inscrire"}
          </button>
        </>}
      </section>
    </div>
  );
}
