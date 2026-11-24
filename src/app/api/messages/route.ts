import mongoose from "mongoose";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { Conversation } from "@/models/conversation";
import { Message } from "@/models/message";
import { ArtisanProfile } from "@/models/artisan-profile";
import { User } from "@/models/user";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function canUseMessaging(user: Awaited<ReturnType<typeof getAuthenticatedUser>>) {
  return user && !user.mustChangePassword && (user.role === "CLIENT" || user.role === "ARTISAN" || user.role === "ADMIN");
}

function jsonAttachment(attachment: { fileId: mongoose.Types.ObjectId; name: string; mimeType: string; size: number } | undefined) {
  if (!attachment) return null;
  return { id: attachment.fileId.toString(), name: attachment.name, mimeType: attachment.mimeType, size: attachment.size };
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour accéder aux messages." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (!canUseMessaging(user)) return Response.json({ error: "La messagerie est réservée aux clients et artisans." }, { status: 403 });

    const conversationId = new URL(request.url).searchParams.get("conversationId");
    const participantFilter = user.role === "CLIENT" || user.role === "ADMIN" ? { clientId: user.id } : { artisanId: user.id };

    if (conversationId) {
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return Response.json({ error: "La conversation sélectionnée est invalide." }, { status: 400 });
      }
      const conversation = await Conversation.findOne({
        _id: conversationId,
        $or: [{ clientId: user.id }, { artisanId: user.id }],
      }).lean();
      if (!conversation) return Response.json({ error: "Conversation introuvable." }, { status: 404 });

      await Message.updateMany(
        { conversationId: conversation._id, senderId: { $ne: user.id }, readAt: { $exists: false } },
        { $set: { readAt: new Date() } },
      );
      const [messages, otherUser, profile] = await Promise.all([
        Message.find({ conversationId: conversation._id }).sort({ createdAt: -1 }).limit(100).lean(),
        User.findById(user.role === "ARTISAN" ? conversation.clientId : conversation.artisanId).select("name").lean(),
        ArtisanProfile.findOne({ userId: conversation.artisanId }).select("category").lean(),
      ]);

      return Response.json({
        conversation: {
          id: conversation._id.toString(),
          participantName: otherUser?.name ?? "Compte indisponible",
          category: profile?.category ?? "",
          messages: messages.reverse().map((message) => ({
            id: message._id.toString(),
            senderId: message.senderId.toString(),
            text: message.text,
            attachment: jsonAttachment(message.attachment),
            createdAt: message.createdAt,
          })),
        },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const conversations = await Conversation.find(participantFilter).sort({ lastMessageAt: -1, updatedAt: -1 }).limit(100).lean();
    const ids = conversations.map((conversation) => conversation._id);
    const otherIds = conversations.map((conversation) => user.role === "ARTISAN" ? conversation.clientId : conversation.artisanId);
    const [otherUsers, profiles, unreadMessages] = await Promise.all([
      User.find({ _id: { $in: otherIds } }).select("name").lean(),
      ArtisanProfile.find({ userId: { $in: conversations.map((conversation) => conversation.artisanId) } }).select("userId category").lean(),
      ids.length
        ? Message.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
            { $match: { conversationId: { $in: ids }, senderId: { $ne: user.id }, readAt: { $exists: false } } },
            { $group: { _id: "$conversationId", count: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
    ]);
    const namesById = new Map(otherUsers.map((other) => [other._id.toString(), other.name]));
    const categoriesById = new Map(profiles.map((profile) => [profile.userId.toString(), profile.category]));
    const unreadById = new Map(unreadMessages.map((entry) => [entry._id.toString(), entry.count]));

    return Response.json({
      conversations: conversations.map((conversation) => ({
        id: conversation._id.toString(),
        participantName: namesById.get((user.role === "ARTISAN" ? conversation.clientId : conversation.artisanId).toString()) ?? "Compte indisponible",
        category: categoriesById.get(conversation.artisanId.toString()) ?? "",
        lastMessage: conversation.lastMessageText || "Conversation ouverte",
        lastMessageAt: conversation.lastMessageAt ?? conversation.createdAt,
        unreadCount: unreadById.get(conversation._id.toString()) ?? 0,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Chargement de la messagerie impossible :", error);
    return Response.json({ error: "Impossible de charger les messages pour le moment." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Requête non autorisée." }, { status: 403 });

  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour envoyer un message." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (!canUseMessaging(user)) return Response.json({ error: "La messagerie est réservée aux clients et artisans." }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Les informations du message sont invalides." }, { status: 400 });
    }
    if (!isRecord(body)) return Response.json({ error: "Les informations du message sont invalides." }, { status: 400 });

    if (body.action === "open") {
      if (user.role !== "CLIENT" && user.role !== "ADMIN") return Response.json({ error: "Seul un client ou un administrateur peut démarrer une conversation." }, { status: 403 });
      if (typeof body.artisanId !== "string" || !mongoose.Types.ObjectId.isValid(body.artisanId)) {
        return Response.json({ error: "L’artisan sélectionné est invalide." }, { status: 400 });
      }
      const artisanId = new mongoose.Types.ObjectId(body.artisanId);
      const [profile, artisan] = await Promise.all([
        ArtisanProfile.findOne({ userId: artisanId, ...(user.role === "CLIENT" ? { verificationStatus: "VERIFIED", "identityDocument.fileId": { $exists: true } } : {}) }).select("_id"),
        User.findOne({ _id: artisanId, role: "ARTISAN", ...(user.role === "CLIENT" ? { isSuspended: false } : {}) }).select("_id"),
      ]);
      if (!profile || !artisan) return Response.json({ error: "Cet artisan n’est pas disponible." }, { status: 404 });

      let conversation;
      try {
        conversation = await Conversation.findOneAndUpdate(
          { clientId: user.id, artisanId },
          { $setOnInsert: { clientId: user.id, artisanId, lastMessageText: "" } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean();
      } catch (error) {
        if (!(isRecord(error) && error.code === 11000)) throw error;
        conversation = await Conversation.findOne({ clientId: user.id, artisanId }).lean();
      }
      if (!conversation) throw new Error("Création de la conversation impossible.");
      return Response.json({ conversationId: conversation._id.toString() }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    if (
      body.action !== "send" ||
      typeof body.conversationId !== "string" ||
      !mongoose.Types.ObjectId.isValid(body.conversationId) ||
      typeof body.text !== "string"
    ) {
      return Response.json({ error: "Le message ou la conversation est invalide." }, { status: 400 });
    }
    const text = body.text.trim();
    if (!text || text.length > 2000) return Response.json({ error: "Le message doit contenir entre 1 et 2 000 caractères." }, { status: 400 });

    const conversation = await Conversation.findOne({
      _id: body.conversationId,
      $or: [{ clientId: user.id }, { artisanId: user.id }],
    });
    if (!conversation) return Response.json({ error: "Conversation introuvable." }, { status: 404 });

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: user.id,
      text,
    });
    conversation.lastMessageText = text;
    conversation.lastMessageSenderId = user.id;
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    return Response.json({
      message: { id: message.id, senderId: user.id.toString(), text: message.text, attachment: null, createdAt: message.createdAt },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Envoi du message impossible :", error);
    return Response.json({ error: "Impossible d’envoyer le message pour le moment." }, { status: 503 });
  }
}
