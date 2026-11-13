"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AppUser } from "@/components/auth-dialog";

type RequestStatus = "EN_ATTENTE" | "ACCEPTEE" | "EN_COURS" | "TERMINEE" | "REFUSEE" | "ANNULEE";
type QuoteItem = { description: string; amount: number };
type QuoteDraftItem = { description: string; amount: string };
type RequestReview = { rating: number; comment: string; createdAt: string };

type ServiceRequestItem = {
  id: string;
  clientId: string;
  artisanId: string;
  clientName: string;
  artisanName: string;
  category: string;
  description: string;
  address: string;
  location: { latitude: number; longitude: number } | null;
  scheduledAt: string;
  budgetMin: number | null;
  budgetMax: number | null;
  propertyType: string;
  urgency: "NORMALE" | "URGENTE";
  accessDetails: string;
  photos: { id: string; name: string; size: number }[];
  status: RequestStatus;
  announcedPrice: number | null;
  quoteItems: QuoteItem[];
  quoteSentAt: string | null;
  quoteValidUntil: string | null;
  quoteAcceptedAt: string | null;
  review: RequestReview | null;
  hasOpenReport: boolean;
};

const statusLabels: Record<RequestStatus, string> = {
  EN_ATTENTE: "En attente",
  ACCEPTEE: "Acceptée",
  EN_COURS: "En cours",
  TERMINEE: "Terminée",
  REFUSEE: "Refusée",
  ANNULEE: "Annulée",
};

const propertyTypeLabels: Record<string, string> = {
  NON_PRECISE: "Non précisé",
  MAISON: "Maison",
  APPARTEMENT: "Appartement",
  LOCAL_COMMERCIAL: "Local commercial",
  AUTRE: "Autre",
};

function formatRequestDate(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })} · ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

type RequestsPanelProps = { user: AppUser; refreshKey: number; onOpenMessages: (artisanId?: string) => void };

export function RequestsPanel({ user, refreshKey, onOpenMessages }: RequestsPanelProps) {
  const [requests, setRequests] = useState<ServiceRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [quoteTarget, setQuoteTarget] = useState<ServiceRequestItem | null>(null);
  const [quoteItems, setQuoteItems] = useState<QuoteDraftItem[]>([{ description: "", amount: "" }]);
  const [quoteValidDays, setQuoteValidDays] = useState("30");
  const [reviewTarget, setReviewTarget] = useState<ServiceRequestItem | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reportTarget, setReportTarget] = useState<ServiceRequestItem | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [formBusy, setFormBusy] = useState(false);

  const loadRequests = useCallback(async (signal?: AbortSignal, showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError("");
    }
    try {
      const response = await fetch("/api/requests", { signal, cache: "no-store" });
      const result: { requests?: ServiceRequestItem[]; error?: string } = await response.json();
      if (!response.ok || !result.requests) throw new Error(result.error ?? "Impossible de charger les demandes.");
      setRequests(result.requests);
    } catch (loadError) {
      if (signal?.aborted) return;
      console.error("Chargement des demandes impossible :", loadError);
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger les demandes.");
    } finally {
      if (!signal?.aborted && showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void loadRequests(controller.signal), 0);
    const timer = window.setInterval(() => void loadRequests(controller.signal, false), 15_000);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadRequests, refreshKey]);

  async function updateStatus(id: string, status: RequestStatus, quote?: { quoteItems: QuoteItem[]; quoteValidDays: number }) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch("/api/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, ...quote }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible de mettre à jour la demande.");
      await loadRequests();
      return true;
    } catch (updateError) {
      console.error("Mise à jour de la demande impossible :", updateError);
      setError(updateError instanceof Error ? updateError.message : "Impossible de mettre à jour la demande.");
      return false;
    } finally {
      setBusyId("");
    }
  }

  async function acceptQuote(item: ServiceRequestItem) {
    setBusyId(item.id);
    setError("");
    try {
      const response = await fetch("/api/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action: "accept-quote" }),
      });
      const result: { error?: string; quoteAcceptedAt?: string; conversationId?: string; messageId?: string } = await response.json();
      if (!response.ok || !result.quoteAcceptedAt || !result.conversationId || !result.messageId) {
        throw new Error(result.error ?? "Impossible de valider le devis.");
      }
      const quoteAcceptedAt = result.quoteAcceptedAt;
      setRequests((current) => current.map((requestItem) => requestItem.id === item.id
        ? { ...requestItem, quoteAcceptedAt }
        : requestItem));
      setNotice("Devis validé : le PDF a été envoyé dans votre conversation avec l’artisan.");
      onOpenMessages(item.artisanId);
    } catch (acceptError) {
      console.error("Validation du devis impossible :", acceptError);
      setError(acceptError instanceof Error ? acceptError.message : "Impossible de valider le devis.");
    } finally {
      setBusyId("");
    }
  }

  function openQuote(item: ServiceRequestItem) {
    setQuoteTarget(item);
    setQuoteItems([{ description: "", amount: "" }]);
    setQuoteValidDays("30");
    setError("");
  }

  async function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quoteTarget) return;
    const normalizedItems = quoteItems.map((item) => ({
      description: item.description.trim(),
      amount: Number(item.amount),
    }));
    if (quoteItems.some((item) => !item.amount.trim()) ||
        normalizedItems.some((item) => item.description.length < 2 || !Number.isFinite(item.amount) || item.amount < 0)) {
      setError("Renseignez une description et un montant valide pour chaque poste.");
      return;
    }
    const validDays = Number(quoteValidDays);
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 90) {
      setError("La durée de validité doit être comprise entre 1 et 90 jours.");
      return;
    }
    const saved = await updateStatus(quoteTarget.id, "ACCEPTEE", { quoteItems: normalizedItems, quoteValidDays: validDays });
    if (saved) setQuoteTarget(null);
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewTarget) return;
    setFormBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: reviewTarget.id, rating: reviewRating, comment: reviewComment }),
      });
      const result: { error?: string; review?: RequestReview } = await response.json();
      if (!response.ok || !result.review) throw new Error(result.error ?? "Impossible d’envoyer votre avis.");
      setRequests((current) => current.map((item) => item.id === reviewTarget.id ? { ...item, review: { ...result.review!, createdAt: new Date().toISOString() } } : item));
      setReviewTarget(null);
      setReviewComment("");
    } catch (reviewError) {
      console.error("Envoi de l’avis impossible :", reviewError);
      setError(reviewError instanceof Error ? reviewError.message : "Impossible d’envoyer votre avis.");
    } finally {
      setFormBusy(false);
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportTarget) return;
    setFormBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: reportTarget.id, reason: reportReason }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible d’envoyer votre réclamation.");
      setRequests((current) => current.map((item) => item.id === reportTarget.id ? { ...item, hasOpenReport: true } : item));
      setReportTarget(null);
      setReportReason("");
      setNotice("Votre réclamation a été transmise à l’administration.");
    } catch (reportError) {
      console.error("Envoi de la réclamation impossible :", reportError);
      setError(reportError instanceof Error ? reportError.message : "Impossible d’envoyer votre réclamation.");
    } finally {
      setFormBusy(false);
    }
  }

  const quoteTotal = quoteItems.reduce((total, item) => {
    const amount = Number(item.amount);
    return total + (Number.isFinite(amount) && amount >= 0 ? amount : 0);
  }, 0);
  const displayedRequests = user.role === "ARTISAN"
    ? [...requests].sort((left, right) => Number(right.status === "EN_ATTENTE") - Number(left.status === "EN_ATTENTE"))
    : requests;

  return (
    <section className="requests-panel">
      <p className="eyebrow">{user.role === "ARTISAN" ? "ESPACE PROFESSIONNEL" : "VOTRE ESPACE CLIENT"}</p>
      <h1>{user.role === "ARTISAN" ? "Demandes reçues" : "Mes demandes"}</h1>
      <p className="requests-intro">{user.role === "ARTISAN" ? "Consultez les interventions proposées et mettez leur statut à jour." : "Suivez les réponses des artisans et l’avancement de vos interventions."}</p>
      {error && <p className="form-error" role="alert">{error}<button className="text-link" onClick={() => void loadRequests()}>Réessayer</button></p>}
      {notice && <p className="admin-notice" role="status">{notice}</p>}
      {loading ? <p role="status">Chargement des demandes…</p> : requests.length === 0 ? <div className="empty-state"><strong>Aucune demande pour le moment</strong><p>{user.role === "ARTISAN" ? "Les demandes qui vous sont adressées apparaîtront ici." : "Choisissez un artisan pour envoyer votre première demande."}</p></div> : (
        <div className="requests-list">{displayedRequests.map((item) => {
          const hasDetailedQuote = item.quoteItems.length > 0;
          const displayedQuoteItems = hasDetailedQuote
            ? item.quoteItems
            : item.announcedPrice !== null
              ? [{ description: "Montant global annoncé (détail non fourni)", amount: item.announcedPrice }]
              : [];
          const actions: { label: string; status: RequestStatus }[] = user.role === "ARTISAN"
            ? item.status === "EN_ATTENTE" ? [{ label: "Refuser", status: "REFUSEE" }]
              : item.status === "ACCEPTEE" && (!item.quoteItems.length || item.quoteAcceptedAt) ? [{ label: "Démarrer", status: "EN_COURS" }]
                : item.status === "EN_COURS" ? [{ label: "Marquer terminée", status: "TERMINEE" }] : []
            : ["EN_ATTENTE", "ACCEPTEE"].includes(item.status) ? [{ label: "Annuler", status: "ANNULEE" }] : [];

          return (
            <article className={`request-card${user.role === "ARTISAN" ? " artisan-request-card" : ""}${user.role === "ARTISAN" && item.status === "EN_ATTENTE" ? " new-request" : ""}`} key={item.id}>
              <div className="request-card-heading">
                <div className="request-person">
                  {user.role === "ARTISAN" && <span className="request-client-avatar">{item.clientName.slice(0, 1).toUpperCase()}</span>}
                  <div><p className="eyebrow">{item.category}</p><h2>{user.role === "ARTISAN" ? item.clientName : item.artisanName}</h2>{user.role === "ARTISAN" && <small>{item.status === "EN_ATTENTE" ? "Nouvelle demande à traiter" : `Demande ${statusLabels[item.status].toLowerCase()}`}</small>}</div>
                </div>
                <span className={`request-status status-${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span>
              </div>
              <p className="request-description">{item.description}</p>
              <dl>
                <div><dt>Intervention</dt><dd>{formatRequestDate(item.scheduledAt)}</dd></div>
                <div><dt>Adresse</dt><dd>{item.address}{item.location && <> · <a href={`https://www.openstreetmap.org/?mlat=${item.location.latitude}&mlon=${item.location.longitude}#map=16/${item.location.latitude}/${item.location.longitude}`} target="_blank" rel="noreferrer">Voir la carte</a></>}</dd></div>
                <div><dt>Lieu</dt><dd>{propertyTypeLabels[item.propertyType] ?? item.propertyType}</dd></div>
                <div><dt>Urgence</dt><dd>{item.urgency === "URGENTE" ? "Urgente" : "Normale"}</dd></div>
                {(item.budgetMin !== null || item.budgetMax !== null) && <div><dt>Budget indicatif</dt><dd>{item.budgetMin ?? "—"} – {item.budgetMax ?? "—"} DT</dd></div>}
                {item.accessDetails && <div><dt>Accès</dt><dd>{item.accessDetails}</dd></div>}
              </dl>
              {item.photos.length > 0 && <div className="request-photos"><strong>Photos jointes</strong>{item.photos.map((photo) => <a key={photo.id} href={`/api/requests/attachments?requestId=${encodeURIComponent(item.id)}&fileId=${encodeURIComponent(photo.id)}`} target="_blank" rel="noreferrer">{photo.name}</a>)}</div>}
              {displayedQuoteItems.length > 0 && <section className="request-quote" aria-label="Devis de l’artisan">
                <div className="request-quote-heading"><div><span className="eyebrow">{user.role === "ARTISAN" ? "DEVIS ENVOYÉ" : "DEVIS DE L’ARTISAN"}</span><strong>Proposition de prix</strong></div><span>{item.quoteSentAt ? new Date(item.quoteSentAt).toLocaleDateString("fr-FR") : ""}</span></div>
                {!hasDetailedQuote && <p className="quote-help-text">Cette demande a uniquement conservé le montant global annoncé par l’artisan ; le détail par poste n’est pas disponible.</p>}
                {user.role === "CLIENT" && hasDetailedQuote && !item.quoteAcceptedAt && <p className="quote-help-text">Le devis est également disponible dans votre conversation avec l’artisan.</p>}
                <ul>{displayedQuoteItems.map((line, index) => <li key={`${line.description}-${index}`}><span>{line.description}</span><strong>{line.amount.toFixed(2)} DT</strong></li>)}</ul>
                <div className="request-quote-total"><span>Total proposé</span><strong>{(item.announcedPrice ?? 0).toFixed(2)} DT</strong></div>
                {item.quoteValidUntil && <small>Valable jusqu’au {new Date(item.quoteValidUntil).toLocaleDateString("fr-FR")}</small>}
                {item.quoteAcceptedAt && <p className="quote-accepted-label">Devis validé le {new Date(item.quoteAcceptedAt).toLocaleDateString("fr-FR")}</p>}
                {user.role === "ARTISAN" && item.status === "ACCEPTEE" && !item.quoteAcceptedAt && <p className="quote-accepted-label">En attente de la validation du client.</p>}
              </section>}
              {user.role === "CLIENT" && item.review && <div className="request-review-status"><span aria-label={`${item.review.rating} étoiles sur 5`}>{"★".repeat(item.review.rating)}{"☆".repeat(5 - item.review.rating)}</span><strong>Votre avis a été envoyé</strong>{item.review.comment && <p>{item.review.comment}</p>}</div>}
              <div className="request-actions">
                <button className="secondary-button" onClick={() => onOpenMessages(user.role === "CLIENT" ? item.artisanId : undefined)}>Messages</button>
                {(item.quoteItems.length > 0 || item.announcedPrice !== null) && <a className="secondary-button quote-pdf-download" href={`/api/requests/quote-pdf?requestId=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer">Voir le devis (PDF)</a>}
                {user.role === "CLIENT" && item.status === "TERMINEE" && !item.review && <button className="secondary-button" onClick={() => { setReviewTarget(item); setReviewRating(5); setReviewComment(""); setError(""); }}>Noter l’artisan</button>}
                {user.role === "CLIENT" && item.quoteItems.length > 0 && (item.status === "ACCEPTEE" || Boolean(item.quoteAcceptedAt)) && <button className="primary-button" disabled={busyId === item.id || (!item.quoteAcceptedAt && Boolean(item.quoteValidUntil && new Date(item.quoteValidUntil) <= new Date()))} onClick={() => void acceptQuote(item)}>{busyId === item.id ? "Validation…" : item.quoteAcceptedAt ? "Ouvrir le PDF dans la discussion" : item.quoteValidUntil && new Date(item.quoteValidUntil) <= new Date() ? "Devis expiré" : "Valider le devis"}</button>}
                {user.role === "CLIENT" && !item.hasOpenReport && <button className="secondary-button report-request-button" onClick={() => { setReportTarget(item); setReportReason(""); setError(""); }}>Signaler un problème</button>}
                {user.role === "CLIENT" && item.hasOpenReport && <span className="report-sent-label">Réclamation transmise</span>}
                {user.role === "ARTISAN" && item.status === "EN_ATTENTE" && <button className="primary-button" disabled={busyId === item.id} onClick={() => openQuote(item)}>Établir le devis et accepter</button>}
                {actions.map((action) => <button key={action.status} className={action.status === "REFUSEE" || action.status === "ANNULEE" ? "secondary-button" : "primary-button"} disabled={busyId === item.id} onClick={() => void updateStatus(item.id, action.status)}>{busyId === item.id ? "Patientez…" : action.label}</button>)}
              </div>
            </article>
          );
        })}</div>
      )}
      {quoteTarget && <div className="modal-backdrop quote-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) setQuoteTarget(null); }}>
        <section className="artisan-modal quote-modal" role="dialog" aria-modal="true" aria-labelledby="quote-title">
          <button className="modal-close" type="button" onClick={() => setQuoteTarget(null)} aria-label="Fermer" disabled={Boolean(busyId)}>×</button>
          <p className="eyebrow">ACCEPTER LA DEMANDE</p>
          <h2 id="quote-title">Préparer le devis</h2>
          <p className="modal-description">Le devis sera joint à votre réponse et visible par {quoteTarget.clientName} dans sa demande.</p>
          <form className="dialog-form quote-form" onSubmit={(event) => void submitQuote(event)}>
            <div className="quote-lines-heading"><strong>Prestations et frais</strong><button className="text-link" type="button" disabled={quoteItems.length >= 20} onClick={() => setQuoteItems((items) => [...items, { description: "", amount: "" }])}>+ Ajouter une ligne</button></div>
            {quoteItems.map((line, index) => <div className="quote-line" key={index}>
              <label>Prestation<input required minLength={2} maxLength={200} value={line.description} onChange={(event) => setQuoteItems((items) => items.map((item, lineIndex) => lineIndex === index ? { ...item, description: event.target.value } : item))} placeholder="Ex. Main-d’œuvre, déplacement…" /></label>
              <label>Montant (DT)<input required type="number" min="0" max="1000000" step="0.01" value={line.amount} onChange={(event) => setQuoteItems((items) => items.map((item, lineIndex) => lineIndex === index ? { ...item, amount: event.target.value } : item))} /></label>
              {quoteItems.length > 1 && <button className="quote-remove-line" type="button" onClick={() => setQuoteItems((items) => items.filter((_, lineIndex) => lineIndex !== index))} aria-label={`Supprimer la ligne ${index + 1}`}>×</button>}
            </div>)}
            <div className="quote-total-preview"><span>Total du devis</span><strong>{quoteTotal.toFixed(2)} DT</strong></div>
            <label>Validité du devis (jours)<input type="number" min="1" max="90" step="1" required value={quoteValidDays} onChange={(event) => setQuoteValidDays(event.target.value)} /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={Boolean(busyId)}>{busyId ? "Envoi du devis…" : "Envoyer le devis et accepter"}</button>
          </form>
        </section>
      </div>}
      {reviewTarget && <div className="modal-backdrop quote-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !formBusy) setReviewTarget(null); }}>
        <section className="artisan-modal quote-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
          <button className="modal-close" type="button" onClick={() => setReviewTarget(null)} aria-label="Fermer" disabled={formBusy}>×</button>
          <p className="eyebrow">INTERVENTION TERMINÉE</p>
          <h2 id="review-title">Évaluer {reviewTarget.artisanName}</h2>
          <form className="dialog-form quote-form" onSubmit={(event) => void submitReview(event)}>
            <fieldset className="review-rating-picker"><legend>Votre note</legend><div>{[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" className={rating <= reviewRating ? "selected" : ""} onClick={() => setReviewRating(rating)} aria-label={`${rating} étoile${rating > 1 ? "s" : ""}`} aria-pressed={reviewRating === rating}>★</button>)}</div><span>{reviewRating} / 5</span></fieldset>
            <label>Commentaire (facultatif)<textarea maxLength={1200} rows={4} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="Partagez votre expérience avec cet artisan." /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={formBusy}>{formBusy ? "Envoi…" : "Envoyer mon avis"}</button>
          </form>
        </section>
      </div>}
      {reportTarget && <div className="modal-backdrop quote-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !formBusy) setReportTarget(null); }}>
        <section className="artisan-modal quote-modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
          <button className="modal-close" type="button" onClick={() => setReportTarget(null)} aria-label="Fermer" disabled={formBusy}>×</button>
          <p className="eyebrow">CONTACTER L’ADMINISTRATION</p>
          <h2 id="report-title">Envoyer une réclamation</h2>
          <p className="modal-description">Décrivez le problème lié à votre demande. Votre message sera examiné par l’administration.</p>
          <form className="dialog-form quote-form" onSubmit={(event) => void submitReport(event)}>
            <label>Votre réclamation<textarea required minLength={10} maxLength={1200} rows={5} value={reportReason} onChange={(event) => setReportReason(event.target.value)} placeholder="Expliquez la situation (10 caractères minimum)." /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={formBusy}>{formBusy ? "Envoi…" : "Envoyer à l’administration"}</button>
          </form>
        </section>
      </div>}
    </section>
  );
}
