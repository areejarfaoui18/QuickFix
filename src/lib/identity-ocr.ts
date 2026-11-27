import type mongoose from "mongoose";
import { after } from "next/server";
import { getIdentityDocumentBucket } from "@/lib/message-attachments";
import { ArtisanProfile } from "@/models/artisan-profile";
import { User } from "@/models/user";

const OCR_TIMEOUT_MS = 280_000;
const documentTypes = ["TUNISIAN_CIN", "PASSPORT", "DRIVING_LICENSE", "RESIDENCE_PERMIT", "OTHER_ID", "NOT_AN_ID"] as const;

export type IdentityDocumentType = (typeof documentTypes)[number];
export type NameMatch = "MATCH" | "PARTIAL" | "MISMATCH" | "UNKNOWN";
export type IdentityOcrFields = {
  documentType: IdentityDocumentType;
  readable: boolean;
  fullName: string;
  fullNameLatin: string;
  documentNumber: string;
  birthDate: string;
  expiryDate: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isIdentityOcrConfigured(): boolean {
  return Boolean(process.env.MODAL_AI_URL && process.env.MODAL_AI_TOKEN);
}

/** Validates the OCR service answer; returns null when it is not usable. */
export function parseIdentityOcrFields(payload: unknown): IdentityOcrFields | null {
  if (!isRecord(payload) || !isRecord(payload.fields)) return null;
  const fields = payload.fields;
  const text = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const date = (value: unknown) => {
    const candidate = text(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && !Number.isNaN(Date.parse(candidate)) ? candidate : "";
  };
  const documentType = documentTypes.find((type) => type === fields.document_type);
  if (!documentType) return null;
  return {
    documentType,
    readable: fields.readable === true,
    fullName: text(fields.full_name_original),
    fullNameLatin: text(fields.full_name_latin),
    documentNumber: text(fields.document_number).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 40),
    birthDate: date(fields.birth_date),
    expiryDate: date(fields.expiry_date),
  };
}

function nameTokens(name: string): string[] {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}]+/u).filter((token) => token.length >= 2);
}

/**
 * Edit distance where a vowel change costs 1 and a consonant change costs 2.
 * Arabic script does not write short vowels, so two correct Latin spellings of
 * one name differ mostly by vowels (الطرابلسي → Trabelsi or Tarablosi).
 */
function spellingDistance(a: string, b: string): number {
  const cost = (letter: string) => "aeiouy".includes(letter) ? 1 : 2;
  let previous = [0];
  for (let j = 1; j <= b.length; j++) previous[j] = previous[j - 1] + cost(b[j - 1]);
  for (let i = 1; i <= a.length; i++) {
    const current = [previous[0] + cost(a[i - 1])];
    for (let j = 1; j <= b.length; j++) {
      const swap = a[i - 1] === b[j - 1] ? 0 : Math.max(cost(a[i - 1]), cost(b[j - 1]));
      current[j] = Math.min(previous[j] + cost(a[i - 1]), current[j - 1] + cost(b[j - 1]), previous[j - 1] + swap);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Compares the account name with the name read on the document. Each word of
 * the account name must be found on the document, allowing one consonant or a
 * few vowels of difference because Arabic names are transliterated.
 */
export function compareNames(accountName: string, ...documentNames: string[]): NameMatch {
  const expected = nameTokens(accountName);
  const found = documentNames.flatMap(nameTokens);
  if (expected.length === 0 || found.length === 0) return "UNKNOWN";
  const matched = expected.filter((token) => found.some((candidate) => spellingDistance(token, candidate) <= (token.length <= 6 ? 2 : 3))).length;
  return matched === expected.length ? "MATCH" : matched > 0 ? "PARTIAL" : "MISMATCH";
}

async function readStoredDocument(fileId: mongoose.Types.ObjectId): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of getIdentityDocumentBucket().openDownloadStream(fileId)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function requestIdentityOcr(document: Buffer, mimeType: string): Promise<IdentityOcrFields> {
  const response = await fetch(`${process.env.MODAL_AI_URL?.replace(/\/+$/, "")}/ocr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.MODAL_AI_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mime_type: mimeType, document_base64: document.toString("base64") }),
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Le service OCR a répondu ${response.status}.`);
  const fields = parseIdentityOcrFields(await response.json());
  if (!fields) throw new Error("Le service OCR a renvoyé une réponse invalide.");
  return fields;
}

/**
 * Reads the stored identity document and saves the result on the profile.
 * The result is only written if the profile still points at the same file.
 */
export async function runIdentityOcr(profileId: mongoose.Types.ObjectId, fileId: mongoose.Types.ObjectId): Promise<void> {
  const stillCurrent = { _id: profileId, "identityDocument.fileId": fileId, "identityOcr.fileId": fileId };
  try {
    const profile = await ArtisanProfile.findOne({ _id: profileId, "identityDocument.fileId": fileId }).select("userId identityDocument").lean();
    if (!profile?.identityDocument?.mimeType) return;
    const account = await User.findById(profile.userId).select("name").lean();
    const fields = await requestIdentityOcr(await readStoredDocument(fileId), profile.identityDocument.mimeType);
    await ArtisanProfile.updateOne(stillCurrent, {
      $set: {
        identityOcr: {
          ...fields,
          status: "DONE",
          fileId,
          nameMatch: compareNames(account?.name ?? "", fields.fullNameLatin, fields.fullName),
          processedAt: new Date(),
        },
      },
    });
  } catch (error) {
    // Only the error type is logged: the message could echo document content.
    console.error("Lecture automatique de la pièce d’identité impossible :", error instanceof Error ? error.name : "erreur inconnue");
    try {
      await ArtisanProfile.updateOne(stillCurrent, { $set: { identityOcr: { status: "FAILED", fileId, processedAt: new Date() } } });
    } catch (updateError) {
      console.error("Enregistrement de l’échec OCR impossible :", updateError instanceof Error ? updateError.name : "erreur inconnue");
    }
  }
}

/** Runs the OCR once the HTTP response has been sent, so uploads stay fast. */
export function scheduleIdentityOcr(profileId: mongoose.Types.ObjectId, fileId: mongoose.Types.ObjectId): void {
  if (!isIdentityOcrConfigured()) return;
  try {
    after(() => runIdentityOcr(profileId, fileId));
  } catch {
    // Outside a Next.js request (scripts, tests) there is no response to wait for.
    void runIdentityOcr(profileId, fileId);
  }
}
