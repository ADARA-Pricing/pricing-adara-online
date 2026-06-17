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

type CategoryFeeInfo = {
  categoryId: string | null;
  categoryName: string | null;
  marketplaceFeeRate: number | null;
  saleFeeAmount: number | null;
  listingTypeId: string | null;
  listingTypeName: string | null;
  referencePrice: number | null;
  source: string;
};

type CatalogProduct = {
  id: string;
  name: string;
  domain_id?: string | null;
  pictures?: { url?: string; secure_url?: string }[];
  status?: string | null;
};

type CategoryReference = {
  raw: string;
  categoryId: string | null;
  categoryName: string | null;
  domainId: string | null;
  productId: string | null;
  itemId: string | null;
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

function firstPicture(product: any, detail: any, offer: any) {
  return (
    offer.thumbnail ||
    detail?.thumbnail ||
    detail?.pictures?.[0]?.secure_url ||
    detail?.pictures?.[0]?.url ||
    product?.pictures?.[0]?.secure_url ||
    product?.pictures?.[0]?.url ||
    null
  );
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

function categoryNameFromResponse(data: any) {
  if (!data || typeof data !== "object") return null;
  return data.name || data.path_from_root?.[data.path_from_root.length - 1]?.name || null;
}

async function fetchOptional<T>(path: string, account: any): Promise<T | null> {
  try {
    return await meliFetch(path, account);
  } catch {
    return null;
  }
}

async function resolveCategoryReference(input: string, account: any): Promise<CategoryReference | null> {
  const raw = input.trim();
  if (!raw) return null;
  const value = raw.toUpperCase();

  if (/^MLA-\w+/.test(value)) {
    return { raw, categoryId: null, categoryName: null, domainId: value, productId: null, itemId: null };
  }

  if (/^MLA\d+/.test(value)) {
    const category = await fetchOptional<any>(`/categories/${value}`, account);
    if (category?.id) {
      return {
        raw,
        categoryId: category.id,
        categoryName: categoryNameFromResponse(category),
        domainId: null,
        productId: null,
        itemId: null,
      };
    }

    const product = await fetchOptional<any>(`/products/${value}`, account);
    if (product?.id) {
      return {
        raw,
        categoryId: null,
        categoryName: null,
        domainId: product.domain_id || null,
        productId: product.id,
        itemId: null,
      };
    }

    const item = await fetchOptional<any>(`/items/${value}`, account);
    if (item?.id) {
      const itemCategory = item.category_id ? await fetchOptional<any>(`/categories/${item.category_id}`, account) : null;
      return {
        raw,
        categoryId: item.category_id || null,
        categoryName: categoryNameFromResponse(itemCategory),
        domainId: item.domain_id || null,
        productId: item.catalog_product_id || null,
        itemId: item.id,
      };
    }
  }

  return null;
}

async function getCategoryFeeInfo(
  categoryId: string | null,
  referencePrice: number | null,
  account: any,
): Promise<CategoryFeeInfo | null> {
  if (!categoryId || !referencePrice) return null;

  const params = new URLSearchParams({
    price: String(referencePrice),
    category_id: categoryId,
    listing_type_id: "gold_special",
  });

  const listingPrice = await fetchOptional<any>(`/sites/MLA/listing_prices?${params.toString()}`, account);
  const data = Array.isArray(listingPrice) ? listingPrice[0] : listingPrice;
  const category = await fetchOptional<any>(`/categories/${categoryId}`, account);

  return {
    categoryId,
    categoryName: categoryNameFromResponse(category),
    marketplaceFeeRate: nullableNumber(data?.sale_fee_details?.meli_percentage_fee ?? data?.sale_fee_details?.percentage_fee),
    saleFeeAmount: nullableNumber(data?.sale_fee_amount),
    listingTypeId: data?.listing_type_id || "gold_special",
    listingTypeName: data?.listing_type_name || "Clásica",
    referencePrice,
    source: "listing_prices",
  };
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

    const reference = await resolveCategoryReference(categoryId, account);
    const searchParams = new URLSearchParams({
      site_id: "MLA",
      limit: String(Math.min(limit, 12)),
    });
    if (query) searchParams.set("q", query);
    if (reference?.domainId) searchParams.set("domain_id", reference.domainId);

    const productSearch = reference?.productId
      ? { results: [await meliFetch(`/products/${reference.productId}`, account)], paging: null }
      : query || reference?.domainId
        ? await meliFetch(`/products/search?${searchParams.toString()}`, account)
        : { results: [], paging: null };
    const products = Array.isArray(productSearch?.results)
      ? (productSearch.results as CatalogProduct[]).filter(Boolean).slice(0, Math.min(limit, 12))
      : [];

    const offerGroups = await Promise.all(
      products.map(async (product) => {
        const offers = await fetchOptional<any>(`/products/${product.id}/items?site_id=MLA&limit=${Math.min(limit, 20)}`, account);
        const results = Array.isArray(offers?.results) ? offers.results : [];
        return results.map((offer: any) => ({ product, offer }));
      }),
    );

    const offerRows = offerGroups.flat().slice(0, limit);
    const items = (
      await Promise.all(
        offerRows.map(async ({ product, offer }: { product: CatalogProduct; offer: any }): Promise<MarketItem> => {
          const itemId = offer.item_id || offer.id;
          const detail = itemId ? await fetchOptional<any>(`/items/${itemId}`, account) : null;
          const source = detail || offer;
          const catalogListing = Boolean(source.catalog_listing ?? true);
          const priceToWin = itemId && catalogListing
            ? await fetchOptional<any>(`/items/${itemId}/price_to_win`, account)
            : null;

          return {
            id: itemId,
            title: source.title || product.name || itemId,
            price: asNumber(offer.price ?? source.price),
            originalPrice: nullableNumber(offer.original_price ?? source.original_price),
            permalink: source.permalink || `https://articulo.mercadolibre.com.ar/${itemId}`,
            thumbnail: firstPicture(product, detail, offer),
            condition: offer.condition || source.condition || null,
            listingTypeId: offer.listing_type_id || source.listing_type_id || null,
            channel: detectChannel({ ...offer, ...source }),
            availableQuantity: nullableNumber(source.available_quantity ?? offer.available_quantity),
            soldQuantity: nullableNumber(source.sold_quantity ?? offer.sold_quantity),
            catalogListing,
            catalogProductId: product.id || source.catalog_product_id || null,
            categoryId: offer.category_id || source.category_id || product.domain_id || null,
            sellerId: nullableNumber(offer.seller_id ?? source.seller_id),
            sellerNickname: offer.seller?.nickname || null,
            acceptsMercadoPago: Boolean(offer.accepts_mercadopago ?? source.accepts_mercadopago),
            freeShipping: Boolean(offer.shipping?.free_shipping ?? source.shipping?.free_shipping),
            logisticType: offer.shipping?.logistic_type || source.shipping?.logistic_type || null,
            shippingMode: offer.shipping?.mode || source.shipping?.mode || null,
            tags: Array.isArray(offer.tags || source.tags) ? (offer.tags || source.tags).map((tag: unknown) => String(tag)) : [],
            priceToWin: priceToWinFromResponse(priceToWin),
            rawPriceToWinStatus: priceToWin?.status || priceToWin?.reason || null,
          };
        }),
      )
    ).sort((a, b) => a.price - b.price);

    const summary = summarize(items);
    const referenceCategoryId = reference?.categoryId || items.find((item) => /^MLA\d+/.test(item.categoryId || ""))?.categoryId || null;
    const referencePrice = summary.minPrice || items.find((item) => item.price > 0)?.price || 100000;
    const categoryFee = await getCategoryFeeInfo(referenceCategoryId, referencePrice, account);

    return NextResponse.json({
      query,
      categoryId: categoryId || null,
      resolvedCategory: {
        input: reference?.raw || categoryId || null,
        categoryId: categoryFee?.categoryId || referenceCategoryId,
        categoryName: categoryFee?.categoryName || reference?.categoryName || null,
        domainId: reference?.domainId || null,
        productId: reference?.productId || null,
        itemId: reference?.itemId || null,
      },
      categoryFee,
      searchMode: "catalog_products",
      paging: productSearch?.paging || null,
      filters: [],
      availableFilters: [],
      items,
      summary,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo analizar MercadoLibre.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
