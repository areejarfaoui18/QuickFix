"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";

type RequestPhoto = { file: File; preview: string };
const MAX_PHOTOS = 4;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_PHOTO_SIZE = 15 * 1024 * 1024;
const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

type RequestDialogProps = {
  artisan: { id: string; name: string; category: string };
  onClose: () => void;
  onCreated: () => void;
};

function defaultSchedule() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(9, 0, 0, 0);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function RequestDialog({ artisan, onClose, onCreated }: RequestDialogProps) {
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [scheduledAt, setScheduledAt] = useState(defaultSchedule);
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [propertyType, setPropertyType] = useState("NON_PRECISE");
  const [urgency, setUrgency] = useState("NORMALE");
  const [accessDetails, setAccessDetails] = useState("");
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [photos, setPhotos] = useState<RequestPhoto[]>([]);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const photosRef = useRef(photos);

  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => photosRef.current.forEach(({ preview }) => URL.revokeObjectURL(preview)), []);

  function selectPhotos(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    if (selected.length + photos.length > MAX_PHOTOS) {
      setError(`Vous pouvez joindre ${MAX_PHOTOS} photos au maximum.`);
      return;
    }
    if (selected.reduce((total, file) => total + file.size, photos.reduce((size, photo) => size + photo.file.size, 0)) > MAX_TOTAL_PHOTO_SIZE) {
      setError("Le poids total des photos ne peut pas dépasser 15 Mo.");
      return;
    }
    const invalid = selected.find((file) => !allowedPhotoTypes.has(file.type) || file.size < 1 || file.size > MAX_PHOTO_SIZE);
    if (invalid) {
      setError("Choisissez des photos JPG, PNG ou WebP de 5 Mo maximum chacune.");
      return;
    }
    setError("");
    setPhotos((current) => [...current, ...selected.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  }

  function removePhoto(index: number) {
    const photo = photos[index];
    if (!photo) return;
    URL.revokeObjectURL(photo.preview);
    setPhotos(photos.filter((_, photoIndex) => photoIndex !== index));
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError("La localisation n’est pas disponible sur cet appareil.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setLocating(false);
      },
      () => {
        setError("Impossible d’obtenir votre position. Vérifiez l’autorisation de localisation.");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (budgetMin && budgetMax && Number(budgetMin) > Number(budgetMax)) {
      setError("Le budget maximum doit être supérieur ou égal au minimum.");
      return;
    }
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.set("artisanId", artisan.id);
      formData.set("description", description);
      formData.set("address", address);
      formData.set("scheduledAt", new Date(scheduledAt).toISOString());
      formData.set("propertyType", propertyType);
      formData.set("urgency", urgency);
      formData.set("accessDetails", accessDetails);
      if (budgetMin) formData.set("budgetMin", budgetMin);
      if (budgetMax) formData.set("budgetMax", budgetMax);
      if (location) formData.set("location", JSON.stringify(location));
      photos.forEach(({ file }) => formData.append("photos", file));
      const response = await fetch("/api/requests", {
        method: "POST",
        body: formData,
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Impossible d’envoyer la demande.");
        return;
      }
      photos.forEach(({ preview }) => URL.revokeObjectURL(preview));
      onCreated();
    } catch (submitError) {
      console.error("Envoi de la demande impossible :", submitError);
      setError("Le service est momentanément indisponible. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop request-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="artisan-modal request-modal" role="dialog" aria-modal="true" aria-labelledby="request-title">
        <button className="modal-close" onClick={onClose} aria-label="Fermer">×</button>
        <p className="eyebrow">NOUVELLE DEMANDE · {artisan.category}</p>
        <h2 id="request-title">Contacter {artisan.name}</h2>
        <p className="modal-description">Les informations et photos seront partagées uniquement avec cet artisan pour cette demande.</p>
        <form className="dialog-form" onSubmit={submit}>
          <label>Description du besoin<textarea required minLength={10} maxLength={2000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label>Adresse d’intervention<input required maxLength={300} autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} /></label>
          <div className="request-location">
            <button className="secondary-button" type="button" onClick={useCurrentLocation} disabled={locating}>{locating ? "Localisation…" : location ? "Position ajoutée ✓" : "Ajouter ma position GPS"}</button>
            <span>{location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : "Facultatif · aide l’artisan à trouver le lieu"}</span>
          </div>
          <label>Date et heure souhaitées<input required type="datetime-local" min={defaultSchedule()} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
          <div className="request-form-row">
            <label>Budget minimum (DT)<input type="number" min="0" max="1000000" step="1" inputMode="decimal" value={budgetMin} onChange={(event) => setBudgetMin(event.target.value)} placeholder="Facultatif" /></label>
            <label>Budget maximum (DT)<input type="number" min="0" max="1000000" step="1" inputMode="decimal" value={budgetMax} onChange={(event) => setBudgetMax(event.target.value)} placeholder="Facultatif" /></label>
          </div>
          <div className="request-form-row">
            <label>Type de lieu<select value={propertyType} onChange={(event) => setPropertyType(event.target.value)}><option value="NON_PRECISE">Non précisé</option><option value="MAISON">Maison</option><option value="APPARTEMENT">Appartement</option><option value="LOCAL_COMMERCIAL">Local commercial</option><option value="AUTRE">Autre</option></select></label>
            <label>Urgence<select value={urgency} onChange={(event) => setUrgency(event.target.value)}><option value="NORMALE">Normale</option><option value="URGENTE">Urgente</option></select></label>
          </div>
          <label>Accès et détails utiles<textarea maxLength={500} rows={2} value={accessDetails} onChange={(event) => setAccessDetails(event.target.value)} placeholder="Étage, interphone, contraintes d’accès… (ne partagez pas de code confidentiel)" /></label>
          <label className="request-photo-input">Photos du problème<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={submitting || photos.length >= MAX_PHOTOS} onChange={(event) => { selectPhotos(event.target.files); event.currentTarget.value = ""; }} /><small>JPG, PNG ou WebP · 5 Mo maximum par photo · {photos.length}/{MAX_PHOTOS}</small></label>
          {photos.length > 0 && <div className="request-photo-list">{photos.map((photo, index) => <div className="request-photo-preview" key={`${photo.file.name}-${photo.file.lastModified}-${index}`}><Image src={photo.preview} alt={`Aperçu de ${photo.file.name}`} width={43} height={43} unoptimized /><span>{photo.file.name}</span><button type="button" onClick={() => removePhoto(index)} aria-label={`Retirer ${photo.file.name}`}>×</button></div>)}</div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Envoi…" : "Envoyer la demande"}</button>
        </form>
      </section>
    </div>
  );
}
