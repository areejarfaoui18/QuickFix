import { getAuthenticatedUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { ArtisanProfile } from "@/models/artisan-profile";
import { User } from "@/models/user";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) return Response.json({ error: "Connectez-vous pour consulter votre profil." }, { status: 401 });

    const account = await User.findById(authenticatedUser.id).select("name email phone role").lean();
    if (!account) return Response.json({ error: "Ce compte est introuvable." }, { status: 404 });

    const artisanProfile = account.role === "ARTISAN"
      ? await ArtisanProfile.findOne({ userId: account._id }).select("category city bio indicativePriceMin indicativePriceMax").lean()
      : null;

    return Response.json({
      profile: {
        name: account.name,
        email: account.email,
        phone: account.phone ?? "",
        role: account.role,
        artisan: artisanProfile ? {
          category: artisanProfile.category,
          city: artisanProfile.city,
          bio: artisanProfile.bio,
          indicativePriceMin: artisanProfile.indicativePriceMin ?? null,
          indicativePriceMax: artisanProfile.indicativePriceMax ?? null,
        } : null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Chargement du profil impossible :", error);
    return Response.json({ error: "Impossible de charger votre profil pour le moment." }, { status: 503 });
  }
}
