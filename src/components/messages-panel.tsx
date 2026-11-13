"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AppUser } from "@/components/auth-dialog";

type ConversationSummary = {
  id: string;
  participantName: string;
  category: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
};

type MessageItem = {
  id: string;
  senderId: string;
  text: string;
  attachment: { id: string; name: string; mimeType: string; size: number } | null;
  createdAt: string;
};

type ConversationDetail = {
  id: string;
  participantName: string;
  category: string;
  messages: MessageItem[];
};

type MessagesPanelProps = {
  user: AppUser;
  initialArtisanId: string | null;
  onInitialTargetHandled: () => void;
  onBrowseArtisans: () => void;
  onUnreadCountChange: (count: number) => void;
};

export function MessagesPanel({ user, initialArtisanId, onInitialTargetHandled, onBrowseArtisans, onUnreadCountChange }: MessagesPanelProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sentError, setSentError] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/messages", { signal, cache: "no-store" });
      const result: { conversations?: ConversationSummary[]; error?: string } = await response.json();
      if (!response.ok || !result.conversations) throw new Error(result.error ?? "Impossible de charger les conversations.");
      setConversations(result.conversations);
      onUnreadCountChange(result.conversations.reduce((total, item) => total + item.unreadCount, 0));
      setError("");
    } catch (loadError) {
      if (signal?.aborted) return;
      console.error("Chargement de la boîte de réception impossible :", loadError);
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger les conversations.");
    } finally {
      if (!signal?.aborted) setLoadingInbox(false);
    }
  }, [onUnreadCountChange]);

  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void loadInbox(controller.signal), 0);
    const timer = window.setInterval(() => void loadInbox(controller.signal), 10_000);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadInbox]);

  useEffect(() => {
    if (!initialArtisanId) return;
    const controller = new AbortController();
    fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open", artisanId: initialArtisanId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result: { conversationId?: string; error?: string } = await response.json();
        if (!response.ok || !result.conversationId) throw new Error(result.error ?? "Impossible d’ouvrir la conversation.");
        setDetail(null);
        setSelectedId(result.conversationId);
        await loadInbox(controller.signal);
      })
      .catch((openError: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Ouverture de la conversation impossible :", openError);
        setError(openError instanceof Error ? openError.message : "Impossible d’ouvrir la conversation.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingConversation(false);
          onInitialTargetHandled();
        }
      });
    return () => controller.abort();
  }, [initialArtisanId, loadInbox, onInitialTargetHandled]);

  useEffect(() => {
    if (!selectedId) return;

    let active = true;
    let timer: number | undefined;
    async function refreshConversation() {
      try {
        const response = await fetch(`/api/messages?conversationId=${encodeURIComponent(selectedId)}`, { cache: "no-store" });
        const result: { conversation?: ConversationDetail; error?: string } = await response.json();
        if (!response.ok || !result.conversation) throw new Error(result.error ?? "Impossible de charger cette conversation.");
        if (active) {
          setDetail(result.conversation);
          setSentError("");
          void loadInbox();
          requestAnimationFrame(() => conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight }));
        }
      } catch (loadError) {
        if (active) {
          console.error("Chargement des messages impossible :", loadError);
          setSentError(loadError instanceof Error ? loadError.message : "Impossible de charger cette conversation.");
        }
      } finally {
        if (active) {
          setLoadingConversation(false);
          timer = window.setTimeout(() => void refreshConversation(), 5_000);
        }
      }
    }

    void refreshConversation();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [selectedId, loadInbox]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || (!text.trim() && !file) || sending) return;
    setSending(true);
    setSentError("");

    try {
      let response: Response;
      if (file) {
        const formData = new FormData();
        formData.set("conversationId", selectedId);
        formData.set("text", text);
        formData.set("file", file);
        response = await fetch("/api/messages/attachments", { method: "POST", body: formData });
      } else {
        response = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send", conversationId: selectedId, text }),
        });
      }
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible d’envoyer le message.");
      setText("");
      setFile(null);
      await Promise.all([loadInbox(), refreshSelected()]);
    } catch (sendError) {
      console.error("Envoi du message impossible :", sendError);
      setSentError(sendError instanceof Error ? sendError.message : "Impossible d’envoyer le message.");
    } finally {
      setSending(false);
    }
  }

  async function refreshSelected() {
    if (!selectedId) return;
    const response = await fetch(`/api/messages?conversationId=${encodeURIComponent(selectedId)}`, { cache: "no-store" });
    const result: { conversation?: ConversationDetail; error?: string } = await response.json();
    if (!response.ok || !result.conversation) throw new Error(result.error ?? "Impossible d’actualiser la conversation.");
    setDetail(result.conversation);
  }

  return (
    <section className="messages-panel">
      <header className="messages-heading">
        <div><p className="eyebrow">{user.role === "ARTISAN" ? "ESPACE PROFESSIONNEL" : user.role === "ADMIN" ? "ESPACE ADMINISTRATION" : "VOTRE ESPACE QUICKFIX"}</p><h1>Messages</h1><p>Échangez directement avec {user.role === "ARTISAN" ? "vos clients" : user.role === "ADMIN" ? "les artisans" : "les artisans"}.</p></div>
      </header>
      {error && <p className="form-error" role="alert">{error}<button className="text-link" onClick={() => void loadInbox()}>Réessayer</button></p>}
      <div className="messages-layout">
        <aside className="conversation-list" aria-label="Conversations">
          <h2>Conversations</h2>
          {loadingInbox && conversations.length === 0 ? <p role="status">Chargement…</p> : conversations.length === 0 ? (
            <div className="conversation-empty">{user.role === "CLIENT" ? <><p>Vous n’avez pas encore de conversation.</p><button className="text-link" onClick={onBrowseArtisans}>Trouver un artisan</button></> : <p>{user.role === "ADMIN" ? "Les conversations avec les artisans apparaîtront ici." : "Les messages des clients apparaîtront ici."}</p>}</div>
          ) : conversations.map((item) => (
            <button key={item.id} className={`conversation-item ${selectedId === item.id ? "active" : ""}`} onClick={() => { setDetail(null); setLoadingConversation(true); setSelectedId(item.id); setSentError(""); }}>
              <span className="conversation-avatar">{item.participantName.slice(0, 1).toUpperCase()}</span>
              <span className="conversation-summary"><strong>{item.participantName}</strong><small>{item.category}</small><span>{item.lastMessage}</span></span>
              <span className="conversation-meta">{item.unreadCount > 0 && <i>{item.unreadCount}</i>}<time>{new Date(item.lastMessageAt).toLocaleDateString("fr-FR")}</time></span>
            </button>
          ))}
        </aside>
        <div className="chat-pane">
          {!selectedId ? (
            <div className="chat-empty"><span className="placeholder-icon">☏</span><strong>Sélectionnez une conversation</strong><p>Vos échanges privés avec les artisans et les clients apparaîtront ici.</p></div>
          ) : (
            <>
              <header className="chat-heading"><button className="chat-back" onClick={() => setSelectedId("")}>‹</button><span className="conversation-avatar">{detail?.participantName.slice(0, 1).toUpperCase() ?? "…"}</span><span><strong>{detail?.participantName ?? "Chargement…"}</strong><small>{detail?.category}</small></span></header>
              <div className="chat-messages" ref={conversationRef} aria-live="polite">
                {loadingConversation && !detail ? <p role="status">Chargement des messages…</p> : detail?.messages.length ? detail.messages.map((message) => (
                  <article key={message.id} className={`chat-message ${message.senderId === user.id ? "mine" : ""}`}>
                    {message.text && <p>{message.text}</p>}
                    {message.attachment && <a className="chat-attachment" href={`/api/messages/attachments?messageId=${encodeURIComponent(message.id)}`} target={message.attachment.mimeType === "application/pdf" ? "_blank" : undefined} rel={message.attachment.mimeType === "application/pdf" ? "noreferrer" : undefined}>{message.attachment.mimeType === "application/pdf" ? "↗ Ouvrir le PDF :" : "↧"} {message.attachment.name} <small>({(message.attachment.size / (1024 * 1024)).toFixed(1)} Mo)</small></a>}
                    <time>{new Date(message.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</time>
                  </article>
                )) : <p className="chat-first-message">Conversation privée — envoyez le premier message.</p>}
              </div>
              {sentError && <p className="form-error chat-error" role="alert">{sentError}</p>}
              <form className="chat-compose" onSubmit={(event) => void send(event)}>
                {file && <div className="selected-file">{file.name}<button type="button" onClick={() => setFile(null)} aria-label="Retirer la pièce jointe">×</button></div>}
                <label className="chat-attach" title="Joindre une image ou un PDF">
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={sending} onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    if (selected && selected.size > 5 * 1024 * 1024) {
                      setSentError("La pièce jointe ne peut pas dépasser 5 Mo.");
                      setFile(null);
                      event.target.value = "";
                      return;
                    }
                    setSentError("");
                    setFile(selected);
                  }} />
                  <span aria-hidden="true">＋</span>
                </label>
                <textarea aria-label="Votre message" rows={2} maxLength={2000} placeholder="Écrivez votre message…" value={text} onChange={(event) => setText(event.target.value)} disabled={sending} />
                <button className="primary-button" type="submit" disabled={sending || (!text.trim() && !file)}>{sending ? "Envoi…" : "Envoyer"}</button>
              </form>
              <p className="chat-hint">Messages privés entre client et artisan. Image ou PDF, 5 Mo maximum.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
