import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { createAdminClient } from "@/lib/supabaseAdmin";

type PriceNode = {
  id?: string | null;
  conditions?: { context_restrictions?: string[] | null; min_purchase_unit?: number | null } | null;
};

// Se ejecuta después de sincronizar ML. Sólo pausa rangos que fueron aprobados
// con aporte de ML y cuyo aporte actual bajó o desapareció. No toca mayoristas
// que se hayan configurado originalmente sin aporte.
export async function pauseB2bRangesWithoutContribution() {
  const supabase = createAdminClient();
  const { data: rules, error } = await supabase
    .from("mercadolibre_b2b_margin_guard")
    .select("meli_item_id, minimum_purchase_unit, required_meli_contribution")
    .eq("active", true)
    .gt("required_meli_contribution", 0);
  if (error) throw new Error(error.message);
  if (!rules?.length) return { checked: 0, paused: 0 };

  const itemIds = [...new Set(rules.map((rule) => String(rule.meli_item_id || "")).filter(Boolean))];
  const { data: publications, error: publicationError } = await supabase
    .from("mercadolibre_shipping_costs")
    .select("meli_item_id, meli_promo_meli_amount")
    .in("meli_item_id", itemIds);
  if (publicationError) throw new Error(publicationError.message);
  const contributionByItem = new Map((publications || []).map((publication) => [
    String(publication.meli_item_id || ""),
    Number(publication.meli_promo_meli_amount || 0),
  ]));
  const toPause = rules.filter((rule) =>
    Number(contributionByItem.get(String(rule.meli_item_id)) || 0) < Number(rule.required_meli_contribution || 0) - 1,
  );
  if (!toPause.length) {
    await supabase.from("mercadolibre_b2b_margin_guard").update({ last_checked_at: new Date().toISOString() }).eq("active", true);
    return { checked: rules.length, paused: 0 };
  }

  const account = await getConnectedMeliAccount();
  if (!account) throw new Error("Primero conectá MercadoLibre.");
  let paused = 0;
  for (const itemId of [...new Set(toPause.map((rule) => String(rule.meli_item_id)))]) {
    const quantities = toPause.filter((rule) => String(rule.meli_item_id) === itemId).map((rule) => Number(rule.minimum_purchase_unit));
    const priceData = await meliFetch(`/items/${itemId}/prices?display_version=true`, account, {
      headers: { "show-all-prices": "true" },
    }) as { version?: number | null; prices?: PriceNode[] | null; price_per_quantity?: PriceNode[] | null };
    const ranges = Array.isArray(priceData.price_per_quantity) ? priceData.price_per_quantity : [];
    const fixedRanges = Array.isArray(priceData.prices) ? priceData.prices : [];
    const remaining = ranges
      .filter((range) => !(
        range.conditions?.context_restrictions?.includes("user_type_business")
        && quantities.includes(Number(range.conditions?.min_purchase_unit || 0))
      ))
      .map((range) => range.id ? { id: range.id } : null)
      .filter((range): range is { id: string } => Boolean(range));
    const hasPercentageB2b = ranges.some((range) =>
      range.conditions?.context_restrictions?.includes("user_type_business")
      && quantities.includes(Number(range.conditions?.min_purchase_unit || 0)),
    );
    if (hasPercentageB2b) {
      await meliFetch(`/items/${itemId}/prices/price-per-quantity`, account, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Version": String(priceData.version) },
        body: JSON.stringify({ price_per_quantity: remaining }),
      });
    } else {
      const fixedRemaining = fixedRanges
        .filter((range) => !(
          range.conditions?.context_restrictions?.includes("user_type_business")
          && quantities.includes(Number(range.conditions?.min_purchase_unit || 0))
        ))
        .map((range) => range.id ? { id: range.id } : null)
        .filter((range): range is { id: string } => Boolean(range));
      await meliFetch(`/items/${itemId}/prices/standard/quantity`, account, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Version": String(priceData.version) },
        body: JSON.stringify({ prices: fixedRemaining }),
      });
    }
    const now = new Date().toISOString();
    await supabase.from("mercadolibre_b2b_margin_guard")
      .update({ active: false, paused_at: now, paused_reason: "Aporte de Mercado Libre reducido o finalizado", last_checked_at: now, updated_at: now })
      .eq("meli_item_id", itemId)
      .in("minimum_purchase_unit", quantities);
    paused += quantities.length;
  }
  return { checked: rules.length, paused };
}
