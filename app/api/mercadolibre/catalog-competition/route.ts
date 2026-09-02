import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";

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
        .select("sku,meli_item_id,meli_title,meli_catalog_product_id")
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
          invoiceA: invoiceA(item),
          isOwn: itemId === requestedItemId,
        };
      });
      return NextResponse.json({ ok: true, own: { sku: own.sku, itemId: requestedItemId, title: own.meli_title, catalogProductId: own.meli_catalog_product_id }, competitors });
    }

    const { data, error } = await supabase
      .from("mercadolibre_shipping_costs")
      .select("product_id,sku,meli_item_id,meli_title,meli_thumbnail,meli_permalink,meli_price,meli_catalog_product_id,meli_catalog_listing,meli_status,meli_catalog_status,meli_catalog_price_to_win,meli_catalog_current_price,meli_catalog_reason,meli_logistic_type")
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
    return NextResponse.json({ ok: true, rows, total: rows.length, refreshedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar la competencia." }, { status: 500 });
  }
}
