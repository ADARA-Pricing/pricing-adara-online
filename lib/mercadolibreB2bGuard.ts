import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { calculatePriceSummary, defaultTaxSettings, mercadoLibreClassicOption } from "@/lib/pricing";

type PriceNode = {
  id?: string | null;
  type?: string | null;
  amount?: number | null;
  currency_id?: string | null;
  conditions?: { context_restrictions?: string[] | null; min_purchase_unit?: number | null } | null;
};

// Se ejecuta después de sincronizar ML. Sólo pausa rangos que fueron aprobados
// con aporte de ML y cuyo aporte actual bajó o desapareció. No toca mayoristas
// que se hayan configurado originalmente sin aporte.
export async function pauseB2bRangesWithoutContribution() {
  const supabase = createAdminClient();
  const { data: rules, error } = await supabase
    .from("mercadolibre_b2b_margin_guard")
    .select("meli_item_id, minimum_purchase_unit, sku, target_margin_rate, required_meli_contribution")
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

  const account = await getConnectedMeliAccount();
  if (!account) throw new Error("Primero conectá MercadoLibre.");

  // Segundo corte de seguridad: el monto B2B efectivo que devuelve ML debe
  // conservar el margen registrado al momento de aprobar el rango. El cálculo
  // usa el precio de venta B2B real, el aporte actual y el envío bonificado.
  const { data: products } = await supabase.from("products").select("*").in("sku", [...new Set(rules.map((rule) => String(rule.sku || "")))]);
  const { data: categoryFees } = await supabase.from("mercadolibre_category_fees").select("*").eq("active", true);
  const { data: taxRow } = await supabase.from("tax_settings").select("*").eq("key", "default").maybeSingle();
  const { data: channelSettings } = await supabase.from("product_channel_margins").select("*").eq("channel_code", "MC");
  const productBySku = new Map((products || []).map((product: any) => [String(product.sku || "").toUpperCase(), product]));
  const publicationByItem = new Map((publications || []).map((publication: any) => [String(publication.meli_item_id || ""), publication]));
  const settingsByProduct = new Map((channelSettings || []).map((setting: any) => [String(setting.product_id || ""), setting]));
  const taxes = taxRow || defaultTaxSettings();
  const rulesStillActive = rules.filter((rule) => !toPause.some((paused) => paused.meli_item_id === rule.meli_item_id && paused.minimum_purchase_unit === rule.minimum_purchase_unit));
  const marginFailures: typeof rules = [];

  for (const itemId of [...new Set(rulesStillActive.map((rule) => String(rule.meli_item_id)))]) {
    const itemRules = rulesStillActive.filter((rule) => String(rule.meli_item_id) === itemId);
    const product = productBySku.get(String(itemRules[0]?.sku || "").toUpperCase());
    const publication: any = publicationByItem.get(itemId);
    if (!product || !publication) continue;
    try {
      const priceData = await meliFetch(`/items/${itemId}/prices?display_version=true`, account, { headers: { "show-all-prices": "true" } }) as { prices?: PriceNode[] | null };
      const standardAmount = Number((priceData.prices || []).find((price) => price.type === "standard")?.amount || 0);
      const quantities = itemRules.map((rule) => Number(rule.minimum_purchase_unit));
      const recommendations = await meliFetch("/prices-per-quantity/v1/recommendations", account, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, range_item_quantities: quantities, price: { standard_amount: standardAmount, currency: publication.meli_currency_id || "ARS" } }),
      }) as { recommendations?: Array<{ quantity?: number | null; shipping?: { cost?: number | null } | null }> | null };
      const shippingByQuantity = new Map((recommendations.recommendations || []).map((entry) => [Number(entry.quantity || 0), Number(entry.shipping?.cost || 0) / Number(entry.quantity || 1)]));
      const categoryFee = (categoryFees || []).find((fee: any) => String(fee.category || "").toLowerCase() === String(product.category || "").toLowerCase()) || null;
      const setting: any = settingsByProduct.get(String(product.id || ""));
      for (const rule of itemRules) {
        const quantity = Number(rule.minimum_purchase_unit);
        const sale = await meliFetch(`/items/${itemId}/sale_price?context=channel_marketplace,user_type_business&quantity=${quantity}`, account) as { amount?: number | null };
        const b2bPrice = Number(sale.amount || 0);
        if (!b2bPrice) continue;
        const result: any = calculatePriceSummary(product, mercadoLibreClassicOption(), categoryFee, taxes as any, {
          ...publication,
          shipping_cost_amount: Number(shippingByQuantity.get(quantity) || 0),
        }, {
          desiredMarginRate: 0,
          structureAmount: Number(setting?.structure_amount || 0),
          manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
          salesCommissionRate: Number(setting?.sales_commission_rate || 0),
          saleAppliesVat: setting?.sale_applies_vat ?? true,
          costVatRate: Number(setting?.cost_vat_rate || 0),
          salePrice: b2bPrice + Number(contributionByItem.get(itemId) || 0),
        });
        if (result.valid && Number(result.marginOnNetSale || 0) < Number(rule.target_margin_rate || 0) - 0.001) marginFailures.push(rule);
      }
    } catch {
      // Si ML no responde, no se pausa a ciegas: se reintenta en la próxima sync.
    }
  }
  toPause.push(...marginFailures);
  if (!toPause.length) {
    await supabase.from("mercadolibre_b2b_margin_guard").update({ last_checked_at: new Date().toISOString() }).eq("active", true);
    return { checked: rules.length, paused: 0 };
  }
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
    const hasContributionFailure = toPause.some((rule) => String(rule.meli_item_id) === itemId && Number(contributionByItem.get(itemId) || 0) < Number(rule.required_meli_contribution || 0) - 1);
    await supabase.from("mercadolibre_b2b_margin_guard")
      .update({ active: false, paused_at: now, paused_reason: hasContributionFailure ? "Aporte de Mercado Libre reducido o finalizado" : "Margen real menor al margen de referencia", last_checked_at: now, updated_at: now })
      .eq("meli_item_id", itemId)
      .in("minimum_purchase_unit", quantities);
    paused += quantities.length;
  }
  return { checked: rules.length, paused };
}
