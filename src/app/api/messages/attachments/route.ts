import mongoose from "mongoose";
import { Readable } from "node:stream";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { cleanAttachmentName, detectAttachmentType, getMessageAttachmentBucket, isAllowedAttachmentType, MAX_ATTACHMENT_SIZE, uploadAttachment } from "@/lib/message-attachments";
import { connectToDatabase } from "@/lib/mongodb";
import { Conversation } from "@/models/conversation";
import { Message } from "@/models/message";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour télécharger cette pièce jointe." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT" && user.role !== "ARTISAN" && user.role !== "ADMIN") {
      return Response.json({ error: "La messagerie est réservée aux clients, artisans et administrateurs." }, { status: 403 });
    }

    const messageId = new URL(request.url).searchParams.get("messageId");
    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
      return Response.json({ error: "La pièce jointe demandée est invalide." }, { status: 400 });
    }
    const message = await Message.findById(messageId).lean();
    if (!message?.attachment) return Response.json({ error: "Pièce jointe introuvable." }, { status: 404 });

    const conversation = await Conversation.findOne({
      _id: message.conversationId,
      $or: [{ clientId: user.id }, { artisanId: user.id }],
    }).select("_id");
    if (!conversation) return Response.json({ error: "Accès à cette pièce jointe refusé." }, { status: 403 });

    const bucket = getMessageAttachmentBucket();
    const file = await bucket.find({ _id: message.attachment.fileId }).next();
    if (!file) return Response.json({ error: "Le fichier est introuvable dans le stockage." }, { status: 404 });

    const stream = bucket.openDownloadStream(message.attachment.fileId);
    const filename = encodeURIComponent(message.attachment.name);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": message.attachment.mimeType,
        "Content-Length": String(message.attachment.size),
        "Content-Disposition": `${message.attachment.mimeType === "application/pdf" ? "inline" : "attachment"}; filename="quickfix-attachment"; filename*=UTF-8''${filename}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Téléchargement de pièce jointe impossible :", error);
    return Response.json({ error: "Impossible de télécharger cette pièce jointe." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });

  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour envoyer une pièce jointe." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT" && user.role !== "ARTISAN" && user.role !== "ADMIN") {
      return Response.json({ error: "La messagerie est réservée aux clients, artisans et administrateurs." }, { status: 403 });
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_ATTACHMENT_SIZE + 64 * 1024) {
      return Response.json({ error: "La pièce jointe ne peut pas dépasser 5 Mo." }, { status: 413 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "Le fichier envoyé est invalide." }, { status: 400 });
    }
    const conversationId = form.get("conversationId");
    const file = form.get("file");
    const textValue = form.get("text");
    const text = typeof textValue === "string" ? textValue.trim() : "";
    if (typeof conversationId !== "string" || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return Response.json({ error: "La conversation sélectionnée est invalide." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_ATTACHMENT_SIZE) {
      return Response.json({ error: "Choisissez un fichier non vide de 5 Mo maximum." }, { status: 400 });
    }
    if (text.length > 2000) return Response.json({ error: "Le texte du message ne peut pas dépasser 2 000 caractères." }, { status: 400 });

    const conversation = await Conversation.findOne({
      _id: conversationId,
      $or: [{ clientId: user.id }, { artisanId: user.id }],
    });
    if (!conversation) return Response.json({ error: "Conversation introuvable." }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = detectAttachmentType(buffer);
    if (!mimeType || !isAllowedAttachmentType(mimeType)) {
      return Response.json({ error: "Format non accepté. Joignez une image JPG, PNG, WebP ou un PDF." }, { status: 415 });
    }
    const extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" }[mimeType];
    const originalName = cleanAttachmentName(file.name);
    const name = `${originalName.replace(/\.[^.]+$/, "")}${extension}`;
    const fileId = await uploadAttachment(buffer, name, mimeType);
    let message;
    try {
      message = await Message.create({
        conversationId: conversation._id,
        senderId: user.id,
        text,
        attachment: { fileId, name, mimeType, size: buffer.length },
      });
    } catch (error) {
      await getMessageAttachmentBucket().delete(fileId);
      throw error;
    }

    const lastMessageText = text || `Pièce jointe : ${name}`;
    conversation.lastMessageText = lastMessageText;
    conversation.lastMessageSenderId = user.id;
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    return Response.json({
      message: {
        id: message.id,
        senderId: user.id.toString(),
        text: message.text,
        attachment: { id: fileId.toString(), name, mimeType, size: buffer.length },
        createdAt: message.createdAt,
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Envoi de pièce jointe impossible :", error);
    return Response.json({ error: "Impossible d’envoyer la pièce jointe pour le moment." }, { status: 503 });
  }
}
