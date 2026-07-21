import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";

type MeliItem = {
  id: string;
  title?: string;
  price?: number | null;
  base_price?: number | null;
  category_id?: string | null;
  domain_id?: string | null;
  listing_type_id?: string | null;
  status?: string | null;
  tags?: string[];
};

type MeliListingPrice = {
  listing_type_id?: string | null;
  sale_fee_amount?: number | null;
  sale_fee_details?: {
    financing_add_on_fee?: number | null;
    fixed_fee?: number | null;
    gross_amount?: number | null;
    meli_percentage_fee?: number | null;
    percentage_fee?: number | null;
  } | null;
};

type MeliCategory = {
  id?: string;
  name?: string;
  path_from_root?: Array<{ id?: string; name?: string }>;
};

type ExistingCategoryFee = {
  category: string;
  marketplace_fee_rate: number;
  active: boolean;
  notes?: string | null;
  meli_category_ids?: string[] | null;
  meli_category_names?: string[] | null;
};

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function categoryPath(category: MeliCategory | null) {
  const path = Array.isArray(category?.path_from_root) ? category?.path_from_root || [] : [];
  const names = path.map((entry) => entry.name).filter(Boolean) as string[];
  return names.length ? names.join(" > ") : category?.name || category?.id || "";
}

function categoryLeafName(category: MeliCategory | null, categoryId: string) {
  const path = Array.isArray(category?.path_from_root) ? category?.path_from_root || [] : [];
  return path[path.length - 1]?.name || category?.name || categoryId;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function marketplaceFeeRate(listingPrice: MeliListingPrice | null, itemPrice?: number | null) {
  if (!listingPrice) return 0;
  const details = listingPrice.sale_fee_details || {};
  const directRate = positiveNumber(details.meli_percentage_fee) || positiveNumber(details.percentage_fee);
  if (directRate) return directRate;

  const baseAmount = positiveNumber(details.gross_amount) || positiveNumber(itemPrice);
  const saleFeeAmount = positiveNumber(listingPrice.sale_fee_amount);
  if (!baseAmount || !saleFeeAmount) return 0;

  const financingAmount = positiveNumber(details.financing_add_on_fee);
  const fixedFee = positiveNumber(details.fixed_fee);
  const variableFee = Math.max(0, saleFeeAmount - financingAmount - fixedFee);
  const derivedRate = ((variableFee || saleFeeAmount) / baseAmount) * 100;
  return Number.isFinite(derivedRate) && derivedRate > 0 ? derivedRate : 0;
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

async function getMeliCategory(categoryId: string, account: any) {
  try {
    return (await meliFetch(`/categories/${categoryId}`, account)) as MeliCategory;
  } catch {
    return null;
  }
}

async function getListingPriceForItem(item: MeliItem, account: any): Promise<MeliListingPrice | null> {
  const price = Number(item.price || item.base_price || 10000);
  const listingTypeId = item.listing_type_id || "gold_special";
  if (!price || !item.category_id) return null;

  try {
    const params = new URLSearchParams({
      price: String(price),
      listing_type_id: listingTypeId,
    });
    if (item.category_id) params.set("category_id", item.category_id);
    if (item.domain_id) params.set("domain_id", item.domain_id);

    const data = await meliFetch(`/sites/MLA/listing_prices?${params.toString()}`, account);
    const prices = Array.isArray(data) ? data : [];
    return (prices.find((entry: MeliListingPrice) => entry?.listing_type_id === listingTypeId) || prices[0] || null) as MeliListingPrice | null;
  } catch {
    return null;
  }
}

function findExistingCategory(existingRows: ExistingCategoryFee[], categoryId: string, categoryName: string, path: string) {
  return existingRows.find((row) => {
    const ids = Array.isArray(row.meli_category_ids) ? row.meli_category_ids : [];
    if (ids.includes(categoryId)) return true;
    const storedNames = Array.isArray(row.meli_category_names) ? row.meli_category_names : [];
    return row.category === categoryName || row.category === path || storedNames.includes(categoryName) || storedNames.includes(path);
  }) || null;
}

async function buildPreview() {
  const supabase = createAdminClient();
  const account = await getConnectedMeliAccount();
  if (!account) {
    return { error: "Primero conecta MercadoLibre.", status: 400 as const };
  }

  const [{ itemIds, totalsByStatus }, existingResponse] = await Promise.all([
    getAllItemIds(account),
    supabase.from("mercadolibre_category_fees").select("*"),
  ]);

  if (existingResponse.error) throw new Error(existingResponse.error.message);

  const items = await getItems(itemIds, account);
  const grouped = new Map<string, MeliItem[]>();
  items.forEach((item) => {
    if (!item.category_id) return;
    const group = grouped.get(item.category_id) || [];
    group.push(item);
    grouped.set(item.category_id, group);
  });

  const rows = await Promise.all(
    [...grouped.entries()].map(async ([categoryId, categoryItems]) => {
      const category = await getMeliCategory(categoryId, account);
      const rates: number[] = [];
      for (const item of categoryItems.slice(0, 8)) {
        const listingPrice = await getListingPriceForItem(item, account);
        const rate = marketplaceFeeRate(listingPrice, Number(item.price || item.base_price || 0));
        if (Number.isFinite(rate) && rate > 0) rates.push(rate);
      }

      const name = categoryLeafName(category, categoryId);
      const path = categoryPath(category) || name;
      const existing = findExistingCategory((existingResponse.data || []) as ExistingCategoryFee[], categoryId, name, path);
      const marketplaceFeeRateValue = rates.length
        ? Number(Math.max(...rates).toFixed(3))
        : Number(existing?.marketplace_fee_rate || 0);

      return {
        meli_category_id: categoryId,
        meli_category_name: name,
        meli_category_path: path,
        suggested_category: existing?.category || name,
        marketplace_fee_rate: marketplaceFeeRateValue,
        publication_count: categoryItems.length,
        active_publications: categoryItems.filter((item) => item.status === "active").length,
        paused_publications: categoryItems.filter((item) => item.status === "paused").length,
        sample_titles: categoryItems.slice(0, 3).map((item) => item.title || item.id),
        exists: Boolean(existing),
        existing_category: existing?.category || null,
      };
    }),
  );

  rows.sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? 1 : -1;
    if (b.publication_count !== a.publication_count) return b.publication_count - a.publication_count;
    return a.suggested_category.localeCompare(b.suggested_category, "es");
  });

  return {
    ok: true,
    totals_by_status: totalsByStatus,
    total_items: items.length,
    total_categories: rows.length,
    missing: rows.filter((row) => !row.exists).length,
    existing: rows.filter((row) => row.exists).length,
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
      { error: error instanceof Error ? error.message : "No se pudieron leer las categorias de MercadoLibre." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient();

  try {
    const body = await request.json().catch(() => ({}));
    const selected = Array.isArray(body?.categories) ? body.categories : [];
    const selectedById = new Map<string, string>();
    selected.forEach((entry: any) => {
      const id = String(entry?.meli_category_id || "").trim();
      const category = String(entry?.category || "").trim();
      if (id && category) selectedById.set(id, category);
    });

    if (selectedById.size === 0) {
      return NextResponse.json({ ok: true, imported: 0, message: "No seleccionaste categorias para importar." });
    }

    const preview = await buildPreview();
    if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: preview.status });

    const now = new Date().toISOString();
    const rowsToImport = preview.rows.filter((row) => selectedById.has(row.meli_category_id));
    const payload = rowsToImport.map((row) => {
      const category = selectedById.get(row.meli_category_id) || row.suggested_category;
      return {
        category,
        marketplace_fee_rate: Number(row.marketplace_fee_rate || 0),
        active: true,
        notes: `Importado desde MercadoLibre: ${row.meli_category_path} (${row.publication_count} publicaciones).`,
        meli_category_ids: [row.meli_category_id],
        meli_category_names: [row.meli_category_path || row.meli_category_name],
        meli_source: "listing_prices.sale_fee_details",
        meli_last_sync_at: now,
        updated_at: now,
      };
    });

    if (payload.length === 0) {
      return NextResponse.json({ ok: true, imported: 0, message: "No encontramos categorias seleccionadas en MercadoLibre." });
    }

    const { error } = await supabase.from("mercadolibre_category_fees").upsert(payload, { onConflict: "category" });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      imported: payload.length,
      total_categories: preview.total_categories,
      skipped_unselected: preview.rows.length - payload.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron importar categorias desde MercadoLibre." },
      { status: 500 },
    );
  }
}
