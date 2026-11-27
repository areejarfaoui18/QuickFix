"use client";

import { useState } from "react";

export type IdentityOcrResult = {
  status?: "PROCESSING" | "DONE" | "FAILED";
  documentType?: "TUNISIAN_CIN" | "PASSPORT" | "DRIVING_LICENSE" | "RESIDENCE_PERMIT" | "OTHER_ID" | "NOT_AN_ID";
  readable?: boolean;
  fullName?: string;
  fullNameLatin?: string;
  documentNumber?: string;
  birthDate?: string;
  expiryDate?: string;
  nameMatch?: "MATCH" | "PARTIAL" | "MISMATCH" | "UNKNOWN";
};

const documentTypeLabels: Record<NonNullable<IdentityOcrResult["documentType"]>, string> = {
  TUNISIAN_CIN: "Carte d’identité nationale",
  PASSPORT: "Passeport",
  DRIVING_LICENSE: "Permis de conduire",
  RESIDENCE_PERMIT: "Titre de séjour",
  OTHER_ID: "Autre pièce d’identité",
  NOT_AN_ID: "Pas une pièce d’identité",
};

function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Shows the administrator what the automatic reading found on the identity document. */
export function IdentityOcrSummary({ profileId, accountName, ocr, onRestarted }: {
  profileId: string;
  accountName: string;
  ocr: IdentityOcrResult | null;
  onRestarted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function restart() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/artisans/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible de lancer la lecture automatique.");
      onRestarted();
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : "Impossible de lancer la lecture automatique.");
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const warnings: string[] = [];
  if (ocr?.status === "DONE") {
    if (ocr.documentType === "NOT_AN_ID") warnings.push("Le fichier ne ressemble pas à une pièce d’identité.");
    else if (!ocr.readable) warnings.push("Le document est peu lisible.");
    if (ocr.nameMatch === "MISMATCH") warnings.push(`Le nom lu ne correspond pas au nom du compte (${accountName}).`);
    if (ocr.nameMatch === "PARTIAL") warnings.push(`Le nom lu ne correspond qu’en partie au nom du compte (${accountName}).`);
    if (ocr.expiryDate && ocr.expiryDate < today) warnings.push("La pièce semble expirée.");
  }

  return (
    <div className="identity-ocr">
      <p className="identity-ocr-title">Lecture automatique de la pièce</p>
      {!ocr?.status ? <p className="form-hint">Pas encore de lecture automatique pour cette pièce.</p>
        : ocr.status === "PROCESSING" ? <p className="form-hint" role="status">Lecture en cours… Cela peut prendre une à deux minutes. <button className="text-link" onClick={onRestarted}>Actualiser</button></p>
        : ocr.status === "FAILED" ? <p className="form-error">La lecture automatique a échoué. Vérifiez la pièce manuellement ou relancez la lecture.</p>
        : <>
          <dl className="admin-artisan-details">
            <div><dt>Type</dt><dd>{ocr.documentType ? documentTypeLabels[ocr.documentType] : "—"}</dd></div>
            <div><dt>Nom lu</dt><dd>{ocr.fullNameLatin || ocr.fullName || "—"}{ocr.fullName && ocr.fullNameLatin && ocr.fullName !== ocr.fullNameLatin && <> · <span dir="auto">{ocr.fullName}</span></>}{ocr.nameMatch === "MATCH" && " ✓"}</dd></div>
            <div><dt>Numéro</dt><dd>{ocr.documentNumber || "—"}</dd></div>
            <div><dt>Naissance</dt><dd>{ocr.birthDate ? formatDate(ocr.birthDate) : "—"}</dd></div>
            <div><dt>Expiration</dt><dd>{ocr.expiryDate ? formatDate(ocr.expiryDate) : "—"}</dd></div>
          </dl>
          {warnings.map((warning) => <p className="form-error" key={warning}>{warning}</p>)}
          <p className="form-hint">Ces informations sont lues par un modèle et peuvent contenir des erreurs. Comparez-les toujours avec la pièce téléchargée avant de décider.</p>
        </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {ocr?.status !== "PROCESSING" && <button className="text-link" disabled={busy} onClick={() => void restart()}>{busy ? "Lancement…" : ocr?.status ? "Relancer la lecture" : "Lancer la lecture"}</button>}
    </div>
  );
}
