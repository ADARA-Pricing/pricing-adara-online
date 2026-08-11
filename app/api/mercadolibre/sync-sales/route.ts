import { NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { createAdminClient } from "@/lib/supabaseAdmin";
import type { MercadoLibreShippingCost, Product } from "@/lib/types";

type MeliOrderItem = {
  item?: {
    id?: string;
    title?: string;
    seller_sku?: string | null;
    variation_id?: string | number | null;
  };
  quantity?: number;
  unit_price?: number;
  currency_id?: string | null;
};

type MeliOrder = {
  id?: string | number;
  date_created?: string;
  status?: string | null;
  pack_id?: string | number | null;
  order_items?: MeliOrderItem[];
};

function normalizeSku(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function asString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function dateWindows(fromIso: string, toIso: string, chunkDays: number) {
  const result: Array<{ from: string; to: string }> = [];
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  const chunkMs = chunkDays * 86400000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return [{ from: fromIso, to: toIso }];

  let cursor = from;
  while (cursor < to) {
    const next = Math.min(cursor + chunkMs, to);
    result.push({ from: new Date(cursor).toISOString(), to: new Date(next).toISOString() });
    cursor = next + 1;
  }

  return result;
}

export async function POST(request: Request) {
  try {
    const account = await getConnectedMeliAccount();
    if (!account) {
      return NextResponse.json({ error: "No hay una cuenta de MercadoLibre conectada." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const days = Math.max(7, Math.min(Number(body?.days || 60), 180));
    const from = body?.from || daysAgo(days);
    const to = body?.to || new Date().toISOString();
    const chunkDays = Math.max(1, Math.min(Number(body?.chunkDays || 7), 15));
    const supabase = createAdminClient();

    const [{ data: productsData, error: productsError }, { data: publicationsData, error: publicationsError }] = await Promise.all([
      supabase.from("products").select("id, sku, name").eq("status", "active"),
      supabase.from("mercadolibre_shipping_costs").select("product_id, sku, meli_item_id, meli_title").eq("active", true),
    ]);

    if (productsError) throw new Error(productsError.message);
    if (publicationsError) throw new Error(publicationsError.message);

    const products = (productsData || []) as Pick<Product, "id" | "sku" | "name">[];
    const publications = (publicationsData || []) as Pick<MercadoLibreShippingCost, "product_id" | "sku" | "meli_item_id" | "meli_title">[];
    const productBySku = new Map(products.map((product) => [normalizeSku(product.sku), product]));
    const publicationByItemId = new Map(publications.filter((item) => item.meli_item_id).map((item) => [String(item.meli_item_id), item]));

    const rowsByKey = new Map<string, Record<string, unknown>>();
    const limit = 50;
    let scanned = 0;
    const windows = dateWindows(from, to, chunkDays);

    for (const window of windows) {
      let offset = 0;

      while (offset < 1000) {
        const params = new URLSearchParams({
          seller: String(account.meli_user_id),
          "order.date_created.from": window.from,
          "order.date_created.to": window.to,
          sort: "date_desc",
          limit: String(limit),
          offset: String(offset),
        });
        const data = await meliFetch(`/orders/search?${params.toString()}`, account);
        const orders = (Array.isArray(data?.results) ? data.results : []) as MeliOrder[];
        scanned += orders.length;

        for (const order of orders) {
          const orderId = asString(order.id);
          if (!orderId || !order.date_created) continue;

          for (const orderItem of order.order_items || []) {
            const itemId = asString(orderItem.item?.id);
            if (!itemId) continue;

            const skuFromOrder = normalizeSku(orderItem.item?.seller_sku || null);
            const publication = publicationByItemId.get(itemId);
            const sku = skuFromOrder || normalizeSku(publication?.sku || null);
            const product = productBySku.get(sku);
            const quantity = Number(orderItem.quantity || 0);
            const unitPrice = Number(orderItem.unit_price || 0);
            const variationId = asString(orderItem.item?.variation_id);
            const key = [orderId, itemId, variationId, sku].join("|");

            rowsByKey.set(key, {
              order_id: orderId,
              order_date: order.date_created,
              status: order.status || null,
              pack_id: order.pack_id ? String(order.pack_id) : null,
              meli_item_id: itemId,
              variation_id: variationId,
              sku,
              product_id: product?.id || publication?.product_id || null,
              title: orderItem.item?.title || publication?.meli_title || product?.name || null,
              quantity,
              unit_price: unitPrice,
              total_amount: Number((quantity * unitPrice).toFixed(2)),
              currency_id: orderItem.currency_id || null,
              raw: orderItem,
              updated_at: new Date().toISOString(),
            });
          }
        }

        const pagingTotal = Number(data?.paging?.total || 0);
        offset += limit;
        if (!orders.length || offset >= pagingTotal) break;
      }
    }

    const rows = [...rowsByKey.values()];
    if (rows.length) {
      const { error } = await supabase
        .from("mercadolibre_order_items")
        .upsert(rows, { onConflict: "order_id,meli_item_id,variation_id,sku" });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, scanned, saved: rows.length, from, to, windows: windows.length, chunkDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron sincronizar ventas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
