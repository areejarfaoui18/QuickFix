/** The cities an artisan can work in: the capital of each of Tunisia's 24 governorates. */
export const tunisianCities = [
  "Tunis", "Ariana", "Ben Arous", "Manouba", "Nabeul", "Zaghouan", "Bizerte", "Béja",
  "Jendouba", "Le Kef", "Siliana", "Sousse", "Monastir", "Mahdia", "Sfax", "Kairouan",
  "Kasserine", "Sidi Bouzid", "Gabès", "Médenine", "Tataouine", "Gafsa", "Tozeur", "Kébili",
] as const;

export type TunisianCity = (typeof tunisianCities)[number];

// Other spellings people (and the assistant's model) use, including the Arabic names.
const aliases: Record<string, TunisianCity> = {
  "تونس": "Tunis", "اريانة": "Ariana", "أريانة": "Ariana", "بن عروس": "Ben Arous", "منوبة": "Manouba",
  "la manouba": "Manouba", "نابل": "Nabeul", "زغوان": "Zaghouan", "بنزرت": "Bizerte", "باجة": "Béja",
  "جندوبة": "Jendouba", "الكاف": "Le Kef", "kef": "Le Kef", "el kef": "Le Kef", "سليانة": "Siliana",
  "سوسة": "Sousse", "المنستير": "Monastir", "المهدية": "Mahdia", "صفاقس": "Sfax", "القيروان": "Kairouan",
  "القصرين": "Kasserine", "سيدي بوزيد": "Sidi Bouzid", "قابس": "Gabès", "مدنين": "Médenine", "medenine": "Médenine",
  "تطاوين": "Tataouine", "قفصة": "Gafsa", "توزر": "Tozeur", "قبلي": "Kébili", "kebili": "Kébili",
};

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[\s-]+/g, " ").trim().toLowerCase();
}

/** Finds a city of the list mentioned anywhere in a sentence ("je suis à sfax" → "Sfax"), or null. */
export function findCityInText(text: string): TunisianCity | null {
  const sentence = ` ${normalize(text.replace(/[^\p{L}\p{M}\s-]/gu, " "))} `;
  const names: [string, TunisianCity][] = [...tunisianCities.map((city): [string, TunisianCity] => [city, city]), ...Object.entries(aliases)];
  // Longest names first, so "Sidi Bouzid" is not cut short by a shorter match.
  return names.sort((left, right) => right[0].length - left[0].length).find(([name]) => sentence.includes(` ${normalize(name)} `))?.[1] ?? null;
}

/** Returns the official spelling of a city ("sfax", "SFAX", "صفاقس" → "Sfax"), or null if it is not in the list. */
export function canonicalCity(value: unknown): TunisianCity | null {
  if (typeof value !== "string") return null;
  const wanted = normalize(value);
  if (!wanted) return null;
  return tunisianCities.find((city) => normalize(city) === wanted)
    ?? Object.entries(aliases).find(([alias]) => normalize(alias) === wanted)?.[1]
    ?? null;
}
