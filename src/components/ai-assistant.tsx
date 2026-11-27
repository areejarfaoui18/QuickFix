"use client";

import { useEffect, useRef, useState } from "react";
import { canonicalCity } from "@/lib/cities";

type Message = {
  role: "user" | "assistant";
  content: string;
  category?: string | null;
  city?: string | null;
};

export type AssistantArtisan = {
  id: string;
  name: string;
  city: string;
  category: string;
  available: boolean;
  rating: number | null;
  price: string;
};

const MAX_SENT_MESSAGES = 20;
const starters = ["Mon robinet fuit", "Ma climatisation ne refroidit plus", "Comment fonctionne un devis ?", "Comment devenir artisan vérifié ?"];

function sameText(left: string, right: string) {
  const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  return normalize(left) === normalize(right);
}

/**
 * Up to three available artisans of the category, best rated first. When the
 * client's city is known, only artisans of that city are suggested; if there
 * are none, artisans of other cities are returned and flagged as such.
 */
function suggestArtisans(artisans: AssistantArtisan[], category: string, city: string | null) {
  const inCategory = artisans
    .filter((artisan) => artisan.available && sameText(artisan.category, category))
    .sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0));
  if (!city) return { list: inCategory.slice(0, 3), noneInCity: false };
  const inCity = inCategory.filter((artisan) => (canonicalCity(artisan.city) ?? artisan.city) === city);
  return inCity.length > 0 ? { list: inCity.slice(0, 3), noneInCity: false } : { list: inCategory.slice(0, 3), noneInCity: true };
}

export function AiAssistant({ artisans, onSelectCategory, onSelectArtisan, onClose }: {
  artisans: AssistantArtisan[];
  onSelectCategory: (category: string) => void;
  onSelectArtisan: (artisanId: string) => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Bonjour ! Décrivez-moi le problème chez vous et je vous oriente vers le bon artisan. Vous pouvez aussi me poser vos questions sur QuickFix." },
  ]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slowStart, setSlowStart] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, slowStart]);

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setLoading(true);
    // The model runs on a GPU that sleeps when unused; tell the client when it is waking up.
    const slowTimer = window.setTimeout(() => setSlowStart(true), 6000);

    try {
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The opening greeting is ours, not the model's, so it is not sent.
        body: JSON.stringify({ messages: nextMessages.slice(1).slice(-MAX_SENT_MESSAGES).map(({ role, content: sent, category, city }) => ({ role, content: sent, category, city })) }),
      });
      const result: { message?: string; category?: string | null; city?: string | null; error?: string } = await response.json();
      if (!response.ok || !result.message) throw new Error(result.error ?? "Impossible d’obtenir une réponse.");
      setMessages((current) => [...current, { role: "assistant", content: result.message!, category: result.category, city: result.city }]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "L’assistant est momentanément indisponible.");
    } finally {
      window.clearTimeout(slowTimer);
      setSlowStart(false);
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop ai-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}>
      <section className="artisan-modal ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-title">
        <button className="modal-close" disabled={loading} onClick={onClose} aria-label="Fermer">×</button>
        <p className="eyebrow">ASSISTANT QUICKFIX</p>
        <h2 id="ai-title">Comment puis-je vous aider ?</h2>
        <p className="ai-disclaimer">L’assistant vous oriente, mais ne remplace pas l’avis d’un professionnel et peut se tromper. Évitez de partager des informations personnelles.</p>
        <div className="ai-conversation" ref={conversationRef} aria-live="polite">
          {messages.map((message, index) => {
            // The city stays known for the rest of the conversation, even if a later answer omits it.
            const city = messages.slice(0, index + 1).findLast((earlier) => earlier.city)?.city ?? null;
            const { list: suggestions, noneInCity } = message.role === "assistant" && message.category
              ? suggestArtisans(artisans, message.category, city)
              : { list: [], noneInCity: false };
            return (
              <div className={`ai-message ${message.role}`} key={`${index}-${message.role}`}>
                <p>{message.content}</p>
                {message.role === "assistant" && message.category && (noneInCity || suggestions.length === 0) && (
                  <p className="ai-notice">
                    {suggestions.length === 0
                      ? `Aucun artisan disponible en ${message.category} pour le moment.`
                      : `Aucun artisan disponible en ${message.category} à ${city} pour le moment. Dans d’autres villes :`}
                  </p>
                )}
                {suggestions.length > 0 && <ul className="ai-artisans">
                  {suggestions.map((artisan) => (
                    <li key={artisan.id}>
                      <button onClick={() => onSelectArtisan(artisan.id)}>
                        <strong>{artisan.name}</strong>
                        <span>{artisan.city}{artisan.rating !== null && ` · ★ ${artisan.rating.toFixed(1)}`} · {artisan.price}</span>
                      </button>
                    </li>
                  ))}
                </ul>}
                {message.role === "assistant" && message.category && (
                  <button className="ai-category-button" onClick={() => onSelectCategory(message.category!)}>
                    Voir tous les artisans en {message.category}
                  </button>
                )}
              </div>
            );
          })}
          {messages.length === 1 && !loading && <div className="ai-starters">
            {starters.map((starter) => <button key={starter} onClick={() => void sendMessage(starter)}>{starter}</button>)}
          </div>}
          {loading && <p className="ai-thinking" role="status">{slowStart ? "L’assistant démarre, cela peut prendre jusqu’à une minute…" : "L’assistant réfléchit…"}</p>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <form className="ai-form" onSubmit={(event) => { event.preventDefault(); void sendMessage(input); }}>
          <label className="sr-only" htmlFor="ai-message">Votre message</label>
          <textarea
            id="ai-message"
            rows={2}
            maxLength={1000}
            placeholder="Ex. : le robinet de la cuisine fuit…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void sendMessage(input);
              }
            }}
            disabled={loading}
          />
          <button className="primary-button" type="submit" disabled={loading || !input.trim()}>{loading ? "Envoi…" : "Envoyer"}</button>
        </form>
      </section>
    </div>
  );
}
