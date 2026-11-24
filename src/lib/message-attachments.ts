import mongoose from "mongoose";

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export function getMessageAttachmentBucket(): mongoose.mongo.GridFSBucket {
  const db = mongoose.connection.db;
  if (!db) throw new Error("La connexion MongoDB n’est pas disponible pour les pièces jointes.");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: "messageAttachments" });
}

export function getRequestAttachmentBucket(): mongoose.mongo.GridFSBucket {
  const db = mongoose.connection.db;
  if (!db) throw new Error("La connexion MongoDB n’est pas disponible pour les photos des demandes.");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: "requestAttachments" });
}

export function getIdentityDocumentBucket(): mongoose.mongo.GridFSBucket {
  const db = mongoose.connection.db;
  if (!db) throw new Error("La connexion MongoDB n’est pas disponible pour les pièces d’identité.");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: "identityDocuments" });
}

export function detectAttachmentType(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) return "image/jpeg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "image/png";
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export function cleanAttachmentName(name: string): string {
  const basename = name.replace(/\\/g, "/").split("/").pop() ?? "piece-jointe";
  const cleaned = basename.replace(/[^\p{L}\p{N}._ -]/gu, "_").trim().slice(0, 150);
  return cleaned || "piece-jointe";
}

export function isAllowedAttachmentType(type: string): boolean {
  return allowedTypes.has(type);
}

export function uploadAttachment(buffer: Buffer, name: string, mimeType: string): Promise<mongoose.mongo.ObjectId> {
  if (buffer.length === 0 || buffer.length > MAX_ATTACHMENT_SIZE) {
    return Promise.reject(new Error("La pièce jointe doit faire entre 1 octet et 5 Mo."));
  }
  return uploadToBucket(getMessageAttachmentBucket(), buffer, name, mimeType);
}

export function uploadRequestAttachment(buffer: Buffer, name: string, mimeType: string): Promise<mongoose.mongo.ObjectId> {
  if (buffer.length === 0 || buffer.length > MAX_ATTACHMENT_SIZE) {
    return Promise.reject(new Error("La photo doit faire entre 1 octet et 5 Mo."));
  }
  return uploadToBucket(getRequestAttachmentBucket(), buffer, name, mimeType);
}

export function uploadIdentityDocument(buffer: Buffer, mimeType: string): Promise<mongoose.mongo.ObjectId> {
  if (buffer.length === 0 || buffer.length > MAX_ATTACHMENT_SIZE) {
    return Promise.reject(new Error("La pièce d’identité doit faire entre 1 octet et 5 Mo."));
  }
  return uploadToBucket(getIdentityDocumentBucket(), buffer, "identity-document", mimeType);
}

function uploadToBucket(bucket: mongoose.mongo.GridFSBucket, buffer: Buffer, name: string, mimeType: string): Promise<mongoose.mongo.ObjectId> {
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(name, {
      metadata: { contentType: mimeType },
    });
    stream.once("error", reject);
    stream.once("finish", () => resolve(stream.id));
    stream.end(buffer);
  });
}

export { MAX_ATTACHMENT_SIZE };
