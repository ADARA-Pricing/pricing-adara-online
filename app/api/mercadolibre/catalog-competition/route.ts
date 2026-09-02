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

    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 120);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 120, 200));
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("mercadolibre_shipping_costs")
      .select("product_id,sku,meli_item_id,meli_title,meli_thumbnail,meli_permalink,meli_price,meli_catalog_product_id,meli_catalog_listing,meli_status")
      .eq("active", true)
      .eq("meli_catalog_listing", true)
      .eq("meli_status", "active")
      .not("meli_item_id", "is", null)
      .order("sku")
      .limit(limit);
    if (error) throw new Error(error.message);

    const rows = (data || []).filter((row) => /^MLA\d+$/.test(String(row.meli_item_id || "")));
    const competition = await mapWithConcurrency(rows, 6, async (row) => {
      const itemId = String(row.meli_item_id);
      try {
        const detail = await meliFetch(`/items/${itemId}/price_to_win?version=v2`, account) as PriceToWin;
        const winnerId = String(detail.winner?.item_id || "").toUpperCase() || null;
        const ownWinner = winnerId === itemId;
        let winnerItem: MeliItem | null = null;
        let winnerNickname: string | null = null;
        if (winnerId) {
          winnerItem = await meliFetch(`/items/${winnerId}`, account) as MeliItem;
          if (winnerItem.seller_id) {
            try {
              const seller = await meliFetch(`/users/${winnerItem.seller_id}`, account) as { nickname?: string | null };
              winnerNickname = seller.nickname || null;
            } catch {
              // El nombre comercial es complementario: mantenemos precio y condiciones aunque ML no lo devuelva.
            }
          }
        }
        return {
          sku: row.sku,
          itemId,
          title: row.meli_title,
          thumbnail: row.meli_thumbnail,
          permalink: row.meli_permalink,
          catalogProductId: detail.catalog_product_id || row.meli_catalog_product_id,
          ownPrice: Number(detail.current_price || row.meli_price || 0) || null,
          priceToWin: Number(detail.price_to_win || 0) || null,
          status: detail.status || "unknown",
          ownFull: isFull(detail.boosts),
          reason: detail.reason || [],
          winner: winnerId ? {
            itemId: winnerId,
            price: Number(detail.winner?.price || 0) || null,
            nickname: winnerNickname,
            permalink: winnerItem?.permalink || null,
            full: isFull(detail.winner?.boosts, winnerItem),
            invoiceA: invoiceA(winnerItem),
            isOwn: ownWinner,
          } : null,
        };
      } catch (fetchError) {
        return {
          sku: row.sku,
          itemId,
          title: row.meli_title,
          thumbnail: row.meli_thumbnail,
          permalink: row.meli_permalink,
          catalogProductId: row.meli_catalog_product_id,
          ownPrice: Number(row.meli_price || 0) || null,
          priceToWin: null,
          status: "error",
          ownFull: false,
          reason: [fetchError instanceof Error ? fetchError.message : "No se pudo consultar catálogo."],
          winner: null,
        };
      }
    });

    return NextResponse.json({ ok: true, rows: competition, total: competition.length, refreshedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar la competencia." }, { status: 500 });
  }
}
