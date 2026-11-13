import { connectToDatabase } from "@/lib/mongodb";
import { createSession, hasSameOrigin, sessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { ArtisanProfile } from "@/models/artisan-profile";
import { User } from "@/models/user";

const artisanCategories = ["Plomberie", "Électricité", "Climatisation", "Peinture", "Ménage", "Serrurerie"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return Response.json({ error: "Requête non autorisée." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
  }
  if (!isRecord(body)) {
    return Response.json({ error: "Les informations envoyées sont invalides." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const phoneDigits = phone.replace(/\D/g, "");
  const role = body.role === "ARTISAN" ? "ARTISAN" : body.role === "CLIENT" ? "CLIENT" : null;
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const bio = typeof body.bio === "string" ? body.bio.trim() : "";
  if (!role) {
    return Response.json({ error: "Choisissez un type de compte : client ou artisan." }, { status: 400 });
  }
  if (name.length < 2 || name.length > 100) {
    return Response.json({ error: "Le nom doit contenir entre 2 et 100 caractères." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return Response.json({ error: "L'adresse e-mail n'est pas valide." }, { status: 400 });
  }
  if (password.length < 12 || password.length > 128 || Buffer.byteLength(password, "utf8") > 256) {
    return Response.json({ error: "Le mot de passe doit contenir entre 12 et 128 caractères." }, { status: 400 });
  }
  if (
    phone.length > 30 ||
    (phone.length > 0 && !/^[+()\d\s.-]{6,30}$/.test(phone)) ||
    (role === "ARTISAN" && phoneDigits.length < 6)
  ) {
    return Response.json({ error: "Vérifiez le numéro de téléphone. Il est obligatoire pour un artisan." }, { status: 400 });
  }
  if (
    role === "ARTISAN" &&
    (!artisanCategories.includes(category as (typeof artisanCategories)[number]) ||
      city.length < 2 ||
      city.length > 80 ||
      bio.length > 1200)
  ) {
    return Response.json({ error: "Vérifiez la filière, la ville et la présentation de l’artisan." }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const user = await User.create({
      name,
      email,
      phone,
      passwordHash: await hashPassword(password),
      role,
      emailVerified: true,
      isSuspended: role === "ARTISAN",
      suspensionReason: role === "ARTISAN" ? "Attente de validation administrative" : "",
      mustChangePassword: false,
    });

    try {
      if (role === "ARTISAN") {
        await ArtisanProfile.create({
          userId: user._id,
          category,
          city,
          bio,
          isAvailable: true,
          verificationStatus: "PENDING",
        });
      }
    } catch (error) {
      if (role === "ARTISAN") await ArtisanProfile.deleteOne({ userId: user._id });
      await User.deleteOne({ _id: user._id });
      throw error;
    }

    if (role === "ARTISAN") {
      return Response.json(
        {
          pendingApproval: true,
          message: "Votre profil a été transmis à l’administration. Vous pourrez vous connecter après son approbation.",
        },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    }

    let token: string;
    try {
      token = await createSession(user._id);
    } catch (error) {
      await User.deleteOne({ _id: user._id });
      throw error;
    }
    return Response.json(
      {
        user: { id: user.id, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword },
      },
      { status: 201, headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isRecord(error) && error.code === 11000) {
      return Response.json({ error: "Un compte utilise déjà cette adresse e-mail." }, { status: 409 });
    }
    console.error("Inscription impossible :", error);
    return Response.json({ error: error instanceof Error ? error.message : "Impossible de créer le compte pour le moment." }, { status: 503 });
  }
}
