import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";
import { calculatePriceSummary, defaultTaxSettings, mercadoLibreClassicOption } from "@/lib/pricing";
import type { MercadoLibreCategoryFee, Product, TaxSettings } from "@/lib/types";

type SaleTerm = { id?: string | null; value_name?: string | null; value_id?: string | null };
type CatalogWinner = {
  item_id?: string | null;
  price?: number | null;
  currency_id?: string | null;
  boosts?: Array<{ id?: string | null; status?: string | null }> | null;
};
type PriceToWin = {
  current_price?: number | null;
  price_to_win?: number | null;
  status?: string | null;
  catalog_product_id?: string | null;
  winner?: CatalogWinner | null;
  boosts?: CatalogWinner["boosts"];
  reason?: string[] | null;
};
type MeliItem = {
  id?: string | null;
  seller_id?: number | null;
  permalink?: string | null;
  title?: string | null;
  shipping?: { logistic_type?: string | null } | null;
  international_delivery_mode?: string | null;
  sale_terms?: SaleTerm[] | null;
};

function isFull(boosts?: CatalogWinner["boosts"], item?: MeliItem | null) {
  return boosts?.some((boost) => boost.id === "fulfillment" && boost.status === "boosted")
    || item?.shipping?.logistic_type === "fulfillment";
}

function invoiceA(item?: MeliItem | null) {
  const invoice = item?.sale_terms?.find((term) => term.id === "INVOICE");
  if (!invoice) return null;
  return /factura\s*a/i.test(String(invoice.value_name || ""));
}

async function mapWithConcurrency<T, R>(rows: T[], limit: number, task: (row: T) => Promise<R>) {
  const result: R[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (index < rows.length) {
      const current = index++;
      result[current] = await task(rows[current]);
    }
  }));
  return result;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser();
    const account = await getConnectedMeliAccount();
    if (!account) return NextResponse.json({ error: "Primero conectá Mercado Libre." }, { status: 400 });

    const supabase = createAdminClient();
    const requestedItemId = String(request.nextUrl.searchParams.get("itemId") || "").toUpperCase();

    if (requestedItemId) {
      if (!/^MLA\d+$/.test(requestedItemId)) return NextResponse.json({ error: "Publicación inválida." }, { status: 400 });
      const { data: own, error: ownError } = await supabase
        .from("mercadolibre_shipping_costs")
        .select("sku,meli_item_id,meli_title,meli_thumbnail,meli_price,meli_promo_status,meli_promo_name,meli_promo_price,meli_promo_meli_amount,meli_promo_meli_rate,meli_catalog_product_id")
        .eq("active", true)
        .eq("meli_catalog_listing", true)
        .eq("meli_item_id", requestedItemId)
        .maybeSingle();
      if (ownError) throw new Error(ownError.message);
      if (!own?.meli_catalog_product_id) return NextResponse.json({ error: "Esta publicación no pertenece a un catálogo activo." }, { status: 404 });

      const catalog = await meliFetch(`/products/${own.meli_catalog_product_id}/items?limit=5`, account) as { results?: Array<MeliItem & { item_id?: string | null; price?: number | null }> };
      const competitors = await mapWithConcurrency(catalog.results || [], 5, async (item) => {
        const itemId = String(item.item_id || item.id || "").toUpperCase();
        let nickname: string | null = null;
        if (item.seller_id) {
          try {
            const seller = await meliFetch(`/users/${item.seller_id}`, account) as { nickname?: string | null };
            nickname = seller.nickname || null;
          } catch { /* El ranking sigue disponible aunque el perfil comercial no responda. */ }
        }
        return {
          itemId,
          price: Number(item.price || 0) || null,
          nickname,
          permalink: item.permalink || null,
          full: item.shipping?.logistic_type === "fulfillment",
          international: Boolean(item.international_delivery_mode && item.international_delivery_mode !== "none"),
          invoiceA: invoiceA(item),
          isOwn: itemId === requestedItemId,
        };
      });
      return NextResponse.json({ ok: true, own: { sku: own.sku, itemId: requestedItemId, title: own.meli_title, thumbnail: own.meli_thumbnail, price: own.meli_price, promo: own.meli_promo_status ? { name: own.meli_promo_name, price: own.meli_promo_price, meliAmount: own.meli_promo_meli_amount, meliRate: own.meli_promo_meli_rate } : null, catalogProductId: own.meli_catalog_product_id }, competitors });
    }

    const { data, error } = await supabase
      .from("mercadolibre_shipping_costs")
      .select("product_id,sku,meli_item_id,meli_title,meli_thumbnail,meli_permalink,meli_price,meli_catalog_product_id,meli_catalog_listing,meli_status,meli_catalog_status,meli_catalog_price_to_win,meli_catalog_current_price,meli_catalog_reason,meli_logistic_type,fixed_fee_amount,shipping_cost_amount,free_shipping,active")
      .eq("active", true)
      .eq("meli_catalog_listing", true)
      .eq("meli_status", "active")
      .not("meli_item_id", "is", null)
      .order("sku")
      .limit(1000);
    if (error) throw new Error(error.message);

    const rows = (data || []).filter((row) => /^MLA\d+$/.test(String(row.meli_item_id || ""))).map((row) => ({
      sku: row.sku,
      itemId: row.meli_item_id,
      title: row.meli_title,
      thumbnail: row.meli_thumbnail,
      permalink: row.meli_permalink,
      catalogProductId: row.meli_catalog_product_id,
      ownPrice: Number(row.meli_catalog_current_price || row.meli_price || 0) || null,
      priceToWin: Number(row.meli_catalog_price_to_win || 0) || null,
      status: row.meli_catalog_status || "unknown",
      ownFull: row.meli_logistic_type === "fulfillment",
      reason: Array.isArray(row.meli_catalog_reason) ? row.meli_catalog_reason : [],
    }));

    if (request.nextUrl.searchParams.get("summary") === "1") {
      const [productsResponse, feesResponse, taxesResponse] = await Promise.all([
        supabase.from("products").select("*").neq("status", "discontinued"),
        supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
        supabase.from("tax_settings").select("*").eq("key", "default").maybeSingle(),
      ]);
      if (productsResponse.error || feesResponse.error || taxesResponse.error) throw new Error(productsResponse.error?.message || feesResponse.error?.message || taxesResponse.error?.message || "No se pudo calcular la rentabilidad.");
      const productsBySku = new Map((productsResponse.data || []).map((product) => [String(product.sku), product as Product]));
      const feesByCategory = new Map((feesResponse.data || []).map((fee) => [String(fee.category), fee as MercadoLibreCategoryFee]));
      const taxes = (taxesResponse.data || defaultTaxSettings()) as TaxSettings;
      const grouped = new Map<string, typeof rows>();
      for (const row of rows) grouped.set(row.sku, [...(grouped.get(row.sku) || []), row]);
      const summaries = await mapWithConcurrency([...grouped.entries()], 5, async ([sku, publications]) => {
        const reference = [...publications].sort((a, b) => Number(a.ownPrice || Infinity) - Number(b.ownPrice || Infinity))[0];
        const groupedStatus = publications.some((publication) => publication.status === "winning")
          ? "winning"
          : publications.some((publication) => publication.status === "sharing_first_place")
            ? "sharing_first_place"
            : reference.status;
        const alreadyWinning = groupedStatus === "winning" || groupedStatus === "sharing_first_place";
        try {
          const catalog = await meliFetch(`/products/${reference.catalogProductId}/items?limit=50`, account) as { results?: Array<MeliItem & { item_id?: string | null; price?: number | null }> };
          const ownIds = new Set(publications.map((publication) => String(publication.itemId).toUpperCase()));
          const lowestCompetitor = (catalog.results || [])
            .filter((item) => !ownIds.has(String(item.item_id || item.id || "").toUpperCase()))
            .map((item) => Number(item.price || 0))
            .filter((price) => price > 0)
            .sort((a, b) => a - b)[0] || null;
          const product = productsBySku.get(sku);
          const shipping = (data || []).find((item) => String(item.meli_item_id) === String(reference.itemId));
          const suggestedPrice = alreadyWinning
            ? Number(reference.ownPrice || 0) || null
            : lowestCompetitor ? Math.max(1, Math.floor(lowestCompetitor - 100)) : null;
          const profitability = product && shipping && suggestedPrice
            ? calculatePriceSummary(product, mercadoLibreClassicOption(), feesByCategory.get(String(product.category)) || null, taxes, shipping, { salePrice: suggestedPrice })
            : null;
          const marginAtSuggested = profitability?.valid ? profitability.marginOnNetSale : null;
          const currentProfitability = product && shipping && reference.ownPrice
            ? calculatePriceSummary(product, mercadoLibreClassicOption(), feesByCategory.get(String(product.category)) || null, taxes, shipping, { salePrice: reference.ownPrice })
            : null;
          const currentMargin = currentProfitability?.valid ? currentProfitability.marginOnNetSale : null;
          const action = alreadyWinning ? "ya_ganando"
            : !suggestedPrice ? "sin_competidor"
            : Number(reference.ownPrice || 0) > suggestedPrice
              ? Number(marginAtSuggested || 0) >= 5 ? "bajar_y_ganar" : "caro_sin_margen"
              : Number(reference.ownPrice || 0) < suggestedPrice
                ? Number(marginAtSuggested || 0) >= 5 ? "subir_y_seguir_ganando" : "barato_sin_margen"
                : "en_precio";
          return { ...reference, status: groupedStatus, sku, publicationCount: publications.length, lowestCompetitor, suggestedPrice, marginAtSuggested, currentMargin, action };
        } catch {
          return { ...reference, status: groupedStatus, sku, publicationCount: publications.length, lowestCompetitor: null, suggestedPrice: null, marginAtSuggested: null, currentMargin: null, action: alreadyWinning ? "ya_ganando" : "sin_competidor" };
        }
      });
      return NextResponse.json({ ok: true, rows: summaries, total: summaries.length, refreshedAt: new Date().toISOString() });
    }
    return NextResponse.json({ ok: true, rows, total: rows.length, refreshedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar la competencia." }, { status: 500 });
  }
}
