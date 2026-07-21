import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import type { Product } from "@/lib/types";

type MeliAttribute = {
  id?: string;
  name?: string;
  value_name?: string | null;
};

type MeliVariation = {
  id?: number;
  seller_custom_field?: string | null;
  attributes?: MeliAttribute[];
  attribute_combinations?: MeliAttribute[];
};

type MeliItem = {
  id: string;
  title?: string;
  seller_custom_field?: string | null;
  price?: number | null;
  base_price?: number | null;
  currency_id?: string | null;
  category_id?: string | null;
  status?: string | null;
  available_quantity?: number | null;
  thumbnail?: string | null;
  permalink?: string | null;
  attributes?: MeliAttribute[];
  variations?: MeliVariation[];
};

type MeliCategory = {
  id?: string;
  name?: string;
  path_from_root?: Array<{ id?: string; name?: string }>;
};

type ExistingProduct = Product & { id: string };

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function normalizeSku(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function attributeText(attributes: MeliAttribute[] | undefined, ids: string[], names: string[] = []) {
  const idSet = new Set(ids.map((id) => id.toUpperCase()));
  const nameSet = names.map((name) => name.toUpperCase());

  const found = attributes?.find((attribute) => {
    const id = (attribute.id || "").toUpperCase();
    const name = (attribute.name || "").toUpperCase();
    return idSet.has(id) || nameSet.some((candidate) => name.includes(candidate));
  });

  return found?.value_name?.trim() || null;
}

function skuFromAttributes(attributes?: MeliAttribute[]) {
  return attributeText(attributes, ["SELLER_SKU"], ["SKU"]);
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

function fallbackSku(item: MeliItem) {
  return normalizeSku(item.id);
}

function productStatusFromMeli(status?: string | null): Product["status"] {
  if (status === "paused") return "paused";
  if (status === "closed") return "discontinued";
  return "active";
}

function pickCategoryName(category: MeliCategory | null) {
  if (!category) return null;
  const path = Array.isArray(category.path_from_root) ? category.path_from_root : [];
  return path[path.length - 1]?.name || category.name || null;
}

function buildImportedProduct(item: MeliItem, category: MeliCategory | null, existing?: ExistingProduct | null) {
  const skus = getItemSkus(item);
  const sku = skus[0] || fallbackSku(item);
  const brand = attributeText(item.attributes, ["BRAND"], ["MARCA"]);
  const model = attributeText(item.attributes, ["MODEL"], ["MODELO"]);
  const ean = attributeText(item.attributes, ["EAN", "GTIN", "UPC"], ["EAN", "GTIN", "UPC", "CODIGO"]);
  const categoryName = pickCategoryName(category);

  return {
    sku,
    ean: existing?.ean || ean,
    name: existing?.name || item.title || sku,
    description: existing?.description || null,
    brand: existing?.brand || brand,
    model: existing?.model || model,
    category: existing?.category || categoryName,
    cost_without_vat: Number(existing?.cost_without_vat ?? 0),
    vat_rate: Number(existing?.vat_rate ?? 21),
    stock: Number(item.available_quantity || existing?.stock || 0),
    supplier: existing?.supplier || "MercadoLibre",
    warranty_months: existing?.warranty_months ?? null,
    status: existing?.status || productStatusFromMeli(item.status),
  };
}

async function getAllItemIds(account: { meli_user_id: number }) {
  const statusesToSync = ["active", "paused"];
  const limit = 50;
  const itemIds = new Set<string>();
  const totalsByStatus: Record<string, number> = {};

  for (const status of statusesToSync) {
    let offset = 0;
    let total = 0;

    do {
      const data = await meliFetch(
        `/users/${account.meli_user_id}/items/search?status=${status}&limit=${limit}&offset=${offset}`,
        account as any,
      );
      const results = Array.isArray(data?.results) ? data.results : [];
      total = Number(data?.paging?.total || results.length || 0);
      totalsByStatus[status] = total;
      results.forEach((id: string) => itemIds.add(id));
      offset += limit;
    } while (offset < total && offset < 1000);
  }

  return { itemIds: [...itemIds], totalsByStatus };
}

async function getItems(itemIds: string[], account: any) {
  const items: MeliItem[] = [];

  for (const ids of chunk(itemIds, 20)) {
    const data = await meliFetch(`/items?ids=${ids.join(",")}`, account);
    (Array.isArray(data) ? data : []).forEach((entry: any) => {
      if (entry?.body?.id) items.push(entry.body as MeliItem);
    });
  }

  return items;
}

async function getCategories(items: MeliItem[], account: any) {
  const categories = new Map<string, MeliCategory | null>();
  const categoryIds = [...new Set(items.map((item) => item.category_id).filter(Boolean) as string[])];

  await Promise.all(
    categoryIds.map(async (categoryId) => {
      try {
        const category = await meliFetch(`/categories/${categoryId}`, account);
        categories.set(categoryId, category as MeliCategory);
      } catch {
        categories.set(categoryId, null);
      }
    }),
  );

  return categories;
}

async function buildPreview() {
  const supabase = createAdminClient();
  const account = await getConnectedMeliAccount();
  if (!account) {
    return { error: "Primero conecta MercadoLibre.", status: 400 as const };
  }

  const [{ data: products, error: productsError }, { itemIds, totalsByStatus }] = await Promise.all([
    supabase.from("products").select("*"),
    getAllItemIds(account),
  ]);

  if (productsError) throw new Error(productsError.message);

  const items = await getItems(itemIds, account);
  const categories = await getCategories(items, account);
  const existingBySku = new Map<string, ExistingProduct>();
  (products || []).forEach((product: ExistingProduct) => {
    existingBySku.set(normalizeSku(product.sku), product);
  });

  const rows = items.map((item) => {
    const skus = getItemSkus(item);
    const sku = skus[0] || fallbackSku(item);
    const existing = existingBySku.get(sku) || null;
    const category = item.category_id ? categories.get(item.category_id) || null : null;
    const payload = buildImportedProduct(item, category, existing);

    return {
      meli_item_id: item.id,
      sku,
      sku_source: skus.length ? "meli" : "item_id",
      title: item.title || sku,
      price: Number(item.price || item.base_price || 0),
      currency_id: item.currency_id || "ARS",
      status: item.status || null,
      stock: Number(item.available_quantity || 0),
      thumbnail: item.thumbnail || null,
      permalink: item.permalink || null,
      exists: Boolean(existing),
      product_id: existing?.id || null,
      payload,
    };
  });

  const missingRows = rows.filter((row) => !row.exists);
  const existingRows = rows.filter((row) => row.exists);
  const withoutSku = rows.filter((row) => row.sku_source === "item_id");

  return {
    ok: true,
    totals_by_status: totalsByStatus,
    total_items: rows.length,
    missing: missingRows.length,
    existing: existingRows.length,
    without_sku: withoutSku.length,
    rows,
  };
}

export async function GET() {
  try {
    const preview = await buildPreview();
    if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: preview.status });
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo leer MercadoLibre." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient();

  try {
    const body = await request.json().catch(() => ({}));
    const importExisting = Boolean(body?.import_existing);
    const preview = await buildPreview();
    if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: preview.status });

    const rowsToImport = preview.rows.filter((row) => importExisting || !row.exists);
    const payload = rowsToImport.map((row) => row.payload);

    if (payload.length === 0) {
      return NextResponse.json({
        ok: true,
        imported: 0,
        total_items: preview.total_items,
        message: "No hay productos nuevos para importar.",
      });
    }

    const { error } = await supabase.from("products").upsert(payload, { onConflict: "sku" });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      imported: payload.length,
      total_items: preview.total_items,
      skipped_existing: importExisting ? 0 : preview.existing,
      without_sku: preview.without_sku,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo importar desde MercadoLibre." },
      { status: 500 },
    );
  }
}
