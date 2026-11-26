export const MARKETPLACE_CATEGORIES = ["Plomberie", "Électricité", "Climatisation", "Peinture", "Ménage", "Serrurerie"] as const;
export const MARKETPLACE_COMMISSION_PERCENT = 5;

export function calculateCommissionCents(priceCents: number): number {
  return Math.round(priceCents * MARKETPLACE_COMMISSION_PERCENT / 100);
}