import type { MercadoLibrePromotionOpportunity, MercadoLibreShippingCost } from "./types";
export function promotionDateMs(value?: string | null) {
  if (!value) return NaN;
  // ML's seller endpoints also send Argentina local dates without an offset.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00-03:00`);
  return Date.parse(/T/.test(value) && !/(Z|[+-]\d\d:\d\d)$/i.test(value) ? `${value}-03:00` : value);
}
export function promotionState(item: MercadoLibrePromotionOpportunity, now = Date.now()) {
  const status = String(item.item_promotion_status || item.promotion_status || "").toLowerCase();
  if (["finished", "ended", "cancelled", "deleted", "rejected"].includes(status) || promotionDateMs(item.end_date) <= now) return "finished";
  if (promotionDateMs(item.start_date) > now || status === "pending" || status === "scheduled") return "future";
  if (["started", "active"].includes(status)) return "active";
  if (["candidate", "eligible"].includes(status)) return "candidate";
  return "unknown";
}
export function promotionKey(item: MercadoLibrePromotionOpportunity) {
  return [item.meli_item_id, item.promotion_id, item.offer_id || "", item.item_promotion_status || ""].join("|");
}
export function comparisonPromotionKey(item: { itemId?: string | null; promotionId?: string | null; offerId?: string | null; status: string; key: string }) {
  return item.promotionId ? [item.itemId || '', item.promotionId, item.offerId || '', item.status].join('|') : item.key;
}
export function dedupePromotions(items: MercadoLibrePromotionOpportunity[]) {
  const byKey = new Map<string, MercadoLibrePromotionOpportunity>();
  for (const item of items) {
    const previous = byKey.get(promotionKey(item));
    if (!previous || !Number.isFinite(promotionDateMs(previous.last_sync_at)) || promotionDateMs(item.last_sync_at) >= promotionDateMs(previous.last_sync_at)) byKey.set(promotionKey(item), item);
  }
  return [...byKey.values()];
}
export function promotionCoverage(publication: MercadoLibreShippingCost) {
  const entries = Array.isArray(publication.meli_promotions) ? publication.meli_promotions : [];
  const endpoint = `/seller-promotions/items/${publication.meli_item_id}`;
  const exact = entries.filter((entry: any) => entry?.endpoint === endpoint || entry?.endpoint?.startsWith(`${endpoint}?`)) as Array<{ data?: unknown; error?: string; checked_at?: string }>;
  const latest = exact.at(-1);
  if (!latest) return { known: false, state: "Sin consultar", at: null };
  if (!validPromotionPayload(entries, publication.meli_item_id || '')) return { known: false, state: "Consulta fallida o incompleta", at: latest.checked_at || null };
  return { known: true, state: "Consulta completa", at: latest.checked_at || null };
}
export function validPromotionPayload(raw: unknown, itemId: string) {
  if (!Array.isArray(raw)) return false;
  const entry = raw.filter((entry: any) => entry?.endpoint === `/seller-promotions/items/${itemId}` || entry?.endpoint?.startsWith(`/seller-promotions/items/${itemId}?`)).at(-1);
  return Boolean(entry && !entry.error && Array.isArray(entry.data) && entry.data.every((promo: any) =>
    promo && typeof promo === 'object' && (promo.id || promo.type) && typeof promo.status === 'string'));
}
export function validThresholds(red: number, yellow: number) {
  return Number.isFinite(red) && Number.isFinite(yellow) && red >= -100 && yellow <= 100 && red <= yellow;
}
