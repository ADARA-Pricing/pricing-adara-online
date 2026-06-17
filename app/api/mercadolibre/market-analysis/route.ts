import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";

type SearchRequest = {
  query?: string;
  categoryId?: string;
  limit?: number;
};

type MarketItem = {
  id: string;
  title: string;
  price: number;
  originalPrice: number | null;
  permalink: string;
  thumbnail: string | null;
  condition: string | null;
  listingTypeId: string | null;
  channel: string;
  availableQuantity: number | null;
  soldQuantity: number | null;
  catalogListing: boolean;
  catalogProductId: string | null;
  categoryId: string | null;
  sellerId: number | null;
  sellerNickname: string | null;
  acceptsMercadoPago: boolean;
  freeShipping: boolean;
  logisticType: string | null;
  shippingMode: string | null;
  tags: string[];
  priceToWin: number | null;
  rawPriceToWinStatus: string | null;
};

function asNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectChannel(item: any) {
  const tags = Array.isArray(item.tags) ? item.tags.map((tag: unknown) => String(tag).toLowerCase()) : [];
  if (item.listing_type_id === "gold_special") return "MC";
  if (tags.includes("3x_campaign")) return "MP3";
  if (tags.includes("9x_campaign")) return "MP9";
  if (tags.includes("12x_campaign")) return "MP12";
  if (item.listing_type_id === "gold_pro") return "MP6";
  if (item.listing_type_id === "gold_premium") return "Premium";
  return item.listing_type_id || "Sin dato";
}

function priceToWinFromResponse(data: any) {
  if (!data || typeof data !== "object") return null;
  return (
    nullableNumber(data.price_to_win) ??
    nullableNumber(data.current_price) ??
    nullableNumber(data.item_price) ??
    nullableNumber(data.winning_price) ??
    null
  );
}

async function fetchOptional<T>(path: string, account: any): Promise<T | null> {
  try {
    return await meliFetch(path, account);
  } catch {
    return null;
  }
}

function summarize(items: MarketItem[]) {
  const prices = items.map((item) => item.price).filter((price) => price > 0);
  const catalogItems = items.filter((item) => item.catalogListing);
  const fullItems = items.filter((item) => item.logisticType === "fulfillment");
  const sellerIds = new Set(items.map((item) => item.sellerId).filter(Boolean));
  const visibleStock = items.reduce((sum, item) => sum + asNumber(item.availableQuantity), 0);
  const visibleSoldQuantity = items.reduce((sum, item) => sum + asNumber(item.soldQuantity), 0);

  const byChannel = Object.values(
    items.reduce<Record<string, { channel: string; count: number; bestPrice: number | null; bestItem: MarketItem | null }>>((acc, item) => {
      const key = item.channel || "Sin dato";
      const current = acc[key] || { channel: key, count: 0, bestPrice: null, bestItem: null };
      current.count += 1;
      if (item.price > 0 && (current.bestPrice === null || item.price < current.bestPrice)) {
        current.bestPrice = item.price;
        current.bestItem = item;
      }
      acc[key] = current;
      return acc;
    }, {}),
  ).sort((a, b) => {
    const order = ["MC", "MP3", "MP6", "MP9", "MP12", "Premium"];
    const aIndex = order.indexOf(a.channel);
    const bIndex = order.indexOf(b.channel);
    if (aIndex !== bIndex) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    return (a.bestPrice || 0) - (b.bestPrice || 0);
  });

  const byCatalog = Object.values(
    items.reduce<Record<string, { key: string; title: string; count: number; bestPrice: number | null; bestItem: MarketItem | null }>>((acc, item) => {
      const key = item.catalogProductId || `item-${item.id}`;
      const current = acc[key] || { key, title: item.catalogProductId ? "Catálogo" : "Publicaciones individuales", count: 0, bestPrice: null, bestItem: null };
      current.count += 1;
      if (item.price > 0 && (current.bestPrice === null || item.price < current.bestPrice)) {
        current.bestPrice = item.price;
        current.bestItem = item;
      }
      acc[key] = current;
      return acc;
    }, {}),
  ).sort((a, b) => (a.bestPrice || 0) - (b.bestPrice || 0));

  return {
    totalItems: items.length,
    sellerCount: sellerIds.size,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    avgPrice: prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : null,
    catalogCount: catalogItems.length,
    fullCount: fullItems.length,
    visibleStock,
    visibleSoldQuantity,
    byChannel,
    byCatalog: byCatalog.slice(0, 8),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SearchRequest;
    const query = String(body.query || "").trim();
    const categoryId = String(body.categoryId || "").trim();
    const limit = Math.min(Math.max(Number(body.limit || 30), 5), 50);

    if (!query && !categoryId) {
      return NextResponse.json({ error: "Ingresá un producto o una categoría para analizar." }, { status: 400 });
    }

    const account = await getConnectedMeliAccount();
    if (!account) {
      return NextResponse.json({ error: "Conectá MercadoLibre antes de analizar mercado." }, { status: 401 });
    }

    const searchParams = new URLSearchParams({
      limit: String(limit),
      sort: "price_asc",
    });
    if (query) searchParams.set("q", query);
    if (categoryId) searchParams.set("category", categoryId);

    const search = await meliFetch(`/sites/MLA/search?${searchParams.toString()}`, account);
    const results = Array.isArray(search?.results) ? search.results : [];
    const topResults = results.slice(0, limit);

    const items = await Promise.all(
      topResults.map(async (result: any): Promise<MarketItem> => {
        const detail = await fetchOptional<any>(`/items/${result.id}`, account);
        const source = detail || result;
        const priceToWin = source.catalog_listing
          ? await fetchOptional<any>(`/items/${result.id}/price_to_win`, account)
          : null;

        return {
          id: result.id,
          title: source.title || result.title || result.id,
          price: asNumber(result.price ?? source.price),
          originalPrice: nullableNumber(result.original_price ?? source.original_price),
          permalink: result.permalink || source.permalink || `https://articulo.mercadolibre.com.ar/${result.id}`,
          thumbnail: result.thumbnail || source.thumbnail || null,
          condition: result.condition || source.condition || null,
          listingTypeId: result.listing_type_id || source.listing_type_id || null,
          channel: detectChannel({ ...result, ...source }),
          availableQuantity: nullableNumber(source.available_quantity ?? result.available_quantity),
          soldQuantity: nullableNumber(source.sold_quantity ?? result.sold_quantity),
          catalogListing: Boolean(source.catalog_listing ?? result.catalog_listing),
          catalogProductId: source.catalog_product_id || result.catalog_product_id || null,
          categoryId: source.category_id || result.category_id || null,
          sellerId: nullableNumber(result.seller?.id ?? source.seller_id),
          sellerNickname: result.seller?.nickname || null,
          acceptsMercadoPago: Boolean(result.accepts_mercadopago ?? source.accepts_mercadopago),
          freeShipping: Boolean(result.shipping?.free_shipping ?? source.shipping?.free_shipping),
          logisticType: result.shipping?.logistic_type || source.shipping?.logistic_type || null,
          shippingMode: result.shipping?.mode || source.shipping?.mode || null,
          tags: Array.isArray(source.tags) ? source.tags.map((tag: unknown) => String(tag)) : [],
          priceToWin: priceToWinFromResponse(priceToWin),
          rawPriceToWinStatus: priceToWin?.status || priceToWin?.reason || null,
        };
      }),
    );

    return NextResponse.json({
      query,
      categoryId: categoryId || null,
      paging: search?.paging || null,
      filters: search?.filters || [],
      availableFilters: search?.available_filters || [],
      items,
      summary: summarize(items),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo analizar MercadoLibre.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
