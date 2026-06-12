import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import type { Product } from "@/lib/types";

type MeliItem = {
  id: string;
  title?: string;
  seller_custom_field?: string | null;
  price?: number;
  status?: string;
  available_quantity?: number;
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

function findShippingCost(value: any): number {
  if (value === null || value === undefined) return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findShippingCost(item);
      if (found > 0) return found;
    }
    return 0;
  }

  if (typeof value === "object") {
    const priorityKeys = [
      "list_cost",
      "shipping_cost",
      "cost",
      "amount",
      "price",
      "base_cost",
      "gross_amount",
    ];

    for (const key of priorityKeys) {
      const raw = value[key];
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
      if (typeof raw === "string") {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }

    for (const nested of Object.values(value)) {
      const found = findShippingCost(nested);
      if (found > 0) return found;
    }
  }

  return 0;
}

async function getShippingCostForItem(item: MeliItem, account: any) {
  const endpoints = [
    `/users/${account.meli_user_id}/shipping_options/free?item_id=${item.id}`,
    `/items/${item.id}/shipping_options/free`,
    `/items/shipping_options/free?ids=${item.id}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await meliFetch(endpoint, account);
      const itemData = data?.[item.id] || data;
      const cost = findShippingCost(itemData);
      if (cost > 0) {
        return {
          cost,
          source: endpoint,
        };
      }
    } catch {
      // Probamos con el siguiente endpoint compatible.
    }
  }

  return {
    cost: 0,
    source: null,
  };
}

async function getShippingCostsByItemIds(items: MeliItem[], account: any) {
  const costs = new Map<string, { cost: number; source: string | null }>();

  for (const item of items) {
    const result = await getShippingCostForItem(item, account);
    costs.set(item.id, result);
  }

  return costs;
}

export async function POST() {
  const supabase = createAdminClient();
  const startedAt = Date.now();

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

    const itemIds = new Set<string>();
    const statusesToSync = ["active", "paused"];
    const limit = 50;
    const totalsByStatus: Record<string, number> = {};

    for (const status of statusesToSync) {
      let offset = 0;
      let total = 0;

      do {
        const data = await meliFetch(
          `/users/${account.meli_user_id}/items/search?status=${status}&limit=${limit}&offset=${offset}`,
          account,
        );
        const results = data?.results || [];
        total = Number(data?.paging?.total || results.length || 0);
        totalsByStatus[status] = total;
        results.forEach((id: string) => itemIds.add(id));
        offset += limit;
      } while (offset < total && offset < 1000);
    }

    const items: MeliItem[] = [];
    for (const ids of chunk([...itemIds], 20)) {
      const data = await meliFetch(`/items?ids=${ids.join(",")}`, account);
      (Array.isArray(data) ? data : []).forEach((entry: any) => {
        if (entry?.body?.id) items.push(entry.body as MeliItem);
      });
    }

    const shippingCostsByItem = new Map<string, { cost: number; source: string | null }>();

    async function shippingCostForMatchedItem(item: MeliItem) {
      const cached = shippingCostsByItem.get(item.id);
      if (cached) return cached;

      const result = await getShippingCostForItem(item, account);
      shippingCostsByItem.set(item.id, result);
      return result;
    }

    const logs: any[] = [];
    let updated = 0;
    let matched = 0;
    let changed = 0;
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
          message: `La publicación no tiene SKU visible para comparar. Estado ML: ${item.status || "-"} · Stock ML: ${item.available_quantity ?? "-"}.`,
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
            message: `SKU de MercadoLibre no encontrado en productos. Estado ML: ${item.status || "-"} · Stock ML: ${item.available_quantity ?? "-"}.`,
            created_at: now,
          });
          continue;
        }

        const shippingResult = await shippingCostForMatchedItem(item);
        const newShippingCost = Number(shippingResult?.cost || 0);
        const shippingSource = shippingResult?.source || null;
        const { data: current } = await supabase
          .from("mercadolibre_shipping_costs")
          .select("*")
          .eq("product_id", product.id)
          .maybeSingle();

        const oldShippingCost = Number(current?.shipping_cost_amount || 0);
        matched += 1;

        if (!newShippingCost) {
          noShippingCost += 1;
          logs.push({
            sku: product.sku,
            meli_item_id: item.id,
            old_shipping_cost: oldShippingCost,
            new_shipping_cost: null,
            status: "matched_without_cost",
            message: `SKU encontrado, pero MercadoLibre no devolvió costo de envío. No se modificó el costo cargado. Estado ML: ${item.status || "-"} · Stock ML: ${item.available_quantity ?? "-"}.`,
            created_at: now,
          });
          continue;
        }

        if (Math.round(oldShippingCost) !== Math.round(newShippingCost)) changed += 1;

        const { error: upsertError } = await supabase.from("mercadolibre_shipping_costs").upsert(
          {
            product_id: product.id,
            sku: product.sku,
            fixed_fee_amount: Number(current?.fixed_fee_amount || 0),
            shipping_cost_amount: newShippingCost,
            free_shipping: true,
            shipping_method: item.shipping?.logistic_type || item.shipping?.mode || "mercado_envios",
            notes: `Sincronizado desde MercadoLibre ${item.id} · ${shippingSource || "endpoint compatible"}`,
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
          status: "updated",
          message: `Costo de envío actualizado desde MercadoLibre. Fuente: ${shippingSource || "endpoint compatible"}`,
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
      statuses_synced: statusesToSync,
      totals_by_status: totalsByStatus,
      matched,
      updated,
      changed,
      not_found: notFound,
      without_sku: withoutSku,
      no_shipping_cost: noShippingCost,
      duration_ms: Date.now() - startedAt,
      shipping_queries: shippingCostsByItem.size,
      logs: logs.slice(0, 50),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar MercadoLibre.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
