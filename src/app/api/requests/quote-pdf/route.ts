import mongoose from "mongoose";
import { getAuthenticatedUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { generateQuotePdf } from "@/lib/quote-pdf";
import { ArtisanProfile } from "@/models/artisan-profile";
import { ServiceRequest } from "@/models/service-request";
import { User } from "@/models/user";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Connectez-vous pour télécharger ce devis." }, { status: 401 });
    if (user.mustChangePassword) return Response.json({ error: "Changez votre mot de passe avant de continuer." }, { status: 403 });
    if (user.role !== "CLIENT" && user.role !== "ARTISAN") {
      return Response.json({ error: "Ce devis est réservé au client et à l’artisan concernés." }, { status: 403 });
    }

    const requestId = new URL(request.url).searchParams.get("requestId");
    if (!requestId || !mongoose.Types.ObjectId.isValid(requestId)) {
      return Response.json({ error: "La demande sélectionnée est invalide." }, { status: 400 });
    }
    const ownership = user.role === "CLIENT" ? { clientId: user.id } : { artisanId: user.id };
    const serviceRequest = await ServiceRequest.findOne({ _id: requestId, ...ownership }).lean();
    if (!serviceRequest) return Response.json({ error: "Demande introuvable." }, { status: 404 });

    const quoteItems = Array.isArray(serviceRequest.quoteItems) ? serviceRequest.quoteItems : [];
    const items = quoteItems.length > 0
      ? quoteItems
      : typeof serviceRequest.announcedPrice === "number" && Number.isFinite(serviceRequest.announcedPrice)
        ? [{ description: "Montant global annoncé (détail non fourni)", amount: serviceRequest.announcedPrice }]
        : [];
    if (!items.length) return Response.json({ error: "Aucun devis n’est enregistré pour cette demande." }, { status: 404 });
    const total = serviceRequest.announcedPrice ?? items.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0);

    const [client, artisan, profile] = await Promise.all([
      User.findById(serviceRequest.clientId).select("name email phone").lean(),
      User.findById(serviceRequest.artisanId).select("name email phone").lean(),
      ArtisanProfile.findOne({ userId: serviceRequest.artisanId }).select("category city").lean(),
    ]);
    if (!client || !artisan) {
      console.error("Téléchargement PDF du devis impossible : participant introuvable.");
      return Response.json({ error: "Les coordonnées d’un participant sont introuvables." }, { status: 503 });
    }

    const pdf = await generateQuotePdf({
      reference: serviceRequest._id.toString(),
      createdAt: serviceRequest.quoteSentAt ?? serviceRequest.createdAt,
      acceptedAt: serviceRequest.quoteAcceptedAt,
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
      items,
      total,
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `inline; filename="devis-quickfix-${serviceRequest._id.toString().slice(-8)}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Génération du PDF de devis impossible :", error);
    return Response.json({ error: "Impossible de générer le PDF du devis pour le moment." }, { status: 503 });
  }
}
