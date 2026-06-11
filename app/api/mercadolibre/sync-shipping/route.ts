import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import type { Product } from "@/lib/types";

type MeliItem = {
  id: string;
  title?: string;
  seller_custom_field?: string | null;
  price?: number;
  shipping?: {
    free_shipping?: boolean;
    mode?: string;
    logistic_type?: string;
  };
  attributes?: Array<{ id?: string; name?: string; value_name?: string }>;
  variations?: Array<{
    id?: number;
    seller_custom_field?: string | null;
    attributes?: Array<{ id?: string; name?: string; value_name?: string }>;
    attribute_combinations?: Array<{ id?: string; name?: string; value_name?: string }>;
  }>;
};

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function normalizeSku(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function skuFromAttributes(attributes?: Array<{ id?: string; name?: string; value_name?: string }>) {
  return (
    attributes?.find((attribute) => {
      const id = (attribute.id || "").toUpperCase();
      const name = (attribute.name || "").toUpperCase();
      return id === "SELLER_SKU" || name.includes("SKU");
    })?.value_name || null
  );
}

function getItemSkus(item: MeliItem) {
  const skus = new Set<string>();
  [item.seller_custom_field, skuFromAttributes(item.attributes)].forEach((sku) => {
    const normalized = normalizeSku(sku);
    if (normalized) skus.add(normalized);
  });

  item.variations?.forEach((variation) => {
    [
      variation.seller_custom_field,
      skuFromAttributes(variation.attributes),
      skuFromAttributes(variation.attribute_combinations),
    ].forEach((sku) => {
      const normalized = normalizeSku(sku);
      if (normalized) skus.add(normalized);
    });
  });

  return [...skus];
}

function parseFreeShippingCost(data: any, itemId: string) {
  const itemData = data?.[itemId] || data;
  const coverage = itemData?.coverage || {};
  const allCountry = coverage?.all_country || {};
  const listCost = Number(allCountry?.list_cost ?? itemData?.list_cost ?? itemData?.cost ?? 0);
  return Number.isFinite(listCost) ? listCost : 0;
}

async function getShippingCostsByItemIds(itemIds: string[], account: any) {
  const costs = new Map<string, number>();

  for (const ids of chunk(itemIds, 50)) {
    try {
      const data = await meliFetch(`/items/shipping_options/free?ids=${ids.join(",")}`, account);
      ids.forEach((id) => costs.set(id, parseFreeShippingCost(data, id)));
    } catch {
      for (const id of ids) {
        try {
          const data = await meliFetch(`/items/${id}/shipping_options/free`, account);
          costs.set(id, parseFreeShippingCost(data, id));
        } catch {
          costs.set(id, 0);
        }
      }
    }
  }

  return costs;
}

export async function POST() {
  const supabase = createAdminClient();

  try {
    const account = await getConnectedMeliAccount();
    if (!account) {
      return NextResponse.json({ error: "Primero conectá MercadoLibre." }, { status: 400 });
    }

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("*")
      .eq("status", "active");

    if (productsError) throw new Error(productsError.message);

    const productsBySku = new Map<string, Product>();
    (products || []).forEach((product: Product) => {
      productsBySku.set(normalizeSku(product.sku), product);
    });

    const itemIds: string[] = [];
    let offset = 0;
    const limit = 50;
    let total = 0;

    do {
      const data = await meliFetch(
        `/users/${account.meli_user_id}/items/search?status=active&limit=${limit}&offset=${offset}`,
        account,
      );
      const results = data?.results || [];
      total = Number(data?.paging?.total || results.length || 0);
      itemIds.push(...results);
      offset += limit;
    } while (offset < total && offset < 1000);

    const items: MeliItem[] = [];
    for (const ids of chunk(itemIds, 20)) {
      const data = await meliFetch(`/items?ids=${ids.join(",")}`, account);
      (Array.isArray(data) ? data : []).forEach((entry: any) => {
        if (entry?.body?.id) items.push(entry.body as MeliItem);
      });
    }

    const shippingCosts = await getShippingCostsByItemIds(items.map((item) => item.id), account);

    const logs: any[] = [];
    let updated = 0;
    let notFound = 0;
    let withoutSku = 0;
    let noShippingCost = 0;

    const now = new Date().toISOString();

    for (const item of items) {
      const skus = getItemSkus(item);

      if (!skus.length) {
        withoutSku += 1;
        logs.push({
          sku: null,
          meli_item_id: item.id,
          old_shipping_cost: null,
          new_shipping_cost: null,
          status: "without_sku",
          message: "La publicación no tiene SKU visible para comparar.",
          created_at: now,
        });
        continue;
      }

      for (const sku of skus) {
        const product = productsBySku.get(sku);
        if (!product?.id) {
          notFound += 1;
          logs.push({
            sku,
            meli_item_id: item.id,
            old_shipping_cost: null,
            new_shipping_cost: null,
            status: "sku_not_found",
            message: "SKU de MercadoLibre no encontrado en productos.",
            created_at: now,
          });
          continue;
        }

        const newShippingCost = Number(shippingCosts.get(item.id) || 0);
        if (!newShippingCost) noShippingCost += 1;

        const { data: current } = await supabase
          .from("mercadolibre_shipping_costs")
          .select("*")
          .eq("product_id", product.id)
          .maybeSingle();

        const oldShippingCost = Number(current?.shipping_cost_amount || 0);

        const { error: upsertError } = await supabase.from("mercadolibre_shipping_costs").upsert(
          {
            product_id: product.id,
            sku: product.sku,
            fixed_fee_amount: Number(current?.fixed_fee_amount || 0),
            shipping_cost_amount: newShippingCost,
            free_shipping: true,
            shipping_method: item.shipping?.logistic_type || item.shipping?.mode || "mercado_envios",
            notes: `Sincronizado desde MercadoLibre ${item.id}`,
            active: true,
            updated_at: now,
          },
          { onConflict: "product_id" },
        );

        if (upsertError) throw new Error(upsertError.message);

        updated += 1;
        logs.push({
          sku: product.sku,
          meli_item_id: item.id,
          old_shipping_cost: oldShippingCost,
          new_shipping_cost: newShippingCost,
          status: newShippingCost ? "updated" : "updated_without_cost",
          message: newShippingCost
            ? "Costo de envío actualizado desde MercadoLibre."
            : "SKU encontrado, pero MercadoLibre no devolvió costo de envío.",
          created_at: now,
        });
      }
    }

    if (logs.length) {
      await supabase.from("mercadolibre_shipping_sync_logs").insert(logs);
    }

    return NextResponse.json({
      ok: true,
      total_items: items.length,
      updated,
      not_found: notFound,
      without_sku: withoutSku,
      no_shipping_cost: noShippingCost,
      logs: logs.slice(0, 50),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar MercadoLibre.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
