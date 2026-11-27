import { canonicalCity } from "@/lib/cities";

export const assistantCategories = ["Plomberie", "Électricité", "Climatisation", "Peinture", "Ménage", "Serrurerie"] as const;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** An assistant failure with a message that is safe to show to the user. */
export class AiChatError extends Error {
  constructor(message: string, readonly status: 502 | 503) {
    super(message);
    this.name = "AiChatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isModalAiConfigured(): boolean {
  return Boolean(process.env.MODAL_AI_URL && process.env.MODAL_AI_TOKEN);
}

export function isAiChatConfigured(): boolean {
  return isModalAiConfigured() || Boolean(process.env.OPENAI_API_KEY);
}

/** The model on the Modal GPU. The first answer after a pause waits for the GPU to start. */
async function completeWithModal(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const response = await fetch(`${process.env.MODAL_AI_URL?.replace(/\/+$/, "")}/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.MODAL_AI_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(150_000),
    cache: "no-store",
  });
  if (!response.ok) {
    console.error("Le service IA Modal a refusé la demande de l’assistant :", { status: response.status });
    if (response.status === 401) throw new AiChatError("Le jeton du service IA est refusé. Vérifiez MODAL_AI_TOKEN dans .env.local, puis redémarrez le serveur.", 502);
    throw new AiChatError("Le service IA rencontre un problème temporaire. Réessayez dans quelques instants.", 503);
  }
  const result: unknown = await response.json();
  return isRecord(result) && typeof result.content === "string" ? result.content : "";
}

async function completeWithOpenAi(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages,
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });

  if (!response.ok) {
    let errorCode = "";
    try {
      const errorBody: unknown = await response.json();
      if (isRecord(errorBody) && isRecord(errorBody.error) && typeof errorBody.error.code === "string") errorCode = errorBody.error.code;
    } catch {
      console.warn("OpenAI a renvoyé une erreur sans détail JSON exploitable.");
    }
    console.error("OpenAI a refusé la demande de l’assistant :", { status: response.status, code: errorCode || "unknown" });

    if (response.status === 401 || errorCode === "invalid_api_key") {
      throw new AiChatError("La clé OpenAI configurée est refusée. Vérifiez OPENAI_API_KEY dans .env.local, puis redémarrez le serveur.", 502);
    }
    if (response.status === 429 && errorCode === "insufficient_quota") {
      throw new AiChatError("Le compte API OpenAI n’a plus de crédit disponible. Vérifiez la facturation et les limites sur la plateforme OpenAI.", 503);
    }
    if (response.status === 429) throw new AiChatError("La limite de requêtes OpenAI est atteinte. Attendez un peu puis réessayez.", 503);
    if (response.status === 404 || errorCode === "model_not_found") {
      throw new AiChatError("Le modèle OpenAI configuré n’est pas disponible. Vérifiez OPENAI_MODEL dans .env.local ou utilisez gpt-4o-mini.", 502);
    }
    if (response.status >= 500) throw new AiChatError("Le service OpenAI rencontre un problème temporaire. Réessayez dans quelques instants.", 503);
    throw new AiChatError("OpenAI a refusé la requête. Vérifiez le modèle configuré et les accès API du compte.", 502);
  }

  const result: unknown = await response.json();
  return isRecord(result) &&
    Array.isArray(result.choices) &&
    isRecord(result.choices[0]) &&
    isRecord(result.choices[0].message) &&
    typeof result.choices[0].message.content === "string"
    ? result.choices[0].message.content
    : "";
}

/** Returns the model's raw answer. Uses the Modal GPU when configured, otherwise OpenAI. */
export function completeChat(messages: ChatMessage[], maxTokens: number): Promise<string> {
  return isModalAiConfigured() ? completeWithModal(messages, maxTokens) : completeWithOpenAi(messages, maxTokens);
}

/**
 * Reads the model's answer. Open models do not always return clean JSON, so a
 * plain-text answer is kept as the message instead of failing the conversation.
 */
export function parseAssistantAnswer(content: string): { message: string; category: string | null; city: string | null } | null {
  const text = content.trim();
  let answer: unknown = null;
  const json = text.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      answer = JSON.parse(json[0]);
    } catch {
      answer = null;
    }
  }
  if (!isRecord(answer)) {
    return text && !text.startsWith("{") && text.length <= 1200 ? { message: text, category: null, city: null } : null;
  }
  if (typeof answer.message !== "string" || !answer.message.trim() || answer.message.length > 1200) return null;
  const category = assistantCategories.find((name) => name === answer.category) ?? null;
  // Only a city from the QuickFix list is kept, in its official spelling.
  const city = canonicalCity(answer.city);
  return { message: answer.message.trim(), category, city };
}
