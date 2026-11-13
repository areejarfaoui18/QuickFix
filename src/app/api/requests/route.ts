import mongoose from "mongoose";
import { cleanAttachmentName, detectAttachmentType, getRequestAttachmentBucket, uploadRequestAttachment, MAX_ATTACHMENT_SIZE } from "@/lib/message-attachments";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { ArtisanProfile } from "@/models/artisan-profile";
import { Conversation } from "@/models/conversation";
import { Message } from "@/models/message";
import { ServiceRequest, type ServiceRequestDocument } from "@/models/service-request";
import { Report } from "@/models/report";
import { Review } from "@/models/review";
import { User } from "@/models/user";
import { getMessageAttachmentBucket, uploadAttachment } from "@/lib/message-attachments";
import { generateQuotePdf } from "@/lib/quote-pdf";

const requestStatuses = ["EN_ATTENTE", "ACCEPTEE", "EN_COURS", "TERMINEE", "REFUSEE", "ANNULEE"] as const;
type RequestStatus = (typeof requestStatuses)[number];
const requestPropertyTypes = ["NON_PRECISE", "MAISON", "APPARTEMENT", "LOCAL_COMMERCIAL", "AUTRE"] as const;
const requestUrgencies = ["NORMALE", "URGENTE"] as const;
const maxRequestPhotos = 4;
const maxRequestPhotoSize = 15 * 1024 * 1024;
const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
type StoredRequestPhoto = { fileId: mongoose.Types.ObjectId; name: string; mimeType: string; size: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour consulter vos demandes." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT" && user.role !== "ARTISAN") {
      return Response.json({ error: "Ce compte ne peut pas consulter les demandes." }, { status: 403 });
    }
    if (new URL(request.url).searchParams.get("summary") === "pending") {
      const pendingCount = user.role === "ARTISAN"
        ? await ServiceRequest.countDocuments({ artisanId: user.id, status: "EN_ATTENTE" })
        : 0;
      return Response.json({ pendingCount }, { headers: { "Cache-Control": "no-store" } });
    }

    const ownRequests = await ServiceRequest.aggregate([
      { $match: user.role === "CLIENT" ? { clientId: user.id } : { artisanId: user.id } },
      ...(user.role === "ARTISAN"
        ? [
            { $addFields: { pendingPriority: { $cond: [{ $eq: ["$status", "EN_ATTENTE"] }, 0, 1] } } },
            { $sort: { pendingPriority: 1 as const, createdAt: -1 as const } },
          ]
        : [{ $sort: { createdAt: -1 as const } }]),
      { $limit: 100 },
      {
        $lookup: {
          from: User.collection.name,
          localField: "clientId",
          foreignField: "_id",
          pipeline: [{ $project: { name: 1 } }],
          as: "client",
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: "artisanId",
          foreignField: "_id",
          pipeline: [{ $project: { name: 1 } }],
          as: "artisan",
        },
      },
      {
        $lookup: {
          from: Review.collection.name,
          let: { requestId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$requestId", "$$requestId"] } } },
            { $project: { rating: 1, comment: 1, createdAt: 1 } },
            { $limit: 1 },
          ],
          as: "review",
        },
      },
      ...(user.role === "CLIENT" ? [{
        $lookup: {
          from: Report.collection.name,
          let: { requestId: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ["$targetId", "$$requestId"] },
              { $eq: ["$reporterId", user.id] },
            ] } } },
            { $limit: 1 },
          ],
          as: "openReports",
        },
      }] : []),
      { $unwind: "$client" },
      { $unwind: "$artisan" },
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          clientId: { $toString: "$clientId" },
          artisanId: { $toString: "$artisanId" },
          clientName: "$client.name",
          artisanName: "$artisan.name",
          category: 1,
          description: 1,
          address: 1,
          location: { $ifNull: ["$location", null] },
          scheduledAt: 1,
          budgetMin: { $ifNull: ["$budgetMin", null] },
          budgetMax: { $ifNull: ["$budgetMax", null] },
          propertyType: { $ifNull: ["$propertyType", "NON_PRECISE"] },
          urgency: { $ifNull: ["$urgency", "NORMALE"] },
          accessDetails: { $ifNull: ["$accessDetails", ""] },
          photos: {
            $map: {
              input: { $ifNull: ["$photos", []] },
              as: "photo",
              in: { id: { $toString: "$$photo.fileId" }, name: "$$photo.name", size: "$$photo.size" },
            },
          },
          status: 1,
          announcedPrice: { $ifNull: ["$announcedPrice", null] },
          quoteItems: { $ifNull: ["$quoteItems", []] },
          quoteSentAt: { $ifNull: ["$quoteSentAt", null] },
          quoteValidUntil: { $ifNull: ["$quoteValidUntil", null] },
          quoteAcceptedAt: { $ifNull: ["$quoteAcceptedAt", null] },
          review: user.role === "CLIENT"
            ? { $ifNull: [{ $arrayElemAt: ["$review", 0] }, null] }
            : { $literal: null },
          hasOpenReport: user.role === "CLIENT"
            ? { $gt: [{ $size: "$openReports" }, 0] }
            : { $literal: false },
          statusHistory: 1,
          createdAt: 1,
        },
      },
    ]);

    return Response.json({ requests: ownRequests }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Chargement des demandes impossible :", error);
    return Response.json({ error: "Impossible de charger les demandes pour le moment." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return Response.json({ error: "Requête non autorisée." }, { status: 403 });
  }

  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour demander une intervention." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT") {
      return Response.json({ error: "Seul un compte client peut créer une demande." }, { status: 403 });
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxRequestPhotoSize + 1024 * 1024) {
      return Response.json({ error: "Les photos jointes ne peuvent pas dépasser 15 Mo au total." }, { status: 413 });
    }

    let fields: Record<string, unknown>;
    let photoFiles: File[] = [];
    try {
      if (request.headers.get("content-type")?.includes("multipart/form-data")) {
        const form = await request.formData();
        fields = Object.fromEntries([...form.entries()].filter(([key]) => key !== "photos"));
        const uploadedPhotos = form.getAll("photos");
        if (uploadedPhotos.some((file) => !(file instanceof File))) {
          return Response.json({ error: "Les photos envoyées sont invalides." }, { status: 400 });
        }
        photoFiles = uploadedPhotos.filter((file): file is File => file instanceof File && file.size > 0);
      } else {
        const body: unknown = await request.json();
        if (!isRecord(body)) return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
        fields = body;
      }
    } catch {
      return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
    }

    const artisanId = typeof fields.artisanId === "string" ? fields.artisanId : "";
    const description = typeof fields.description === "string" ? fields.description.trim() : "";
    const address = typeof fields.address === "string" ? fields.address.trim() : "";
    const scheduledAt = typeof fields.scheduledAt === "string" ? new Date(fields.scheduledAt) : new Date(Number.NaN);
    const propertyType = typeof fields.propertyType === "string" ? fields.propertyType : "NON_PRECISE";
    const urgency = typeof fields.urgency === "string" ? fields.urgency : "NORMALE";
    const accessDetails = typeof fields.accessDetails === "string" ? fields.accessDetails.trim() : "";
    const parseBudget = (value: unknown) => {
      if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return undefined;
      const number = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
      return Number.isFinite(number) ? number : Number.NaN;
    };
    const budgetMin = parseBudget(fields.budgetMin);
    const budgetMax = parseBudget(fields.budgetMax);
    let location: { latitude: number; longitude: number } | undefined;
    if (fields.location !== undefined && fields.location !== "") {
      let rawLocation: unknown = fields.location;
      if (typeof rawLocation === "string") {
        try {
          rawLocation = JSON.parse(rawLocation);
        } catch {
          return Response.json({ error: "La position sur la carte est invalide." }, { status: 400 });
        }
      }
      if (!isRecord(rawLocation) || typeof rawLocation.latitude !== "number" || typeof rawLocation.longitude !== "number" ||
          !Number.isFinite(rawLocation.latitude) || !Number.isFinite(rawLocation.longitude) ||
          rawLocation.latitude < -90 || rawLocation.latitude > 90 || rawLocation.longitude < -180 || rawLocation.longitude > 180) {
        return Response.json({ error: "La position sur la carte est invalide." }, { status: 400 });
      }
      location = { latitude: rawLocation.latitude, longitude: rawLocation.longitude };
    }
    if (!mongoose.Types.ObjectId.isValid(artisanId)) {
      return Response.json({ error: "L’artisan sélectionné est invalide." }, { status: 400 });
    }
    if (description.length < 10 || description.length > 2000) {
      return Response.json({ error: "La description doit contenir entre 10 et 2 000 caractères." }, { status: 400 });
    }
    if (!address || address.length > 300) {
      return Response.json({ error: "L’adresse d’intervention est obligatoire (300 caractères maximum)." }, { status: 400 });
    }
    if (!requestPropertyTypes.includes(propertyType as (typeof requestPropertyTypes)[number]) ||
        !requestUrgencies.includes(urgency as (typeof requestUrgencies)[number])) {
      return Response.json({ error: "Le type de lieu ou le niveau d’urgence est invalide." }, { status: 400 });
    }
    if (accessDetails.length > 500) {
      return Response.json({ error: "Les détails d’accès ne peuvent pas dépasser 500 caractères." }, { status: 400 });
    }
    if ([budgetMin, budgetMax].some((budget) => budget !== undefined && (!Number.isFinite(budget) || budget < 0 || budget > 1_000_000))) {
      return Response.json({ error: "Chaque budget doit être compris entre 0 et 1 000 000 DT." }, { status: 400 });
    }
    if (budgetMin !== undefined && budgetMax !== undefined && budgetMin > budgetMax) {
      return Response.json({ error: "Le budget maximum doit être supérieur ou égal au minimum." }, { status: 400 });
    }
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() || scheduledAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
      return Response.json({ error: "Choisissez une date future dans l’année à venir." }, { status: 400 });
    }
    if (photoFiles.length > maxRequestPhotos) {
      return Response.json({ error: `Vous pouvez joindre ${maxRequestPhotos} photos au maximum.` }, { status: 400 });
    }
    if (photoFiles.some((file) => file.size > MAX_ATTACHMENT_SIZE) || photoFiles.reduce((total, file) => total + file.size, 0) > maxRequestPhotoSize) {
      return Response.json({ error: "Chaque photo doit faire 5 Mo maximum et le total 15 Mo maximum." }, { status: 413 });
    }

    const [profile, artisan] = await Promise.all([
      ArtisanProfile.findOne({ userId: artisanId, verificationStatus: "VERIFIED", isAvailable: true }).select("category"),
      User.findOne({ _id: artisanId, role: "ARTISAN", isSuspended: false }).select("name"),
    ]);
    if (!profile || !artisan) {
      return Response.json({ error: "Cet artisan n’est pas disponible pour les demandes." }, { status: 404 });
    }

    const verifiedPhotos: { buffer: Buffer; mimeType: string; name: string }[] = [];
    for (const file of photoFiles) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const mimeType = detectAttachmentType(buffer);
      if (!mimeType || !allowedPhotoTypes.has(mimeType)) {
        return Response.json({ error: "Format photo non accepté. Utilisez une image JPG, PNG ou WebP valide." }, { status: 415 });
      }
      const extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[mimeType];
      const originalName = cleanAttachmentName(file.name);
      verifiedPhotos.push({ buffer, mimeType, name: `${originalName.replace(/\.[^.]+$/, "")}${extension}` });
    }

    const uploadedPhotoIds: mongoose.Types.ObjectId[] = [];
    let serviceRequest: mongoose.HydratedDocument<ServiceRequestDocument>;
    try {
      const photos: StoredRequestPhoto[] = [];
      for (const photo of verifiedPhotos) {
        const fileId = await uploadRequestAttachment(photo.buffer, photo.name, photo.mimeType);
        uploadedPhotoIds.push(fileId);
        photos.push({ fileId, name: photo.name, mimeType: photo.mimeType, size: photo.buffer.length });
      }
      serviceRequest = await ServiceRequest.create({
        clientId: user.id,
        artisanId,
        category: profile.category,
        description,
        address,
        location,
        scheduledAt,
        budgetMin,
        budgetMax,
        propertyType,
        urgency,
        accessDetails,
        photos,
        statusHistory: [{ status: "EN_ATTENTE", changedBy: user.id }],
      });
    } catch (error) {
      if (uploadedPhotoIds.length > 0) {
        try {
          await Promise.all(uploadedPhotoIds.map((fileId) => getRequestAttachmentBucket().delete(fileId)));
        } catch (cleanupError) {
          console.error("Nettoyage des photos de demande impossible :", cleanupError);
        }
      }
      throw error;
    }

    return Response.json(
      {
        request: {
          id: serviceRequest.id,
          clientId: user.id.toString(),
          artisanId,
          clientName: user.name,
          artisanName: artisan.name,
          category: profile.category,
          description: serviceRequest.description,
          address: serviceRequest.address,
          location: serviceRequest.location?.latitude !== undefined && serviceRequest.location.longitude !== undefined
            ? { latitude: serviceRequest.location.latitude, longitude: serviceRequest.location.longitude }
            : null,
          scheduledAt: serviceRequest.scheduledAt,
          budgetMin: serviceRequest.budgetMin ?? null,
          budgetMax: serviceRequest.budgetMax ?? null,
          propertyType: serviceRequest.propertyType,
          urgency: serviceRequest.urgency,
          accessDetails: serviceRequest.accessDetails,
          photos: serviceRequest.photos.map((photo: StoredRequestPhoto) => ({ id: photo.fileId.toString(), name: photo.name, size: photo.size })),
          status: serviceRequest.status,
          announcedPrice: null,
          statusHistory: serviceRequest.statusHistory,
          createdAt: serviceRequest.createdAt,
        },
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Création de demande impossible :", error);
    return Response.json({ error: "Impossible de créer la demande pour le moment." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return Response.json({ error: "Requête non autorisée." }, { status: 403 });
  }

  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour modifier une demande." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT" && user.role !== "ARTISAN") {
      return Response.json({ error: "Ce compte ne peut pas modifier les demandes." }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
    }
    if (!isRecord(body) || typeof body.id !== "string" || !mongoose.Types.ObjectId.isValid(body.id)) {
      return Response.json({ error: "La demande ou son statut est invalide." }, { status: 400 });
    }

    if (body.action === "accept-quote") {
      if (user.role !== "CLIENT") {
        return Response.json({ error: "Seul le client peut valider le devis." }, { status: 403 });
      }
      return acceptQuote(body.id, user.id);
    }

    if (typeof body.status !== "string" || !requestStatuses.includes(body.status as RequestStatus)) {
      return Response.json({ error: "La demande ou son statut est invalide." }, { status: 400 });
    }
    const newStatus = body.status as RequestStatus;
    let quoteItems: { description: string; amount: number }[] | undefined;
    let quoteTotal: number | undefined;
    let quoteValidUntil: Date | undefined;
    if (newStatus === "ACCEPTEE" && user.role === "ARTISAN") {
      if (!Array.isArray(body.quoteItems) || body.quoteItems.length < 1 || body.quoteItems.length > 20) {
        return Response.json({ error: "Ajoutez entre 1 et 20 postes à votre devis." }, { status: 400 });
      }
      quoteItems = [];
      for (const item of body.quoteItems) {
        if (!isRecord(item) || typeof item.description !== "string" || typeof item.amount !== "number" ||
            !Number.isFinite(item.amount) || item.amount < 0 || item.amount > 1_000_000 ||
            item.description.trim().length < 2 || item.description.trim().length > 200) {
          return Response.json({ error: "Vérifiez la description et le montant de chaque poste du devis." }, { status: 400 });
        }
        if (Math.abs(item.amount * 100 - Math.round(item.amount * 100)) > 1e-8) {
          return Response.json({ error: "Les montants du devis doivent être indiqués au centime près." }, { status: 400 });
        }
        quoteItems.push({ description: item.description.trim(), amount: Math.round(item.amount * 100) / 100 });
      }
      quoteTotal = Math.round(quoteItems.reduce((total, item) => total + Math.round(item.amount * 100), 0)) / 100;
      if (!Number.isFinite(quoteTotal) || quoteTotal > 1_000_000) {
        return Response.json({ error: "Le montant total du devis ne peut pas dépasser 1 000 000 DT." }, { status: 400 });
      }
      if (typeof body.quoteValidDays !== "number" || !Number.isInteger(body.quoteValidDays) || body.quoteValidDays < 1 || body.quoteValidDays > 90) {
        return Response.json({ error: "La durée de validité du devis doit être comprise entre 1 et 90 jours." }, { status: 400 });
      }
      quoteValidUntil = new Date(Date.now() + body.quoteValidDays * 24 * 60 * 60 * 1000);
    }
    const ownership = user.role === "CLIENT" ? { clientId: user.id } : { artisanId: user.id };
    const allowedFrom: Partial<Record<RequestStatus, RequestStatus[]>> = user.role === "CLIENT"
      ? { ANNULEE: ["EN_ATTENTE", "ACCEPTEE"] }
      : {
          ACCEPTEE: ["EN_ATTENTE"],
          REFUSEE: ["EN_ATTENTE"],
          EN_COURS: ["ACCEPTEE"],
          TERMINEE: ["EN_COURS"],
        };
    const previousStatuses = allowedFrom[newStatus];
    if (!previousStatuses) {
      return Response.json({ error: "Ce changement de statut n’est pas autorisé pour votre rôle." }, { status: 403 });
    }

    const updateSet: Record<string, unknown> = { status: newStatus };
    if (quoteItems && quoteTotal !== undefined && quoteValidUntil) {
      updateSet.announcedPrice = quoteTotal;
      updateSet.quoteItems = quoteItems;
      updateSet.quoteSentAt = new Date();
      updateSet.quoteValidUntil = quoteValidUntil;
    }
    const updateFilter: Record<string, unknown> = { _id: body.id, ...ownership, status: { $in: previousStatuses } };
    if (newStatus === "EN_COURS" && user.role === "ARTISAN") {
      updateFilter.$or = [
        { quoteItems: { $exists: false } },
        { quoteItems: { $size: 0 } },
        { quoteAcceptedAt: { $exists: true } },
      ];
    }
    const updated = await ServiceRequest.findOneAndUpdate(
      updateFilter,
      {
        $set: updateSet,
        $push: { statusHistory: { status: newStatus, changedBy: user.id } },
      },
      { new: true, runValidators: true },
    ).select("_id clientId artisanId category status statusHistory announcedPrice quoteItems quoteSentAt quoteValidUntil");
    if (!updated) {
      const exists = await ServiceRequest.exists({ _id: body.id, ...ownership });
      if (exists && newStatus === "EN_COURS" && user.role === "ARTISAN") {
        const requestWithQuote = await ServiceRequest.findOne({ _id: body.id, ...ownership }).select("quoteItems quoteAcceptedAt").lean();
        if (requestWithQuote?.quoteItems.length && !requestWithQuote.quoteAcceptedAt) {
          return Response.json({ error: "Le client doit valider le devis avant le début de l’intervention." }, { status: 409 });
        }
      }
      return Response.json(
        { error: exists ? "La demande a déjà changé de statut ou cette action n’est plus possible." : "Demande introuvable." },
        { status: exists ? 409 : 404 },
      );
    }

    if (quoteItems && quoteValidUntil) {
      await shareIssuedQuote(updated);
    }

    return Response.json({
      id: updated.id,
      status: updated.status,
      statusHistory: updated.statusHistory,
      announcedPrice: updated.announcedPrice ?? null,
      quoteItems: updated.quoteItems,
      quoteSentAt: updated.quoteSentAt ?? null,
      quoteValidUntil: updated.quoteValidUntil ?? null,
      quoteAcceptedAt: updated.quoteAcceptedAt ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Modification de demande impossible :", error);
    return Response.json({ error: "Impossible de modifier la demande pour le moment." }, { status: 503 });
  }
}

async function shareIssuedQuote(serviceRequest: {
  _id: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  artisanId: mongoose.Types.ObjectId;
  category: string;
  announcedPrice?: number;
  quoteValidUntil?: Date;
}) {
  let conversation;
  try {
    conversation = await Conversation.findOneAndUpdate(
      { clientId: serviceRequest.clientId, artisanId: serviceRequest.artisanId },
      { $setOnInsert: { clientId: serviceRequest.clientId, artisanId: serviceRequest.artisanId, lastMessageText: "" } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error;
    conversation = await Conversation.findOne({ clientId: serviceRequest.clientId, artisanId: serviceRequest.artisanId });
  }
  if (!conversation) throw new Error("Création de la conversation impossible.");

  const text = `L’artisan vous a envoyé un devis pour ${serviceRequest.category}. Total : ${(serviceRequest.announcedPrice ?? 0).toFixed(2)} DT. Consultez les postes et validez-le dans « Mes demandes » ; le PDF sera ensuite partagé ici.`;
  let message;
  try {
    message = await Message.findOneAndUpdate(
      { quoteMessageRequestId: serviceRequest._id },
      {
        $setOnInsert: {
          conversationId: conversation._id,
          senderId: serviceRequest.artisanId,
          text,
          quoteMessageRequestId: serviceRequest._id,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error;
    message = await Message.findOne({ quoteMessageRequestId: serviceRequest._id });
  }
  if (!message) throw new Error("Le message informant le client du devis n’a pas pu être créé.");

  await Conversation.updateOne(
    { _id: conversation._id, $or: [{ lastMessageAt: { $lte: message.createdAt } }, { lastMessageAt: { $exists: false } }] },
    {
      $set: {
        lastMessageText: message.text,
        lastMessageSenderId: message.senderId,
        lastMessageAt: message.createdAt,
      },
    },
  );
}

async function acceptQuote(requestId: string, clientId: mongoose.Types.ObjectId) {
  const serviceRequest = await ServiceRequest.findOne({ _id: requestId, clientId }).lean();
  if (!serviceRequest) return Response.json({ error: "Demande introuvable." }, { status: 404 });
  if ((!serviceRequest.quoteAcceptedAt && serviceRequest.status !== "ACCEPTEE") ||
      !serviceRequest.quoteItems.length ||
      !serviceRequest.quoteValidUntil) {
    return Response.json({ error: "Cette demande ne contient pas de devis à valider." }, { status: 409 });
  }

  let acceptedAt = serviceRequest.quoteAcceptedAt;
  if (!acceptedAt) {
    const now = new Date();
    if (serviceRequest.quoteValidUntil <= now) {
      return Response.json({ error: "La validité de ce devis a expiré." }, { status: 409 });
    }
    const acceptedRequest = await ServiceRequest.findOneAndUpdate(
      {
        _id: serviceRequest._id,
        clientId,
        status: "ACCEPTEE",
        quoteAcceptedAt: { $exists: false },
        quoteValidUntil: { $gt: now },
        quoteItems: { $exists: true, $ne: [] },
      },
      { $set: { quoteAcceptedAt: now } },
      { new: true },
    ).select("quoteAcceptedAt").lean();
    acceptedAt = acceptedRequest?.quoteAcceptedAt;
    if (!acceptedAt) {
      const currentRequest = await ServiceRequest.findOne({ _id: serviceRequest._id, clientId }).select("status quoteAcceptedAt").lean();
      if (!currentRequest?.quoteAcceptedAt) {
        return Response.json({ error: "Le devis ne peut plus être validé. Actualisez vos demandes." }, { status: 409 });
      }
      acceptedAt = currentRequest.quoteAcceptedAt;
    }
  }

  const [client, artisan, profile] = await Promise.all([
    User.findById(serviceRequest.clientId).select("name email phone").lean(),
    User.findById(serviceRequest.artisanId).select("name email phone").lean(),
    ArtisanProfile.findOne({ userId: serviceRequest.artisanId }).select("category city").lean(),
  ]);
  if (!client || !artisan) throw new Error("Les coordonnées d'un participant à la demande sont introuvables.");

  let conversation;
  try {
    conversation = await Conversation.findOneAndUpdate(
      { clientId: serviceRequest.clientId, artisanId: serviceRequest.artisanId },
      { $setOnInsert: { clientId: serviceRequest.clientId, artisanId: serviceRequest.artisanId, lastMessageText: "" } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error;
    conversation = await Conversation.findOne({ clientId: serviceRequest.clientId, artisanId: serviceRequest.artisanId });
  }
  if (!conversation) throw new Error("Création de la conversation impossible.");

  let message = await Message.findOne({ quoteRequestId: serviceRequest._id });
  if (!message) {
    const filename = `devis-quickfix-${serviceRequest._id.toString().slice(-8)}.pdf`;
    const pdf = await generateQuotePdf({
      reference: serviceRequest._id.toString(),
      createdAt: serviceRequest.quoteSentAt ?? serviceRequest.createdAt,
      acceptedAt,
      validUntil: serviceRequest.quoteValidUntil,
      client: { name: client.name, email: client.email, phone: client.phone ?? "" },
      artisan: {
        name: artisan.name,
        email: artisan.email,
        phone: artisan.phone ?? "",
        category: profile?.category ?? "",
        city: profile?.city ?? "",
      },
      category: serviceRequest.category,
      description: serviceRequest.description,
      address: serviceRequest.address,
      latitude: serviceRequest.location?.latitude,
      longitude: serviceRequest.location?.longitude,
      scheduledAt: serviceRequest.scheduledAt,
      accessDetails: serviceRequest.accessDetails,
      items: serviceRequest.quoteItems,
      total: serviceRequest.announcedPrice ?? 0,
    });
    const fileId = await uploadAttachment(pdf, filename, "application/pdf");
    try {
      message = await Message.create({
        conversationId: conversation._id,
        senderId: clientId,
        text: "Le devis a été validé par le client. Le document PDF récapitulatif est joint à ce message.",
        attachment: { fileId, name: filename, mimeType: "application/pdf", size: pdf.length },
        quoteRequestId: serviceRequest._id,
      });
    } catch (error) {
      await getMessageAttachmentBucket().delete(fileId);
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error;
      message = await Message.findOne({ quoteRequestId: serviceRequest._id });
      if (!message) throw error;
    }
  }

  await Conversation.updateOne(
    { _id: conversation._id, $or: [{ lastMessageAt: { $lte: message.createdAt } }, { lastMessageAt: { $exists: false } }] },
    {
      $set: {
        lastMessageText: message.text || `Pièce jointe : ${message.attachment?.name ?? "devis.pdf"}`,
        lastMessageSenderId: message.senderId,
        lastMessageAt: message.createdAt,
      },
    },
  );
  return Response.json({
    id: serviceRequest._id.toString(),
    quoteAcceptedAt: acceptedAt,
    conversationId: conversation._id.toString(),
    messageId: message._id.toString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
