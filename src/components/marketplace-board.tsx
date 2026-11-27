"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AppUser } from "@/components/auth-dialog";
import { tunisianCities } from "@/lib/cities";
import { calculateCommissionCents, MARKETPLACE_CATEGORIES, MARKETPLACE_COMMISSION_PERCENT } from "@/lib/marketplace";

type JobStatus = "OPEN" | "ASSIGNED" | "CANCELLED";
type ProposalStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";
type JobItem = {
  id: string;
  title: string;
  category: string;
  city: string;
  description: string;
  scheduledAt: string;
  budgetMin: number | null;
  budgetMax: number | null;
  status: JobStatus;
  proposalCount?: number;
  myProposal?: { status: ProposalStatus; totalCents: number; commissionCents: number; validUntil: string } | null;
};
type ProposalItem = {
  id: string;
  artisanName: string;
  city: string;
  rating: number | null;
  reviews: number;
  message: string;
  items: { description: string; amountCents: number }[];
  totalCents: number;
  validUntil: string;
  status: ProposalStatus;
};
type QuoteDraft = { description: string; amount: string };

const jobLabels: Record<JobStatus, string> = { OPEN: "Ouverte", ASSIGNED: "Attribuée", CANCELLED: "Annulée" };
const proposalLabels: Record<ProposalStatus, string> = { PENDING: "En attente", ACCEPTED: "Retenue", DECLINED: "Non retenue", WITHDRAWN: "Retirée" };

function formatMoney(cents: number) {
  return `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DT`;
}

function localDateTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function MarketplaceBoard({ user, onOpenRequests }: { user: AppUser; onOpenRequests: () => void }) {
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [eligible, setEligible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [showPostForm, setShowPostForm] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState("");
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState("");
  const [proposalTarget, setProposalTarget] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<QuoteDraft[]>([{ description: "", amount: "" }]);
  const [validDays, setValidDays] = useState("30");
  const [busy, setBusy] = useState("");
  const [confirmProposal, setConfirmProposal] = useState("");
  const [confirmCancel, setConfirmCancel] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/jobs", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result: { jobs?: JobItem[]; eligible?: boolean; error?: string } = await response.json();
        if (!response.ok || !result.jobs) throw new Error(result.error ?? "Impossible de charger les missions.");
        setJobs(result.jobs);
        setEligible(result.eligible !== false);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Impossible de charger les missions.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadKey]);

  function reload() {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  async function publishJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const budgetMin = String(form.get("budgetMin") ?? "");
    const budgetMax = String(form.get("budgetMax") ?? "");
    setBusy("post");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"), category: form.get("category"), city: form.get("city"),
          description: form.get("description"), address: form.get("address"),
          scheduledAt: new Date(String(form.get("scheduledAt"))).toISOString(),
          budgetMin: budgetMin === "" ? null : Number(budgetMin), budgetMax: budgetMax === "" ? null : Number(budgetMax),
        }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible de publier la mission.");
      setShowPostForm(false);
      setNotice("Votre mission a été publiée.");
      reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Impossible de publier la mission.");
    } finally { setBusy(""); }
  }

  async function loadProposals(jobId: string) {
    if (expandedJobId === jobId) { setExpandedJobId(""); return; }
    setExpandedJobId(jobId);
    setProposals([]);
    setProposalLoading(true);
    setProposalError("");
    setError("");
    try {
      const response = await fetch(`/api/job-proposals?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const result: { proposals?: ProposalItem[]; error?: string } = await response.json();
      if (!response.ok || !result.proposals) throw new Error(result.error ?? "Impossible de charger les propositions.");
      setProposals(result.proposals);
    } catch (loadError) {
      setProposalError(loadError instanceof Error ? loadError.message : "Impossible de charger les propositions.");
    } finally { setProposalLoading(false); }
  }

  async function submitProposal(event: FormEvent<HTMLFormElement>, jobId: string) {
    event.preventDefault();
    const normalized = items.map((item) => ({ description: item.description.trim(), amountCents: Math.round(Number(item.amount) * 100) }));
    if (items.some((item) => !item.amount.trim()) || normalized.some((item) => item.description.length < 2 || !Number.isSafeInteger(item.amountCents) || item.amountCents < 0)) {
      setError("Vérifiez la description et le montant de chaque poste.");
      return;
    }
    setBusy(jobId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/job-proposals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, message, items: normalized, validDays: Number(validDays) }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible d’envoyer la proposition.");
      setProposalTarget("");
      setMessage("");
      setItems([{ description: "", amount: "" }]);
      setValidDays("30");
      setNotice("Votre proposition a été envoyée.");
      reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Impossible d’envoyer la proposition.");
    } finally { setBusy(""); }
  }

  async function chooseProposal(jobId: string, proposalId: string) {
    setBusy(proposalId);
    setError("");
    try {
      const response = await fetch("/api/job-proposals", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, proposalId }),
      });
      const result: { error?: string; serviceRequestId?: string } = await response.json();
      if (!response.ok || !result.serviceRequestId) throw new Error(result.error ?? "Impossible de choisir cette proposition.");
      onOpenRequests();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Impossible de choisir cette proposition.");
      setConfirmProposal("");
    } finally { setBusy(""); }
  }

  async function cancelJob(jobId: string) {
    setBusy(jobId);
    setError("");
    try {
      const response = await fetch("/api/jobs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: jobId }) });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible d’annuler la mission.");
      setConfirmCancel("");
      setExpandedJobId("");
      setNotice("La mission a été annulée.");
      reload();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Impossible d’annuler la mission.");
    } finally { setBusy(""); }
  }

  const totalCents = items.reduce((total, item) => {
    const amount = Number(item.amount);
    return total + (Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0);
  }, 0);
  const commissionCents = calculateCommissionCents(totalCents);

  return (
    <section className="marketplace-board">
      <header className="marketplace-header">
        <div><p className="eyebrow">{user.role === "CLIENT" ? "VOTRE ESPACE CLIENT" : "ESPACE PROFESSIONNEL"}</p><h1>{user.role === "CLIENT" ? "Mes missions" : "Missions disponibles"}</h1></div>
        {user.role === "CLIENT" && <button className="primary-button" onClick={() => { setShowPostForm(!showPostForm); setError(""); }}>{showPostForm ? "Fermer" : "Publier une mission"}</button>}
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="admin-notice" role="status">{notice}</p>}

      {showPostForm && user.role === "CLIENT" && <form className="dialog-form marketplace-form" onSubmit={publishJob}>
        <h2>Nouvelle mission</h2>
        <label>Titre<input name="title" required minLength={5} maxLength={120} /></label>
        <label>Catégorie<select name="category" required defaultValue=""><option value="" disabled>Choisir une catégorie</option>{MARKETPLACE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <label>Description<textarea name="description" required minLength={20} maxLength={2000} rows={4} /><small>La description est visible par les artisans. N’y indiquez pas votre adresse ou vos coordonnées.</small></label>
        <div className="request-form-row"><label>Ville<select name="city" required defaultValue=""><option value="" disabled>Choisir une ville</option>{tunisianCities.map((cityName) => <option key={cityName} value={cityName}>{cityName}</option>)}</select></label><label>Date souhaitée<input name="scheduledAt" type="datetime-local" required min={localDateTime(new Date(now))} defaultValue={localDateTime(new Date(now + 86400000))} /></label></div>
        <label>Adresse d’intervention<input name="address" required maxLength={300} autoComplete="street-address" /><small>Partagée uniquement avec l’artisan choisi.</small></label>
        <div className="request-form-row"><label>Budget minimum (DT)<input name="budgetMin" type="number" min="0" max="1000000" step="0.01" /></label><label>Budget maximum (DT)<input name="budgetMax" type="number" min="0" max="1000000" step="0.01" /></label></div>
        <button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === "post" ? "Publication…" : "Publier la mission"}</button>
      </form>}

      {!loading && !eligible && user.role === "ARTISAN" && <p className="admin-notice">Votre profil doit être vérifié et disponible pour proposer un devis.</p>}
      {loading ? <p role="status">Chargement des missions…</p> : jobs.length === 0 ? <div className="empty-state"><strong>{user.role === "CLIENT" ? "Aucune mission publiée" : "Aucune mission pour votre spécialité"}</strong><p>{user.role === "CLIENT" ? "Publiez une mission pour recevoir des propositions d’artisans." : "Les nouvelles missions correspondant à votre spécialité apparaîtront ici."}</p></div> : <div className="marketplace-list">{jobs.map((job) => <article className="marketplace-job" key={job.id}>
        <div className="marketplace-job-heading"><div><p className="eyebrow">{job.category} · {job.city}</p><h2>{job.title}</h2></div><span className={`marketplace-status marketplace-status-${job.status.toLowerCase()}`}>{jobLabels[job.status]}</span></div>
        <p className="marketplace-description">{job.description}</p>
        <dl className="marketplace-details"><div><dt>Intervention</dt><dd>{new Date(job.scheduledAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</dd></div>{(job.budgetMin !== null || job.budgetMax !== null) && <div><dt>Budget indicatif</dt><dd>{job.budgetMin ?? "—"} – {job.budgetMax ?? "—"} DT</dd></div>}{user.role === "CLIENT" && <div><dt>Propositions</dt><dd>{job.proposalCount ?? 0}</dd></div>}</dl>
        {user.role === "CLIENT" && <>
          <div className="request-actions"><button className="secondary-button" disabled={proposalLoading} onClick={() => void loadProposals(job.id)}>{expandedJobId === job.id ? "Masquer les propositions" : "Voir les propositions"}</button>{job.status === "OPEN" && (confirmCancel === job.id ? <><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void cancelJob(job.id)}>Confirmer l’annulation</button><button className="text-link" onClick={() => setConfirmCancel("")}>Retour</button></> : <button className="secondary-button" onClick={() => setConfirmCancel(job.id)}>Annuler la mission</button>)}</div>
          {expandedJobId === job.id && <div className="marketplace-proposals">{proposalLoading ? <p role="status">Chargement des propositions…</p> : proposalError ? <p className="form-error" role="alert">{proposalError}</p> : proposals.length === 0 ? <p>Aucune proposition pour le moment.</p> : proposals.map((proposal) => <section className="marketplace-proposal" key={proposal.id}>
            <div className="marketplace-proposal-heading"><div><strong>{proposal.artisanName}</strong><small>{proposal.city}{proposal.rating !== null ? ` · ${proposal.rating.toFixed(1)}/5 (${proposal.reviews} avis)` : " · Nouvel artisan"}</small></div><span className="marketplace-status">{proposalLabels[proposal.status]}</span></div>
            <p>{proposal.message}</p><ul>{proposal.items.map((item, index) => <li key={`${proposal.id}-${index}`}><span>{item.description}</span><strong>{formatMoney(item.amountCents)}</strong></li>)}</ul>
            <div className="marketplace-proposal-total"><span>Total proposé</span><strong>{formatMoney(proposal.totalCents)}</strong></div><small>Valable jusqu’au {new Date(proposal.validUntil).toLocaleDateString("fr-FR")}</small>
            {job.status === "OPEN" && proposal.status === "PENDING" && new Date(proposal.validUntil).getTime() > now && <div className="request-actions">{confirmProposal === proposal.id ? <><button className="primary-button" disabled={Boolean(busy)} onClick={() => void chooseProposal(job.id, proposal.id)}>{busy === proposal.id ? "Attribution…" : "Confirmer ce devis"}</button><button className="secondary-button" onClick={() => setConfirmProposal("")}>Retour</button></> : <button className="primary-button" onClick={() => setConfirmProposal(proposal.id)}>Choisir cet artisan</button>}</div>}
          </section>)}</div>}
        </>}
        {user.role === "ARTISAN" && (job.myProposal ? <div className="marketplace-my-proposal"><strong>Votre proposition : {proposalLabels[job.myProposal.status]}</strong><p>Prix proposé : {formatMoney(job.myProposal.totalCents)} · Commission indicative ({MARKETPLACE_COMMISSION_PERCENT} %) : {formatMoney(job.myProposal.commissionCents)} · Net estimé : {formatMoney(job.myProposal.totalCents - job.myProposal.commissionCents)}</p></div> : eligible && job.status === "OPEN" && (proposalTarget === job.id ? <form className="dialog-form marketplace-quote-form" onSubmit={(event) => void submitProposal(event, job.id)}>
          <h3>Votre proposition</h3><label>Message<textarea required minLength={20} maxLength={1200} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
          <div className="quote-lines-heading"><strong>Postes du devis</strong><button className="text-link" type="button" disabled={items.length >= 20} onClick={() => setItems([...items, { description: "", amount: "" }])}>+ Ajouter une ligne</button></div>
          {items.map((item, index) => <div className="quote-line" key={index}><label>Description<input required minLength={2} maxLength={200} value={item.description} onChange={(event) => setItems(items.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry))} /></label><label>Montant (DT)<input type="number" required min="0" max="1000000" step="0.01" value={item.amount} onChange={(event) => setItems(items.map((entry, entryIndex) => entryIndex === index ? { ...entry, amount: event.target.value } : entry))} /></label><button className="quote-remove-line" type="button" aria-label={`Supprimer le poste ${index + 1}`} disabled={items.length === 1} onClick={() => setItems(items.filter((_, entryIndex) => entryIndex !== index))}>×</button></div>)}
          <label>Validité du devis (jours)<input type="number" required min="1" max="90" value={validDays} onChange={(event) => setValidDays(event.target.value)} /></label>
          <div className="marketplace-fees"><span>Total : {formatMoney(totalCents)}</span><span>Commission indicative ({MARKETPLACE_COMMISSION_PERCENT} %) : {formatMoney(commissionCents)}</span><strong>Net estimé : {formatMoney(totalCents - commissionCents)}</strong><small>Aucun paiement n’est prélevé dans l’application.</small></div>
          <div className="request-actions"><button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === job.id ? "Envoi…" : "Envoyer la proposition"}</button><button className="secondary-button" type="button" onClick={() => setProposalTarget("")}>Fermer</button></div>
        </form> : <button className="primary-button" onClick={() => { setProposalTarget(job.id); setMessage(""); setItems([{ description: "", amount: "" }]); setError(""); }}>Faire une proposition</button>))}
      </article>)}</div>}
    </section>
  );
}