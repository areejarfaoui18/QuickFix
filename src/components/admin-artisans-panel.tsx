"use client";

import { useEffect, useState } from "react";
import { AdminArtisanManagement } from "@/components/admin-artisan-management";

type PendingArtisan = {
  id: string;
  name: string;
  email: string;
  phone: string;
  isSuspended: boolean;
  suspensionReason?: string;
  category: string;
  city: string;
  bio: string;
  indicativePriceMin: number | null;
  indicativePriceMax: number | null;
  hasIdentityDocument: boolean;
  createdAt: string;
};

type AdminReview = {
  id: string;
  requestId: string;
  clientName: string;
  artisanName: string;
  rating: number;
  comment: string;
  isHidden: boolean;
  createdAt: string;
  category: string;
};

type AdminReport = {
  id: string;
  requestId: string;
  reporterName: string;
  reporterEmail: string;
  reporterPhone: string;
  reason: string;
  status: "OUVERT" | "EN_COURS" | "RESOLU";
  resolutionNote: string;
  createdAt: string;
  category: string;
  requestStatus: string;
  requestDescription: string;
};

export type AdminPage = "verification" | "management" | "reviews" | "reports";

export function AdminArtisansPanel({ page, onOpenMessages }: { page: AdminPage; onOpenMessages: (artisanId?: string) => void }) {
  const [artisans, setArtisans] = useState<PendingArtisan[]>([]);
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [moderationLoadedKey, setModerationLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/artisans", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result: { artisans?: PendingArtisan[]; error?: string } = await response.json();
        if (!response.ok || !result.artisans) throw new Error(result.error ?? "Impossible de charger les profils.");
        setArtisans(result.artisans);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Chargement des profils à vérifier impossible :", loadError);
        setError(loadError instanceof Error ? loadError.message : "Impossible de charger les profils.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    if (page !== "reviews" && page !== "reports") return;
    const controller = new AbortController();
    fetch("/api/admin/moderation", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result: { reviews?: AdminReview[]; reports?: AdminReport[]; error?: string } = await response.json();
        if (!response.ok || !result.reviews || !result.reports) throw new Error(result.error ?? "Impossible de charger la modération.");
        setReviews(result.reviews);
        setReports(result.reports);
        setModerationLoadedKey(`${page}:${reloadKey}`);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Chargement de la modération impossible :", loadError);
        setError(loadError instanceof Error ? loadError.message : "Impossible de charger la modération.");
        setModerationLoadedKey(`${page}:${reloadKey}`);
      });
    return () => controller.abort();
  }, [page, reloadKey]);
  const moderationLoading = (page === "reviews" || page === "reports") &&
    moderationLoadedKey !== `${page}:${reloadKey}`;

  async function decide(profileId: string, status: "VERIFIED" | "REJECTED") {
    const reason = reasons[profileId]?.trim() ?? "";
    if (status === "REJECTED" && reason.length < 5) {
      setError("Pour refuser un profil, indiquez un motif d’au moins 5 caractères.");
      return;
    }

    setBusyId(profileId);
    setError("");
    try {
      const response = await fetch("/api/admin/artisans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, status, reason }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible d’enregistrer la décision.");
      setArtisans((current) => current.filter((artisan) => artisan.id !== profileId));
      setReasons((current) => {
        const next = { ...current };
        delete next[profileId];
        return next;
      });
    } catch (decisionError) {
      console.error("Décision de vérification impossible :", decisionError);
      setError(decisionError instanceof Error ? decisionError.message : "Impossible d’enregistrer la décision.");
    } finally {
      setBusyId("");
    }
  }

  async function moderate(body: { id: string; action: "resolve-report"; note: string } | { id: string; action: "set-review-visibility"; isHidden: boolean }) {
    setBusyId(body.id);
    setError("");
    try {
      const response = await fetch("/api/admin/moderation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible d’enregistrer cette décision.");
      if (body.action === "resolve-report") {
        setReports((current) => current.map((report) => report.id === body.id ? { ...report, status: "RESOLU", resolutionNote: body.note.trim() } : report));
      } else {
        setReviews((current) => current.map((review) => review.id === body.id ? { ...review, isHidden: body.isHidden } : review));
      }
    } catch (moderationError) {
      console.error("Mise à jour de la modération impossible :", moderationError);
      setError(moderationError instanceof Error ? moderationError.message : "Impossible d’enregistrer cette décision.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="admin-panel">
      <p className="eyebrow">ESPACE SÉCURISÉ</p>
      {page === "management" ? <AdminArtisanManagement onMessage={(artisanId) => onOpenMessages(artisanId)} /> : page === "reviews" ? <>
        <div className="admin-heading"><div><h1>Avis des clients</h1><p>Consultez les évaluations reçues après les demandes terminées.</p></div><span className="admin-count">{reviews.length} avis</span></div>
        {error && <p className="form-error" role="alert">{error}<button className="text-link" onClick={() => setReloadKey((key) => key + 1)}>Réessayer</button></p>}
        {moderationLoading ? <p role="status">Chargement des avis…</p> : reviews.length === 0 ? <div className="empty-state"><strong>Aucun avis pour le moment</strong><p>Les avis envoyés après les interventions apparaîtront ici.</p></div> : <div className="admin-artisan-list">
          {reviews.map((review) => <article className="admin-artisan-card" key={review.id}>
            <div className="admin-artisan-top"><div><p className="eyebrow">{review.category || "Demande"} · {new Date(review.createdAt).toLocaleDateString("fr-FR")}</p><h2>{review.artisanName}</h2></div><span className={`admin-account-state${review.isHidden ? " suspended" : ""}`}>{review.isHidden ? "Masqué" : "Publié"}</span></div>
            <p className="admin-review-rating" aria-label={`${review.rating} étoiles sur 5`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)} <span>{review.rating}/5</span></p>
            <p className="admin-bio"><strong>Client : </strong>{review.clientName}{review.comment && <><br /><strong>Commentaire : </strong>{review.comment}</>}</p>
            <div className="request-actions"><button className="secondary-button" disabled={Boolean(busyId)} onClick={() => void moderate({ id: review.id, action: "set-review-visibility", isHidden: !review.isHidden })}>{busyId === review.id ? "Enregistrement…" : review.isHidden ? "Publier l’avis" : "Masquer l’avis"}</button></div>
          </article>)}
        </div>}
      </> : page === "reports" ? <>
        <div className="admin-heading"><div><h1>Réclamations clients</h1><p>Consultez les problèmes signalés et consignez leur résolution.</p></div><span className="admin-count">{reports.filter((report) => report.status !== "RESOLU").length} à traiter</span></div>
        {error && <p className="form-error" role="alert">{error}<button className="text-link" onClick={() => setReloadKey((key) => key + 1)}>Réessayer</button></p>}
        {moderationLoading ? <p role="status">Chargement des réclamations…</p> : reports.length === 0 ? <div className="empty-state"><strong>Aucune réclamation</strong><p>Les réclamations envoyées par les clients apparaîtront ici.</p></div> : <div className="admin-artisan-list">
          {reports.map((report) => <article className="admin-artisan-card" key={report.id}>
            <div className="admin-artisan-top"><div><p className="eyebrow">{report.category || "Demande"} · {new Date(report.createdAt).toLocaleDateString("fr-FR")}</p><h2>{report.reporterName}</h2></div><span className={`admin-account-state${report.status === "RESOLU" ? "" : " suspended"}`}>{report.status === "RESOLU" ? "Résolue" : report.status === "EN_COURS" ? "En cours" : "Ouverte"}</span></div>
            <dl className="admin-artisan-details"><div><dt>E-mail</dt><dd>{report.reporterEmail}</dd></div>{report.reporterPhone && <div><dt>Téléphone</dt><dd>{report.reporterPhone}</dd></div>}<div><dt>Demande</dt><dd>{report.requestStatus} · {report.requestDescription || "Demande supprimée"}</dd></div></dl>
            <p className="admin-bio"><strong>Motif : </strong>{report.reason}</p>
            {report.status === "RESOLU" ? <p className="admin-notice">Résolution : {report.resolutionNote}</p> : <><label className="admin-reason">Note de résolution<textarea minLength={2} maxLength={1000} rows={2} value={resolutionNotes[report.id] ?? ""} onChange={(event) => setResolutionNotes((current) => ({ ...current, [report.id]: event.target.value }))} /></label><div className="request-actions"><button className="primary-button" disabled={Boolean(busyId)} onClick={() => void moderate({ id: report.id, action: "resolve-report", note: resolutionNotes[report.id] ?? "" })}>{busyId === report.id ? "Enregistrement…" : "Marquer comme résolue"}</button></div></>}
          </article>)}
        </div>}
      </> : <>
      <div className="admin-heading"><div><h1>Vérification des artisans</h1><p>Contrôlez les informations avant publication du profil.</p></div><span className="admin-count">{artisans.length} en attente</span></div>
      {error && <div className="form-error" role="alert">{error} <button className="text-link" onClick={() => setReloadKey((key) => key + 1)}>Réessayer</button></div>}
      {loading ? <p role="status">Chargement des dossiers…</p> : artisans.length === 0 ? <div className="empty-state"><strong>Aucun profil en attente</strong><p>Les nouveaux profils artisans apparaîtront ici.</p></div> : (
        <div className="admin-artisan-list">
          {artisans.map((artisan) => (
            <article className="admin-artisan-card" key={artisan.id}>
              <div className="admin-artisan-top"><div><p className="eyebrow">{artisan.category} · {artisan.city}</p><h2>{artisan.name}</h2></div><span className={`admin-account-state ${artisan.isSuspended ? "suspended" : ""}`}>{artisan.suspensionReason === "Attente de validation administrative" ? "En attente admin" : artisan.isSuspended ? "Compte suspendu" : "À vérifier"}</span></div>
              <dl className="admin-artisan-details">
                <div><dt>E-mail</dt><dd>{artisan.email}</dd></div>
                {artisan.phone && <div><dt>Téléphone</dt><dd>{artisan.phone}</dd></div>}
                <div><dt>Inscription</dt><dd>{new Date(artisan.createdAt).toLocaleDateString("fr-FR")}</dd></div>
                {(artisan.indicativePriceMin !== null || artisan.indicativePriceMax !== null) && <div><dt>Tarif indicatif</dt><dd>{artisan.indicativePriceMin ?? "—"} – {artisan.indicativePriceMax ?? "—"} DT</dd></div>}
              </dl>
              <p className="admin-bio">{artisan.bio || "Aucune présentation renseignée."}</p>
              {artisan.hasIdentityDocument ? <p><a className="text-link" href={`/api/artisan/verification?profileId=${encodeURIComponent(artisan.id)}`}>Télécharger la pièce d’identité</a></p> : <p className="form-hint">Aucune pièce d’identité envoyée.</p>}
              {artisan.isSuspended && artisan.suspensionReason === "Attente de validation administrative" && <p className="form-hint">L’artisan peut se connecter pour envoyer sa pièce d’identité.</p>}
              {artisan.isSuspended && artisan.suspensionReason !== "Attente de validation administrative" && <p className="form-error">Ce compte est suspendu pour une autre raison. Réactivez-le depuis « Gestion des artisans » avant l’approbation.</p>}
              <label className="admin-reason">Motif de refus (obligatoire en cas de refus)
                <textarea maxLength={500} rows={2} value={reasons[artisan.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [artisan.id]: event.target.value }))} />
              </label>
              <div className="request-actions">
                <button className="primary-button" disabled={busyId === artisan.id || !artisan.hasIdentityDocument} onClick={() => void decide(artisan.id, "VERIFIED")}>{busyId === artisan.id ? "Enregistrement…" : "Approuver et publier"}</button>
                <button className="secondary-button" disabled={busyId === artisan.id} onClick={() => void decide(artisan.id, "REJECTED")}>{busyId === artisan.id ? "Enregistrement…" : "Refuser"}</button>
              </div>
            </article>
          ))}
        </div>
      )}
      </>}
    </section>
  );
}
