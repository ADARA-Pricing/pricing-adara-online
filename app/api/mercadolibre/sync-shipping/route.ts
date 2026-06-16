import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import type { Product } from "@/lib/types";

type MeliItem = {
  id: string;
  title?: string;
  permalink?: string | null;
  seller_custom_field?: string | null;
  price?: number;
  sale_price?: {
    amount?: number | null;
    regular_amount?: number | null;
    currency_id?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
  original_price?: number | null;
  currency_id?: string | null;
  listing_type_id?: string | null;
  sale_terms?: Array<{ id?: string; name?: string; value_name?: string; value_id?: string }>;
  tags?: string[];
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

type PromotionSummary = {
  originalPrice: number | null;
  promoPrice: number | null;
  name: string | null;
  status: string | null;
  discountAmount: number | null;
  discountRate: number | null;
  sellerAmount: number | null;
  sellerRate: number | null;
  meliAmount: number | null;
  meliRate: number | null;
  receiveAmount: number | null;
  raw: unknown[];
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


function detectInstallmentsText(item: MeliItem, listingTypeName?: string | null) {
  const saleTerms = item.sale_terms || [];
  const searchable = [
    listingTypeName,
    item.listing_type_id,
    ...(item.tags || []),
    ...saleTerms.flatMap((term) => [term.id, term.name, term.value_name, term.value_id]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const explicitInstallments = saleTerms.find((term) => {
    const text = `${term.id || ""} ${term.name || ""} ${term.value_name || ""}`.toLowerCase();
    return text.includes("cuota") || text.includes("installment");
  });

  const explicitText = explicitInstallments?.value_name || explicitInstallments?.name;
  const match = searchable.match(/(\d{1,2})\s*(x|cuotas?|installments?)/i);
  if (match?.[1]) return `${match[1]} cuotas`;

  if (explicitText) return explicitText;

  if (searchable.includes("gold_pro") || searchable.includes("premium")) return "Premium / cuotas";
  if (searchable.includes("gold_special") || searchable.includes("clásica") || searchable.includes("clasica")) return "Clásica / 1 pago";

  return null;
}

function numberFromValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickNumber(source: any, keys: string[]) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const value = numberFromValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickNumberDeep(source: unknown, keys: string[]): number | null {
  if (!source || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = pickNumberDeep(item, keys);
      if (found !== null) return found;
    }
    return null;
  }

  const item = source as Record<string, unknown>;
  for (const key of keys) {
    const value = numberFromValue(item[key]);
    if (value !== null) return value;
  }

  for (const nested of Object.values(item)) {
    const found = pickNumberDeep(nested, keys);
    if (found !== null) return found;
  }

  return null;
}

function pickNumberByKeyPattern(source: unknown, matcher: (key: string) => boolean): number | null {
  if (!source || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = pickNumberByKeyPattern(item, matcher);
      if (found !== null) return found;
    }
    return null;
  }

  const item = source as Record<string, unknown>;
  for (const [key, raw] of Object.entries(item)) {
    if (matcher(key.toLowerCase())) {
      const value = numberFromValue(raw);
      if (value !== null) return value;
    }
  }

  for (const nested of Object.values(item)) {
    const found = pickNumberByKeyPattern(nested, matcher);
    if (found !== null) return found;
  }

  return null;
}

function pickString(source: any, keys: string[]) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isPromotionLike(value: any) {
  if (!value || typeof value !== "object") return false;
  const text = [
    value.type,
    value.price_type,
    value.promotion_type,
    value.promotion_id,
    value.campaign_id,
    value.name,
    value.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /promo|promotion|deal|campaign|oferta|discount|rebate|active|started|programada/.test(text);
}

function collectPromotionCandidates(value: unknown, result: any[] = []) {
  if (!value) return result;

  if (Array.isArray(value)) {
    value.forEach((item) => collectPromotionCandidates(item, result));
    return result;
  }

  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (isPromotionLike(item)) result.push(item);
    Object.values(item).forEach((nested) => collectPromotionCandidates(nested, result));
  }

  return result;
}

function dateFromPromotion(value: any, keys: string[]) {
  for (const key of keys) {
    const raw = value?.[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function dateFromPromotionDeep(value: unknown, keys: string[]): Date | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = dateFromPromotionDeep(item, keys);
      if (found) return found;
    }
    return null;
  }

  const direct = dateFromPromotion(value, keys);
  if (direct) return direct;

  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = dateFromPromotionDeep(nested, keys);
    if (found) return found;
  }

  return null;
}

function isScheduledPromotion(value: any) {
  const status = String(value?.status || value?.state || value?.sub_status || "").toLowerCase();
  if (/program|scheduled|pending|candidate|suggested|available|eligible/.test(status)) return true;

  const startDate = dateFromPromotionDeep(value, [
    "start_date",
    "date_from",
    "starts_at",
    "valid_from",
    "begin_date",
    "start_time",
  ]);

  return Boolean(startDate && startDate.getTime() > Date.now());
}

function isExpiredPromotion(value: any) {
  const endDate = dateFromPromotionDeep(value, [
    "end_date",
    "date_to",
    "ends_at",
    "valid_to",
    "finish_date",
    "end_time",
  ]);

  return Boolean(endDate && endDate.getTime() < Date.now());
}

function promotionScore(value: any) {
  const status = String(value?.status || value?.state || "").toLowerCase();
  const hasPrice = pickNumber(value, ["promo_price", "promotion_price", "discounted_price", "final_price", "price", "amount"]) !== null;
  const hasSellerDiscount = pickNumber(value, ["seller_discount_amount", "seller_amount", "discount_seller_amount", "seller_funded_amount"]) !== null;
  let score = 0;
  if (status.includes("active") || status.includes("started") || status.includes("activa")) score += 4;
  if (hasPrice) score += 3;
  if (hasSellerDiscount) score += 2;
  if (pickString(value, ["name", "promotion_name", "campaign_name", "type", "promotion_type"])) score += 1;
  return score;
}

function summarizePromotion(rawResponses: unknown[], itemPrice?: number | null): PromotionSummary {
  const allCandidates = collectPromotionCandidates(rawResponses)
    .filter((candidate) => promotionScore(candidate) > 0)
    .sort((a, b) => promotionScore(b) - promotionScore(a));
  const activeCandidates = allCandidates.filter((candidate) => !isScheduledPromotion(candidate) && !isExpiredPromotion(candidate));
  const candidates = activeCandidates.sort((a, b) => {
    const priceA = pickNumber(a, ["promo_price", "promotion_price", "discounted_price", "final_price", "deal_price", "price", "amount"]) || Number.MAX_SAFE_INTEGER;
    const priceB = pickNumber(b, ["promo_price", "promotion_price", "discounted_price", "final_price", "deal_price", "price", "amount"]) || Number.MAX_SAFE_INTEGER;
    if (priceA !== priceB) return priceA - priceB;
    return promotionScore(b) - promotionScore(a);
  });
  const best = candidates[0] || {};
  const originalPrice =
    pickNumber(best, ["original_price", "regular_price", "standard_price", "list_price", "base_price"]) ||
    Number(itemPrice || 0) ||
    null;
  const promoPrice = pickNumber(best, [
    "promo_price",
    "promotion_price",
    "discounted_price",
    "final_price",
    "deal_price",
    "price",
    "amount",
  ]);
  const sellerAmount = pickNumber(best, [
    "seller_discount_amount",
    "seller_amount",
    "seller_funded_amount",
    "discount_seller_amount",
    "seller_contribution",
    "seller_contribution_amount",
    "seller_funding_amount",
  ]) || pickNumberDeep(best, [
    "seller_discount_amount",
    "seller_funded_amount",
    "discount_seller_amount",
    "seller_contribution_amount",
    "seller_funding_amount",
  ]);
  const meliAmount = pickNumber(best, [
    "meli_discount_amount",
    "marketplace_discount_amount",
    "marketplace_amount",
    "meli_amount",
    "meli_funded_amount",
    "funding_amount",
    "meli_contribution_amount",
    "marketplace_contribution_amount",
    "cofunded_amount",
    "co_funded_amount",
  ]) || pickNumberDeep(best, [
    "meli_discount_amount",
    "marketplace_discount_amount",
    "meli_funded_amount",
    "meli_contribution_amount",
    "marketplace_contribution_amount",
    "cofunded_amount",
    "co_funded_amount",
  ]) || pickNumberByKeyPattern(best, (key) =>
    /(meli|marketplace|mercado_libre|mercadolibre|platform)/.test(key) &&
    /(amount|discount|fund|funded|contribution|benefit)/.test(key)
  );
  const receiveAmount = pickNumber(best, [
    "receive_amount",
    "seller_receives_amount",
    "seller_receive_amount",
    "net_amount",
    "net_received_amount",
    "payout_amount",
  ]);
  const discountAmount =
    pickNumber(best, ["discount_amount", "total_discount_amount"]) ||
    (originalPrice && promoPrice ? originalPrice - promoPrice : null);
  const discountRate =
    pickNumber(best, ["discount_rate", "discount_percentage", "discount_percent"]) ||
    (originalPrice && discountAmount ? (discountAmount / originalPrice) * 100 : null);
  const sellerRate =
    pickNumber(best, ["seller_discount_rate", "seller_percentage", "seller_percent", "seller_contribution_percentage"]) ||
    pickNumberDeep(best, ["seller_discount_rate", "seller_percentage", "seller_percent", "seller_contribution_percentage"]) ||
    (originalPrice && sellerAmount ? (sellerAmount / originalPrice) * 100 : null);
  const meliRate =
    pickNumber(best, ["meli_discount_rate", "meli_percentage", "marketplace_percentage", "meli_percent", "marketplace_percent"]) ||
    pickNumberDeep(best, ["meli_discount_rate", "meli_percentage", "marketplace_percentage", "meli_percent", "marketplace_percent"]) ||
    pickNumberByKeyPattern(best, (key) =>
      /(meli|marketplace|mercado_libre|mercadolibre|platform)/.test(key) &&
      /(rate|percent|percentage)/.test(key)
    ) ||
    (originalPrice && meliAmount ? (meliAmount / originalPrice) * 100 : null);

  return {
    originalPrice,
    promoPrice,
    name: pickString(best, ["name", "promotion_name", "campaign_name", "type", "promotion_type"]),
    status: pickString(best, ["status", "state"]),
    discountAmount,
    discountRate,
    sellerAmount,
    sellerRate,
    meliAmount,
    meliRate,
    receiveAmount,
    raw: rawResponses,
  };
}

function summarizeItemSalePrice(item: MeliItem): PromotionSummary | null {
  const salePrice = item.sale_price;
  const promoPrice = numberFromValue(salePrice?.amount);
  const originalPrice =
    numberFromValue(salePrice?.regular_amount) ||
    numberFromValue(item.original_price) ||
    numberFromValue(item.price);

  if (!promoPrice || !originalPrice || promoPrice >= originalPrice) return null;

  const discountAmount = originalPrice - promoPrice;
  const metadata = salePrice?.metadata || {};

  return {
    originalPrice,
    promoPrice,
    name: pickString(metadata, ["campaign_name", "promotion_name", "promotion_type", "campaign_id", "promotion_id"]) || "Promo activa",
    status: "active",
    discountAmount,
    discountRate: (discountAmount / originalPrice) * 100,
    sellerAmount: pickNumber(metadata, ["seller_discount_amount", "seller_amount", "seller_funded_amount", "discount_seller_amount"]),
    sellerRate: pickNumber(metadata, ["seller_percentage", "seller_percent", "seller_discount_rate"]),
    meliAmount: pickNumber(metadata, ["meli_discount_amount", "marketplace_discount_amount", "meli_amount", "funding_amount"]),
    meliRate: pickNumber(metadata, ["meli_percentage", "marketplace_percentage", "meli_discount_rate"]),
    receiveAmount: pickNumber(metadata, ["receive_amount", "seller_receives_amount", "seller_receive_amount", "net_amount"]),
    raw: [{ endpoint: "item.sale_price", data: salePrice }],
  };
}

function sameMoney(left?: number | null, right?: number | null) {
  if (!left || !right) return false;
  return Math.abs(Number(left) - Number(right)) < 1;
}

async function getPromotionSummaryForItem(item: MeliItem, account: any) {
  const salePriceSummary = summarizeItemSalePrice(item);
  const endpoints = [
    `/items/${item.id}/prices`,
    `/seller-promotions/items/${item.id}?app_version=v2`,
    `/seller-promotions/items/${item.id}/offers?app_version=v2`,
  ];
  const rawResponses: unknown[] = [];

  for (const endpoint of endpoints) {
    try {
      const data = await meliFetch(endpoint, account);
      rawResponses.push({ endpoint, data });
    } catch {
      // Algunas cuentas o publicaciones no tienen acceso a todos los endpoints de promociones.
    }
  }

  const endpointSummary = summarizePromotion(rawResponses, item.price);
  if (salePriceSummary && !endpointSummary.promoPrice) return {
    ...salePriceSummary,
    raw: [...salePriceSummary.raw, ...rawResponses],
  };
  if (salePriceSummary && endpointSummary.promoPrice) return {
    ...salePriceSummary,
    name: sameMoney(endpointSummary.promoPrice, salePriceSummary.promoPrice)
      ? endpointSummary.name || salePriceSummary.name
      : salePriceSummary.name,
    status: sameMoney(endpointSummary.promoPrice, salePriceSummary.promoPrice)
      ? endpointSummary.status || salePriceSummary.status
      : salePriceSummary.status,
    sellerAmount: sameMoney(endpointSummary.promoPrice, salePriceSummary.promoPrice)
      ? endpointSummary.sellerAmount || salePriceSummary.sellerAmount
      : salePriceSummary.sellerAmount,
    sellerRate: sameMoney(endpointSummary.promoPrice, salePriceSummary.promoPrice)
      ? endpointSummary.sellerRate || salePriceSummary.sellerRate
      : salePriceSummary.sellerRate,
    meliAmount: sameMoney(endpointSummary.promoPrice, salePriceSummary.promoPrice)
      ? endpointSummary.meliAmount || salePriceSummary.meliAmount
      : salePriceSummary.meliAmount,
    meliRate: sameMoney(endpointSummary.promoPrice, salePriceSummary.promoPrice)
      ? endpointSummary.meliRate || salePriceSummary.meliRate
      : salePriceSummary.meliRate,
    receiveAmount: sameMoney(endpointSummary.promoPrice, salePriceSummary.promoPrice)
      ? endpointSummary.receiveAmount || salePriceSummary.receiveAmount
      : salePriceSummary.receiveAmount,
    raw: [...salePriceSummary.raw, ...rawResponses],
  };

  return endpointSummary;
}

async function getDetailedItemForPricing(item: MeliItem, account: any) {
  try {
    const data = await meliFetch(`/items/${item.id}`, account);
    return {
      ...item,
      ...(data || {}),
    } as MeliItem;
  } catch {
    return item;
  }
}

async function getListingTypeNames(account: any) {
  const map = new Map<string, string>();
  try {
    const data = await meliFetch("/sites/MLA/listing_types", account);
    (Array.isArray(data) ? data : []).forEach((item: any) => {
      if (item?.id) map.set(item.id, item.name || item.id);
    });
  } catch {
    // Si no está disponible, seguimos sin nombre visible.
  }
  return map;
}

export async function POST() {
  const supabase = createAdminClient();
  const startedAt = Date.now();

  try {
    const account = await getConnectedMeliAccount();
    if (!account) {
      return NextResponse.json({ error: "Primero conectá MercadoLibre." }, { status: 400 });
    }

    const listingTypeNames = await getListingTypeNames(account);

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
    const promotionsByItem = new Map<string, PromotionSummary>();
    const detailedItemsByItem = new Map<string, MeliItem>();

    async function shippingCostForMatchedItem(item: MeliItem) {
      const cached = shippingCostsByItem.get(item.id);
      if (cached) return cached;

      const result = await getShippingCostForItem(item, account);
      shippingCostsByItem.set(item.id, result);
      return result;
    }

    async function promotionForMatchedItem(item: MeliItem) {
      const cached = promotionsByItem.get(item.id);
      if (cached) return cached;

      const detailedItem = detailedItemsByItem.get(item.id) || await getDetailedItemForPricing(item, account);
      detailedItemsByItem.set(item.id, detailedItem);
      const result = await getPromotionSummaryForItem(detailedItem, account);
      promotionsByItem.set(item.id, result);
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
        const promotionResult = await promotionForMatchedItem(item);
        const newShippingCost = Number(shippingResult?.cost || 0);
        const shippingSource = shippingResult?.source || null;
        const { data: current } = await supabase
          .from("mercadolibre_shipping_costs")
          .select("*")
          .eq("product_id", product.id)
          .eq("meli_item_id", item.id)
          .maybeSingle();

        const oldShippingCost = Number(current?.shipping_cost_amount || 0);
        matched += 1;

        const metadataPayload = {
          meli_item_id: item.id,
          meli_title: item.title || null,
          meli_permalink: item.permalink || null,
          meli_price: Number((detailedItemsByItem.get(item.id) || item).price ?? 0) || null,
          meli_currency_id: (detailedItemsByItem.get(item.id) || item).currency_id || null,
          meli_original_price: promotionResult.originalPrice,
          meli_promo_price: promotionResult.promoPrice,
          meli_promo_name: promotionResult.name,
          meli_promo_status: promotionResult.status,
          meli_promo_discount_amount: promotionResult.discountAmount,
          meli_promo_discount_rate: promotionResult.discountRate,
          meli_promo_seller_amount: promotionResult.sellerAmount,
          meli_promo_seller_rate: promotionResult.sellerRate,
          meli_promo_meli_amount: promotionResult.meliAmount,
          meli_promo_meli_rate: promotionResult.meliRate,
          meli_promo_receive_amount: promotionResult.receiveAmount,
          meli_promotions: promotionResult.raw,
          meli_listing_type_id: item.listing_type_id || null,
          meli_listing_type_name: item.listing_type_id ? listingTypeNames.get(item.listing_type_id) || item.listing_type_id : null,
          meli_sale_terms: item.sale_terms || [],
          meli_tags: item.tags || [],
          meli_installments_text: detectInstallmentsText(item, item.listing_type_id ? listingTypeNames.get(item.listing_type_id) || item.listing_type_id : null),
          meli_status: item.status || null,
          meli_stock: Number(item.available_quantity ?? 0),
          meli_free_shipping: Boolean(item.shipping?.free_shipping),
          meli_shipping_mode: item.shipping?.mode || null,
          meli_logistic_type: item.shipping?.logistic_type || null,
          meli_cost_source: shippingSource || null,
          meli_last_sync_at: now,
        };

        if (!newShippingCost) {
          noShippingCost += 1;

          const shippingPayload = {
            product_id: product.id,
            sku: product.sku,
            fixed_fee_amount: Number(current?.fixed_fee_amount || 0),
            shipping_cost_amount: oldShippingCost,
            free_shipping: Boolean(current?.free_shipping ?? item.shipping?.free_shipping ?? true),
            shipping_method: current?.shipping_method || item.shipping?.logistic_type || item.shipping?.mode || "mercado_envios",
            notes: current?.notes || `Sincronizado desde MercadoLibre ${item.id} · sin costo devuelto`,
            active: Boolean(current?.active ?? true),
            ...metadataPayload,
            updated_at: now,
          };

          const { error: saveError } = current?.id
            ? await supabase.from("mercadolibre_shipping_costs").update(shippingPayload).eq("id", current.id)
            : await supabase.from("mercadolibre_shipping_costs").insert(shippingPayload);

          if (saveError) throw new Error(saveError.message);

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

        const shippingPayload = {
          product_id: product.id,
          sku: product.sku,
          fixed_fee_amount: Number(current?.fixed_fee_amount || 0),
          shipping_cost_amount: newShippingCost,
          free_shipping: Boolean(item.shipping?.free_shipping ?? true),
          shipping_method: item.shipping?.logistic_type || item.shipping?.mode || "mercado_envios",
          notes: `Sincronizado desde MercadoLibre ${item.id} · ${shippingSource || "endpoint compatible"}`,
          active: true,
          ...metadataPayload,
          updated_at: now,
        };

        const { error: saveError } = current?.id
          ? await supabase.from("mercadolibre_shipping_costs").update(shippingPayload).eq("id", current.id)
          : await supabase.from("mercadolibre_shipping_costs").insert(shippingPayload);

        if (saveError) throw new Error(saveError.message);

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
      promotion_queries: promotionsByItem.size,
      logs: logs.slice(0, 50),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar MercadoLibre.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
