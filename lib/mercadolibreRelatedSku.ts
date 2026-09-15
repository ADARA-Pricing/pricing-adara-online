type RelatedItem = {
  id: string;
  seller_id?: number;
  variations?: unknown[];
  item_relations?: Array<{ id?: string; variation_id?: number | null }>;
};

export function relatedItemSkus<T extends RelatedItem>(item: T, items: Map<string, T>, ownSkus: (item: T) => string[]): string[] {
  const direct = ownSkus(item);
  if (direct.length || item.variations?.length) return direct;
  const candidates = new Set<string>();
  for (const relation of item.item_relations || []) {
    const related = items.get(relation.id || "");
    if (!related || !item.seller_id || related.seller_id !== item.seller_id || relation.variation_id != null || related.variations?.length) continue;
    if (!related.item_relations?.some((back) => back.id === item.id && back.variation_id == null)) continue;
    for (const sku of ownSkus(related)) candidates.add(sku);
  }
  return candidates.size === 1 ? [...candidates] : [];
}
