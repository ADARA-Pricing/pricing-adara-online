import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import type { Product } from "@/lib/types";

type MeliItem = {
  id: string;
  title?: string;
  thumbnail?: string | null;
  pictures?: Array<{ secure_url?: string | null; url?: string | null }>;
  permalink?: string | null;
  seller_custom_field?: string | null;
  price?: number;
  base_price?: number | null;
  sale_price?: {
    amount?: number | null;
    regular_amount?: number | null;
    currency_id?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
  original_price?: number | null;
  currency_id?: string | null;
  category_id?: string | null;
  listing_type_id?: string | null;
  catalog_listing?: boolean | null;
  catalog_product_id?: string | null;
  domain_id?: string | null;
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

type MeliPriceToWin = {
  item_id?: string;
  current_price?: number | null;
  currency_id?: string | null;
  price_to_win?: number | null;
  status?: string | null;
  consistent?: boolean | null;
  visit_share?: string | number | null;
  competitors_sharing_first_place?: number | null;
  reason?: string[] | null;
  catalog_product_id?: string | null;
};

type MeliListingPrice = {
  currency_id?: string | null;
  listing_type_id?: string | null;
  listing_type_name?: string | null;
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

type CurrentInstallmentFee = {
  code: string;
  installment_count?: number | null;
  financing_fee_rate?: number | null;
};

type CategoryFeeObservation = {
  rate: number;
  meliCategories: Map<string, string>;
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

type MeliSellerPromotion = {
  id: string;
  type?: string | null;
  status?: string | null;
  name?: string | null;
  start_date?: string | null;
  finish_date?: string | null;
};

type MeliPromotionItem = {
  id?: string;
  type?: string | null;
  name?: string | null;
  status?: string | null;
  price?: number | null;
  original_price?: number | null;
  offer_id?: string | null;
  ref_id?: string | null;
  meli_percentage?: number | null;
  seller_percentage?: number | null;
  boosted_offer?: boolean | null;
  discount_meli_boosted_percentage?: number | null;
  discount_meli_boost_amount?: number | null;
  total_price_for_boosted_offer?: number | null;
  min_discounted_price?: number | null;
  max_discounted_price?: number | null;
  suggested_discounted_price?: number | null;
  start_date?: string | null;
  end_date?: string | null;
};

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
}

function normalizeSku(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function normalizeSkuList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((sku) => normalizeSku(String(sku || ""))).filter(Boolean))];
}

async function getItemIdsBySkus(account: { meli_user_id: number }, skus: string[]) {
  const itemIds = new Set<string>();
  const searches: Record<string, number> = {};

  await mapWithConcurrency(skus, 3, async (sku) => {
    const foundForSku = new Set<string>();

    for (const paramName of ["sku", "seller_sku"]) {
      const params = new URLSearchParams({
        [paramName]: sku,
        limit: "50",
      });

      try {
        const data = await meliFetch(`/users/${account.meli_user_id}/items/search?${params.toString()}`, account as any);
        const results = Array.isArray(data?.results) ? data.results : [];
        results.forEach((id: string) => {
          if (id) {
            itemIds.add(id);
            foundForSku.add(id);
          }
        });
      } catch {
        // Algunos sellers/API versions responden solo a uno de los dos filtros.
      }
    }

    searches[sku] = foundForSku.size;
  });

  return { itemIds: [...itemIds], searches };
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
  const campaignTag = installmentCampaignTag(item);
  if (campaignTag === "3x_campaign") return "3 cuotas";
  if (campaignTag === "9x_campaign") return "9 cuotas";
  if (campaignTag === "12x_campaign") return "12 cuotas";
  if (item.listing_type_id === "gold_pro") return "6 cuotas";
  if (item.listing_type_id === "gold_special") return "Clásica / 1 pago";

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

function installmentCampaignTag(item: MeliItem) {
  const saleTerms = item.sale_terms || [];
  const searchable = [
    ...(item.tags || []),
    ...saleTerms.flatMap((term) => [term.id, term.name, term.value_name, term.value_id]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (searchable.includes("3x_campaign")) return "3x_campaign";
  if (searchable.includes("9x_campaign")) return "9x_campaign";
  if (searchable.includes("12x_campaign")) return "12x_campaign";
  return null;
}

function installmentCountFromText(text?: string | null) {
  const normalized = (text || "").toLowerCase();
  const match = normalized.match(/(\d{1,2})\s*(x|cuotas?|installments?)/i);
  if (match?.[1]) return Number(match[1]);
  if (normalized.includes("1 pago") || normalized.includes("clasica") || normalized.includes("clásica")) return 1;
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

const PROMO_PRICE_KEYS = [
  "promo_price",
  "promotion_price",
  "discounted_price",
  "final_price",
  "deal_price",
  "price",
  "total_price_for_boosted_offer",
];

const ORIGINAL_PRICE_KEYS = ["original_price", "regular_price", "standard_price", "list_price", "base_price"];
const COMMISSION_BASE_PRICE_KEYS = [
  "commission_base_price",
  "commission_base_amount",
  "base_commission_price",
  "base_commission_amount",
  "seller_price",
  "seller_amount_to_charge",
  "seller_charge_amount",
  "effective_price",
  "effective_amount",
];

const SELLER_AMOUNT_KEYS = [
  "seller_discount_amount",
  "seller_amount",
  "seller_funded_amount",
  "discount_seller_amount",
  "seller_contribution",
  "seller_contribution_amount",
  "seller_funding_amount",
];

const MELI_AMOUNT_KEYS = [
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
  "discount_meli_amount",
  "discount_marketplace_amount",
  "marketplace_funded_amount",
  "platform_discount_amount",
  "platform_funded_amount",
  "platform_contribution_amount",
];
const MELI_BOOST_AMOUNT_KEYS = ["discount_meli_boost_amount", "discount_meli_boosted_amount"];

function candidateOriginalPrice(value: any, itemPrice?: number | null) {
  return pickNumber(value, ORIGINAL_PRICE_KEYS) || Number(itemPrice || 0) || null;
}

function candidateCommissionBasePrice(value: any) {
  return pickNumber(value, COMMISSION_BASE_PRICE_KEYS) ||
    pickNumberDeep(value, COMMISSION_BASE_PRICE_KEYS) ||
    pickNumberByKeyPattern(value, (key) =>
      /(commission|base|seller|effective)/.test(key) &&
      /(price|amount|charge)/.test(key)
    );
}

function candidateSellerAmount(value: any) {
  return pickNumber(value, SELLER_AMOUNT_KEYS) ||
    pickNumberDeep(value, SELLER_AMOUNT_KEYS) ||
    pickNumberByKeyPattern(value, (key) =>
      /(seller|vendor|merchant|provider|owner)/.test(key) &&
      /(amount|discount|fund|funded|funding|contribution|benefit|value)/.test(key)
    ) ||
    pickSellerAmountFromTaggedObject(value);
}

function candidateMeliAmount(value: any) {
  return pickNumber(value, MELI_AMOUNT_KEYS) || pickNumberDeep(value, MELI_AMOUNT_KEYS) || pickNumberByKeyPattern(value, (key) =>
    !/boost/.test(key) &&
    /(meli|marketplace|mercado_libre|mercadolibre|platform)/.test(key) &&
    /(amount|discount|fund|funded|funding|contribution|benefit|value)/.test(key)
  ) || pickMeliAmountFromTaggedObject(value);
}

function candidateMeliBoostAmount(value: any) {
  return pickNumber(value, MELI_BOOST_AMOUNT_KEYS) || pickNumberDeep(value, MELI_BOOST_AMOUNT_KEYS);
}

function pickMeliAmountFromTaggedObject(source: unknown): number | null {
  if (!source || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = pickMeliAmountFromTaggedObject(item);
      if (found !== null) return found;
    }
    return null;
  }

  const item = source as Record<string, unknown>;
  const text = Object.values(item)
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const looksLikeMeli = /(meli|mercado libre|mercado_libre|mercadolibre|marketplace|platform)/.test(text);
  if (looksLikeMeli) {
    const taggedAmount =
      pickNumber(item, ["amount", "discount_amount", "funded_amount", "funding_amount", "contribution_amount", "benefit_amount"]) ||
      pickNumber(item, ["value"]);
    if (taggedAmount !== null && taggedAmount > 10) return taggedAmount;
  }

  for (const nested of Object.values(item)) {
    const found = pickMeliAmountFromTaggedObject(nested);
    if (found !== null) return found;
  }

  return null;
}

function pickSellerAmountFromTaggedObject(source: unknown): number | null {
  if (!source || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = pickSellerAmountFromTaggedObject(item);
      if (found !== null) return found;
    }
    return null;
  }

  const item = source as Record<string, unknown>;
  const text = Object.values(item)
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const looksLikeSeller = /(seller|vendedor|a tu cargo|tu cargo|merchant)/.test(text);
  if (looksLikeSeller) {
    const taggedAmount =
      pickNumber(item, ["amount", "discount_amount", "funded_amount", "funding_amount", "contribution_amount", "benefit_amount"]) ||
      pickNumber(item, ["value"]);
    if (taggedAmount !== null && taggedAmount > 10) return taggedAmount;
  }

  for (const nested of Object.values(item)) {
    const found = pickSellerAmountFromTaggedObject(nested);
    if (found !== null) return found;
  }

  return null;
}

function genericAmountLooksLikePrice(value: any) {
  if (!value || typeof value !== "object") return false;
  const text = [
    value.type,
    value.price_type,
    value.promotion_type,
    value.currency_id,
    value.regular_amount !== undefined ? "regular_amount" : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(discount|seller|fund|funded|contribution|benefit)/.test(text)) return false;
  return /(price|promotion|deal|campaign|regular_amount|ars|usd)/.test(text);
}

function candidatePromoPrice(value: any, itemPrice?: number | null) {
  const directPrice = pickNumber(value, PROMO_PRICE_KEYS);
  if (directPrice !== null) return directPrice;

  const originalPrice = candidateOriginalPrice(value, itemPrice);
  const sellerAmount = candidateSellerAmount(value);
  const genericAmount = pickNumber(value, ["amount"]);
  if (
    originalPrice &&
    genericAmount !== null &&
    genericAmount > 0 &&
    genericAmount < originalPrice &&
    !sellerAmount &&
    genericAmountLooksLikePrice(value)
  ) {
    return genericAmount;
  }

  if (!originalPrice || !sellerAmount) return null;

  const derivedPrice = Math.max(originalPrice - sellerAmount - Number(candidateMeliAmount(value) || 0), 0);
  if (derivedPrice > 0 && derivedPrice < originalPrice) return derivedPrice;

  return null;
}

function promotionScore(value: any) {
  const status = String(value?.status || value?.state || "").toLowerCase();
  const hasPrice = candidatePromoPrice(value) !== null;
  const hasSellerDiscount = candidateSellerAmount(value) !== null;
  let score = 0;
  if (status.includes("active") || status.includes("started") || status.includes("activa")) score += 4;
  if (hasPrice) score += 3;
  if (hasSellerDiscount) score += 2;
  if (pickString(value, ["name", "promotion_name", "campaign_name", "type", "promotion_type"])) score += 1;
  return score;
}

function summarizePromotion(rawResponses: unknown[], itemPrice?: number | null, targetPromoPrice?: number | null): PromotionSummary {
  const allCandidates = collectPromotionCandidates(rawResponses)
    .filter((candidate) => promotionScore(candidate) > 0)
    .sort((a, b) => promotionScore(b) - promotionScore(a));
  const activeCandidates = allCandidates.filter((candidate) => !isScheduledPromotion(candidate) && !isExpiredPromotion(candidate));
  const matchingCandidates = targetPromoPrice
    ? activeCandidates.filter((candidate) => sameMoney(candidatePromoPrice(candidate, itemPrice), targetPromoPrice))
    : [];
  const candidates = (matchingCandidates.length > 0 ? matchingCandidates : activeCandidates).sort((a, b) => {
    const priceA = candidatePromoPrice(a, itemPrice) || Number.MAX_SAFE_INTEGER;
    const priceB = candidatePromoPrice(b, itemPrice) || Number.MAX_SAFE_INTEGER;
    if (priceA !== priceB) return priceA - priceB;
    return promotionScore(b) - promotionScore(a);
  });
  const best = candidates[0] || {};
  const originalPrice =
    candidateOriginalPrice(best, itemPrice);
  const promoPrice = candidatePromoPrice(best, itemPrice);
  const sellerAmount = candidateSellerAmount(best);
  const rawMeliAmount = candidateMeliAmount(best);
  const boostMeliAmount = candidateMeliBoostAmount(best);
  const commissionBasePrice = candidateCommissionBasePrice(best);
  const rawMeliRate =
    pickNumber(best, [
      "meli_discount_rate",
      "meli_percentage",
      "marketplace_percentage",
      "meli_percent",
      "marketplace_percent",
      "platform_percentage",
      "platform_percent",
      "marketplace_contribution_percentage",
      "meli_contribution_percentage",
    ]) ||
    pickNumberDeep(best, [
      "meli_discount_rate",
      "meli_percentage",
      "marketplace_percentage",
      "meli_percent",
      "marketplace_percent",
      "platform_percentage",
      "platform_percent",
      "marketplace_contribution_percentage",
      "meli_contribution_percentage",
    ]) ||
    pickNumberByKeyPattern(best, (key) =>
      /(meli|marketplace|mercado_libre|mercadolibre|platform)/.test(key) &&
      /(rate|percent|percentage)/.test(key)
    );
  const derivedMeliAmount =
    !rawMeliAmount && originalPrice && promoPrice && sellerAmount
      ? Math.max(originalPrice - promoPrice - sellerAmount, 0)
      : null;
  const derivedMeliAmountFromBase =
    !rawMeliAmount && promoPrice && commissionBasePrice && commissionBasePrice > promoPrice
      ? commissionBasePrice - promoPrice
      : null;
  const derivedMeliAmountFromRate =
    !rawMeliAmount && originalPrice && rawMeliRate
      ? (originalPrice * rawMeliRate) / 100
      : null;
  const baseMeliAmount =
    rawMeliAmount ||
    (derivedMeliAmount && derivedMeliAmount > 0.5 ? derivedMeliAmount : null) ||
    (derivedMeliAmountFromBase && derivedMeliAmountFromBase > 0.5 ? derivedMeliAmountFromBase : null) ||
    (derivedMeliAmountFromRate && derivedMeliAmountFromRate > 0.5 ? derivedMeliAmountFromRate : null);
  const meliAmount =
    baseMeliAmount || boostMeliAmount
      ? Number(baseMeliAmount || 0) + Number(boostMeliAmount || 0)
      : null;
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
    rawMeliRate ||
    (originalPrice && meliAmount ? (meliAmount / originalPrice) * 100 : null);

  return {
    originalPrice,
    promoPrice,
    name: promoPrice ? pickString(best, ["name", "promotion_name", "campaign_name", "type", "promotion_type"]) : null,
    status: promoPrice ? pickString(best, ["status", "state"]) : null,
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
  const metadataMeliAmount = pickNumber(metadata, ["meli_discount_amount", "marketplace_discount_amount", "meli_amount", "funding_amount"]);
  const metadataBoostAmount = pickNumber(metadata, MELI_BOOST_AMOUNT_KEYS);
  const meliAmount = metadataMeliAmount || metadataBoostAmount
    ? Number(metadataMeliAmount || 0) + Number(metadataBoostAmount || 0)
    : null;

  return {
    originalPrice,
    promoPrice,
    name: pickString(metadata, ["campaign_name", "promotion_name", "promotion_type", "campaign_id", "promotion_id"]) || "Promo activa",
    status: "active",
    discountAmount,
    discountRate: (discountAmount / originalPrice) * 100,
    sellerAmount: pickNumber(metadata, ["seller_discount_amount", "seller_amount", "seller_funded_amount", "discount_seller_amount"]),
    sellerRate: pickNumber(metadata, ["seller_percentage", "seller_percent", "seller_discount_rate"]),
    meliAmount,
    meliRate: pickNumber(metadata, ["meli_percentage", "marketplace_percentage", "meli_discount_rate"]),
    receiveAmount: pickNumber(metadata, ["receive_amount", "seller_receives_amount", "seller_receive_amount", "net_amount"]),
    raw: [{ endpoint: "item.sale_price", data: salePrice }],
  };
}

function sameMoney(left?: number | null, right?: number | null) {
  if (!left || !right) return false;
  return Math.abs(Number(left) - Number(right)) < 1;
}

async function getPromotionSummaryForItem(
  item: MeliItem,
  account: any,
  options: { lightweight?: boolean } = {},
) {
  const salePriceSummary = summarizeItemSalePrice(item);
  const endpoints = options.lightweight
    ? [`/seller-promotions/items/${item.id}?app_version=v2`]
    : [
      `/items/${item.id}/prices`,
      `/seller-promotions/items/${item.id}?app_version=v2`,
      `/seller-promotions/items/${item.id}/offers?app_version=v2`,
    ];
  const rawResponses = await Promise.all(endpoints.map(async (endpoint) => {
    try {
      const data = await meliFetch(endpoint, account);
      return { endpoint, data };
    } catch (error) {
      return {
        endpoint,
        error: error instanceof Error ? error.message : "No se pudo consultar este endpoint de promociones.",
      };
    }
  }));

  const endpointSummary = summarizePromotion(rawResponses, item.price, salePriceSummary?.promoPrice || null);
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

async function getPriceToWinForItem(item: MeliItem, account: any): Promise<MeliPriceToWin | null> {
  try {
    return await meliFetch(`/items/${item.id}/price_to_win`, account) as MeliPriceToWin;
  } catch {
    return null;
  }
}

async function getListingPriceForItem(item: MeliItem, account: any): Promise<MeliListingPrice | null> {
  const price = Number(item.price || item.base_price || 0);
  const listingTypeId = item.listing_type_id;
  if (!price || !listingTypeId) return null;

  try {
    const params = new URLSearchParams({
      price: String(price),
      listing_type_id: listingTypeId,
    });
    if (item.category_id) params.set("category_id", item.category_id);
    if (item.domain_id) params.set("domain_id", item.domain_id);
    const campaignTag = installmentCampaignTag(item);
    if (campaignTag) params.set("tags", campaignTag);

    const data = await meliFetch(
      `/sites/MLA/listing_prices?${params.toString()}`,
      account,
    );
    const prices = Array.isArray(data) ? data : [];
    return (prices.find((entry: MeliListingPrice) => entry?.listing_type_id === listingTypeId) || prices[0] || null) as MeliListingPrice | null;
  } catch {
    return null;
  }
}

async function getMeliCategory(categoryId: string | null | undefined, account: any): Promise<MeliCategory | null> {
  if (!categoryId) return null;
  try {
    return await meliFetch(`/categories/${categoryId}`, account) as MeliCategory;
  } catch {
    return null;
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

async function getSellerPromotions(account: any): Promise<MeliSellerPromotion[]> {
  try {
    const data = await meliFetch(`/seller-promotions/users/${account.meli_user_id}?app_version=v2`, account);
    return (Array.isArray(data?.results) ? data.results : [])
      .filter((item: MeliSellerPromotion) => item?.id && item?.type)
      .filter((item: MeliSellerPromotion) => {
        const status = String(item.status || "").toLowerCase();
        return status === "started" || status === "pending";
      });
  } catch {
    return [];
  }
}

async function getPromotionItems(
  promotion: MeliSellerPromotion,
  account: any,
  relevantItemIds: Set<string>,
): Promise<MeliPromotionItem[]> {
  if (!promotion.id || !promotion.type) return [];
  const results: MeliPromotionItem[] = [];
  let searchAfter: string | null = null;
  let page = 0;

  do {
    const params = new URLSearchParams({
      promotion_type: promotion.type,
      app_version: "v2",
      limit: "50",
    });
    if (searchAfter) params.set("searchAfter", searchAfter);

    try {
      const data = await meliFetch(`/seller-promotions/promotions/${promotion.id}/items?${params.toString()}`, account);
      const pageResults = Array.isArray(data?.results) ? data.results : [];
      results.push(...pageResults.filter((item: MeliPromotionItem) => item?.id && relevantItemIds.has(item.id)));
      searchAfter = data?.paging?.searchAfter || null;
      page += 1;
      if (!pageResults.length) break;
    } catch {
      break;
    }
  } while (searchAfter && page < 8);

  return results;
}

function promotionDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function promotionPrice(item: MeliPromotionItem) {
  return Number(item.price || item.suggested_discounted_price || item.total_price_for_boosted_offer || 0) || null;
}

function promotionBasePrice(item: MeliPromotionItem) {
  return Number(item.price || item.suggested_discounted_price || 0) || null;
}

function splitDiscountAmount(
  item: MeliPromotionItem,
  side: "meli" | "seller",
) {
  const original = Number(item.original_price || 0);
  const promoPrice = Number(promotionBasePrice(item) || promotionPrice(item) || 0);
  const sellerRate = Number(item.seller_percentage || 0);
  const meliRate = Number(item.meli_percentage || 0);
  const totalRate = sellerRate + meliRate;
  const totalDiscount = original > 0 && promoPrice > 0 ? Math.max(original - promoPrice, 0) : 0;
  if (!totalDiscount || !totalRate) return null;
  const rate = side === "meli" ? meliRate : sellerRate;
  return rate > 0 ? (totalDiscount * rate) / totalRate : null;
}

function promotionMeliAmount(item: MeliPromotionItem) {
  const baseAmount = splitDiscountAmount(item, "meli");
  const boostAmount = Number(item.discount_meli_boost_amount || 0);
  return baseAmount || boostAmount ? Number(baseAmount || 0) + boostAmount : null;
}

function promotionSellerAmount(item: MeliPromotionItem) {
  return splitDiscountAmount(item, "seller");
}

function promotionOpportunityKey(row: {
  promotion_id?: string | null;
  meli_item_id?: string | null;
  offer_id?: string | null;
  item_promotion_status?: string | null;
}) {
  return [
    row.promotion_id || "",
    row.meli_item_id || "",
    row.offer_id || "",
    row.item_promotion_status || "",
  ].join("|");
}

function promotionOpportunityRowFromItem(
  item: MeliPromotionItem,
  promotion: MeliSellerPromotion | null,
  itemId: string,
) {
  const promoPrice = promotionPrice(item);
  const row = {
    promotion_id: promotion?.id || item.id || item.ref_id || item.type || "promo",
    promotion_name: promotion?.name || (item as { name?: string | null }).name || null,
    promotion_type: promotion?.type || (item as { type?: string | null }).type || null,
    promotion_status: promotion?.status || null,
    item_promotion_status: item.status || null,
    offer_id: item.offer_id || item.ref_id || null,
    meli_item_id: itemId,
    original_price: Number(item.original_price || 0) || null,
    promo_price: promoPrice,
    min_discounted_price: Number(item.min_discounted_price || 0) || null,
    max_discounted_price: Number(item.max_discounted_price || 0) || null,
    suggested_discounted_price: Number(item.suggested_discounted_price || 0) || null,
    seller_percentage: Number(item.seller_percentage || 0) || null,
    meli_percentage: Number(item.meli_percentage || 0) || null,
    seller_amount: promotionSellerAmount(item),
    meli_amount: promotionMeliAmount(item),
    start_date: promotionDate(item.start_date || promotion?.start_date),
    end_date: promotionDate(item.end_date || promotion?.finish_date),
    raw: item,
    last_sync_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return row;
}

function itemThumbnail(item: MeliItem) {
  return item.thumbnail || item.pictures?.[0]?.secure_url || item.pictures?.[0]?.url || null;
}

function positiveFeeNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function marketplaceFeeRate(listingPrice: MeliListingPrice | null) {
  if (!listingPrice) return 0;
  const details = listingPrice.sale_fee_details || {};
  const directRate = positiveFeeNumber(details.meli_percentage_fee) || positiveFeeNumber(details.percentage_fee);
  if (directRate) return directRate;

  const baseAmount = positiveFeeNumber(details.gross_amount);
  const saleFeeAmount = positiveFeeNumber(listingPrice.sale_fee_amount);
  if (!baseAmount || !saleFeeAmount) return 0;

  const financingAmount = positiveFeeNumber(details.financing_add_on_fee);
  const fixedFee = positiveFeeNumber(details.fixed_fee);
  const variableFee = Math.max(0, saleFeeAmount - financingAmount - fixedFee);
  const derivedRate = ((variableFee || saleFeeAmount) / baseAmount) * 100;
  return Number.isFinite(derivedRate) && derivedRate > 0 ? derivedRate : 0;
}

function financingFeeRate(listingPrice: MeliListingPrice | null) {
  const details = listingPrice?.sale_fee_details || {};
  const financingAmount = positiveFeeNumber(details.financing_add_on_fee);
  if (!financingAmount) return 0;

  const baseAmount =
    positiveFeeNumber(details.gross_amount) ||
    positiveFeeNumber(listingPrice?.sale_fee_amount);
  if (!baseAmount) return 0;

  const rate = (financingAmount / baseAmount) * 100;
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function fixedFeeAmount(listingPrice: MeliListingPrice | null) {
  return positiveFeeNumber(listingPrice?.sale_fee_details?.fixed_fee);
}

function optionCodeForInstallments(count: number | null) {
  if (!count || count <= 1) return "MC";
  return `MP${count}`;
}

function optionCodeByFinancingRate(rate: number, options: CurrentInstallmentFee[]) {
  if (!Number.isFinite(rate) || rate <= 0.01) return "MC";

  const candidates = options.filter((option) => Number(option.installment_count || 0) > 1);
  let best: { code: string; distance: number } | null = null;

  candidates.forEach((option) => {
    const distance = Math.abs(Number(option.financing_fee_rate || 0) - rate);
    if (!best || distance < best.distance) best = { code: option.code, distance };
  });

  return best && best.distance <= 1.5 ? best.code : null;
}

function addCategoryObservation(
  observations: Map<string, CategoryFeeObservation>,
  productCategory: string | null | undefined,
  listingPrice: MeliListingPrice | null,
  meliCategory: MeliCategory | null,
) {
  const category = (productCategory || "").trim();
  const rate = marketplaceFeeRate(listingPrice);
  if (!category || !Number.isFinite(rate) || rate <= 0) return;

  const current = observations.get(category) || { rate: 0, meliCategories: new Map<string, string>() };
  current.rate = Math.max(current.rate, rate);
  if (meliCategory?.id) current.meliCategories.set(meliCategory.id, meliCategory.name || meliCategory.id);
  observations.set(category, current);
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient();
  const startedAt = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const targetSkus = normalizeSkuList(body?.skus);
    const promotionsOnly = body?.scope === "promotions";
    const shippingOnly = body?.scope === "shipping";
    const account = await getConnectedMeliAccount();
    if (!account) {
      return NextResponse.json({ error: "Primero conectá MercadoLibre." }, { status: 400 });
    }

    const listingTypeNames = promotionsOnly ? new Map<string, string>() : await getListingTypeNames(account);

    let productsQuery = supabase.from("products").select("*");
    productsQuery = targetSkus.length
      ? productsQuery.in("sku", targetSkus)
      : productsQuery.eq("status", "active");

    const { data: products, error: productsError } = await productsQuery;

    if (productsError) throw new Error(productsError.message);

    const { data: currentInstallmentFees, error: installmentFeesError } = promotionsOnly
      ? { data: [], error: null }
      : await supabase
        .from("mercadolibre_installment_fees")
        .select("code, installment_count, financing_fee_rate")
        .eq("channel_type", "mercadolibre");

    if (installmentFeesError) throw new Error(installmentFeesError.message);

    const productsBySku = new Map<string, Product>();
    (products || []).forEach((product: Product) => {
      productsBySku.set(normalizeSku(product.sku), product);
    });

    const statusesToSync = ["active", "paused"];
    const limit = 50;
    const totalsByStatus: Record<string, number> = {};
    let itemIds: string[] = [];
    let skuSearches: Record<string, number> = {};

    if (targetSkus.length) {
      const targetedSearch = await getItemIdsBySkus(account, targetSkus);
      itemIds = targetedSearch.itemIds;
      skuSearches = targetedSearch.searches;
      totalsByStatus.sku_search = itemIds.length;
    } else {
      const foundItemIds = new Set<string>();

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
          results.forEach((id: string) => foundItemIds.add(id));
          offset += limit;
        } while (offset < total && offset < 1000);
      }

      itemIds = [...foundItemIds];
    }

    const items: MeliItem[] = [];
    for (const ids of chunk(itemIds, 20)) {
      const data = await meliFetch(`/items?ids=${ids.join(",")}`, account);
      (Array.isArray(data) ? data : []).forEach((entry: any) => {
        if (entry?.body?.id) items.push(entry.body as MeliItem);
      });
    }

    const shippingCostsByItem = new Map<string, { cost: number; source: string | null }>();
    const promotionsByItem = new Map<string, PromotionSummary>();
    const detailedItemsByItem = new Map<string, MeliItem>();
    const priceToWinByItem = new Map<string, MeliPriceToWin | null>();
    const listingPriceByItem = new Map<string, MeliListingPrice | null>();
    const meliCategoriesById = new Map<string, MeliCategory | null>();
    const categoryFeeObservations = new Map<string, CategoryFeeObservation>();
    const financingFeeObservations = new Map<string, number[]>();

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

      const detailedItem = promotionsOnly
        ? item
        : detailedItemsByItem.get(item.id) || await getDetailedItemForPricing(item, account);
      detailedItemsByItem.set(item.id, detailedItem);
      const result = await getPromotionSummaryForItem(detailedItem, account, { lightweight: promotionsOnly });
      promotionsByItem.set(item.id, result);
      return result;
    }

    async function priceToWinForMatchedItem(item: MeliItem) {
      if (priceToWinByItem.has(item.id)) return priceToWinByItem.get(item.id) || null;

      const result = await getPriceToWinForItem(item, account);
      priceToWinByItem.set(item.id, result);
      return result;
    }

    async function listingPriceForMatchedItem(item: MeliItem) {
      if (listingPriceByItem.has(item.id)) return listingPriceByItem.get(item.id) || null;

      const detailedItem = item.price && item.listing_type_id
        ? detailedItemsByItem.get(item.id) || item
        : detailedItemsByItem.get(item.id) || await getDetailedItemForPricing(item, account);
      detailedItemsByItem.set(item.id, detailedItem);
      const result = await getListingPriceForItem(detailedItem, account);
      listingPriceByItem.set(item.id, result);
      return result;
    }

    async function meliCategoryForMatchedItem(item: MeliItem) {
      const detailedItem = detailedItemsByItem.get(item.id) || await getDetailedItemForPricing(item, account);
      detailedItemsByItem.set(item.id, detailedItem);
      const categoryId = detailedItem.category_id || item.category_id || null;
      if (!categoryId) return null;
      if (meliCategoriesById.has(categoryId)) return meliCategoriesById.get(categoryId) || null;

      const result = await getMeliCategory(categoryId, account);
      meliCategoriesById.set(categoryId, result);
      return result;
    }

    const matchedItemsForFetch = items.filter((item) =>
      getItemSkus(item).some((sku) => Boolean(productsBySku.get(sku)?.id)),
    );
    const matchedItemIds = new Set(matchedItemsForFetch.map((item) => item.id));

    await mapWithConcurrency(matchedItemsForFetch, promotionsOnly || shippingOnly ? 8 : 4, async (item) => {
      if (promotionsOnly) {
        detailedItemsByItem.set(item.id, item);
        await promotionForMatchedItem(item);
        return;
      }

      if (shippingOnly) {
        detailedItemsByItem.set(item.id, item);
        await Promise.all([
          shippingCostForMatchedItem(item),
          listingPriceForMatchedItem(item),
        ]);
        return;
      }

      const detailedItem = await getDetailedItemForPricing(item, account);
      detailedItemsByItem.set(item.id, detailedItem);
      await Promise.all([
        shippingCostForMatchedItem(item),
        promotionForMatchedItem(item),
        priceToWinForMatchedItem(item),
        listingPriceForMatchedItem(item),
      ]);
    });

    const sellerPromotions = shippingOnly ? [] : await getSellerPromotions(account);
    const sellerPromotionsById = new Map(sellerPromotions.map((promotion) => [promotion.id, promotion]));
    const promotionOpportunityRows: any[] = [];
    const promotionOpportunityKeys = new Set<string>();

    function pushPromotionOpportunityRow(row: any) {
      const key = promotionOpportunityKey(row);
      if (promotionOpportunityKeys.has(key)) return;
      promotionOpportunityKeys.add(key);
      promotionOpportunityRows.push(row);
    }

    if (!shippingOnly) matchedItemsForFetch.forEach((item) => {
      const promotionSummary = promotionsByItem.get(item.id);
      const rawResponses = Array.isArray(promotionSummary?.raw) ? promotionSummary.raw : [];
      rawResponses.forEach((entry) => {
        const payload = entry as { endpoint?: string; data?: unknown };
        if (!payload.endpoint?.includes(`/seller-promotions/items/${item.id}`) || !Array.isArray(payload.data)) return;
        payload.data.forEach((rawPromotion) => {
          const promotionItem = rawPromotion as MeliPromotionItem & { type?: string | null; name?: string | null };
          if (!promotionItem.id || !promotionItem.status) return;
          const promotion = sellerPromotionsById.get(String(promotionItem.id)) || null;
          pushPromotionOpportunityRow(promotionOpportunityRowFromItem(promotionItem, promotion, item.id));
        });
      });
    });

    if (!shippingOnly && targetSkus.length) {
      const idsToRefresh = [...matchedItemIds];
      if (idsToRefresh.length) {
        await supabase.from("mercadolibre_promotion_opportunities").delete().in("meli_item_id", idsToRefresh);
      }
    } else if (!shippingOnly) {
      await supabase.from("mercadolibre_promotion_opportunities").delete().neq("promotion_id", "__never__");
    }
    if (!shippingOnly) {
      for (const batch of chunk(promotionOpportunityRows, 200)) {
        const { error: promoSaveError } = await supabase.from("mercadolibre_promotion_opportunities").insert(batch);
        if (promoSaveError) throw new Error(promoSaveError.message);
      }
    }

    if (promotionsOnly) {
      const now = new Date().toISOString();
      const currentRowsByItem = new Map<string, { id: string; product_id: string; meli_item_id: string }[]>();
      const updateRows: any[] = [];
      const insertRows: any[] = [];

      for (const ids of chunk([...matchedItemIds], 100)) {
        const { data: currentRows, error: currentRowsError } = await supabase
          .from("mercadolibre_shipping_costs")
          .select("id, product_id, meli_item_id")
          .in("meli_item_id", ids);

        if (currentRowsError) throw new Error(currentRowsError.message);

        (currentRows || []).forEach((row: { id: string; product_id: string; meli_item_id: string }) => {
          const rows = currentRowsByItem.get(row.meli_item_id) || [];
          rows.push(row);
          currentRowsByItem.set(row.meli_item_id, rows);
        });
      }

      for (const item of matchedItemsForFetch) {
        const promotionResult = await promotionForMatchedItem(item);

        for (const sku of getItemSkus(item)) {
          const product = productsBySku.get(sku);
          if (!product?.id) continue;

          const current = (currentRowsByItem.get(item.id) || []).find((row) => row.product_id === product.id);
          const promoPayload = {
            meli_price: Number(item.price ?? 0) || null,
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
            meli_status: item.status || null,
            meli_stock: Number(item.available_quantity ?? 0),
            meli_last_sync_at: now,
            updated_at: now,
          };

          if (!current) {
            insertRows.push({
              product_id: product.id,
              sku: product.sku,
              fixed_fee_amount: 0,
              shipping_cost_amount: 0,
              free_shipping: Boolean(item.shipping?.free_shipping ?? true),
              shipping_method: item.shipping?.logistic_type || item.shipping?.mode || "mercado_envios",
              notes: `Sincronizado desde MercadoLibre ${item.id} · promos`,
              active: true,
              meli_item_id: item.id,
              meli_thumbnail: itemThumbnail(item),
              meli_title: item.title || null,
              meli_permalink: item.permalink || null,
              meli_currency_id: item.currency_id || null,
              meli_listing_type_id: item.listing_type_id || null,
              meli_sale_terms: item.sale_terms || [],
              meli_tags: item.tags || [],
              meli_free_shipping: Boolean(item.shipping?.free_shipping),
              meli_shipping_mode: item.shipping?.mode || null,
              meli_logistic_type: item.shipping?.logistic_type || null,
              meli_catalog_listing: Boolean(item.catalog_listing),
              meli_catalog_product_id: item.catalog_product_id || null,
              meli_domain_id: item.domain_id || null,
              ...promoPayload,
            });
            continue;
          }

          updateRows.push({
            id: current.id,
            ...promoPayload,
          });
        }
      }

      await mapWithConcurrency(updateRows, 8, async (row) => {
        const { id, ...payload } = row;
        const { error: updateError } = await supabase
          .from("mercadolibre_shipping_costs")
          .update(payload)
          .eq("id", id);
        if (updateError) throw new Error(updateError.message);
      });

      for (const batch of chunk(insertRows, 100)) {
        const { error: insertError } = await supabase
          .from("mercadolibre_shipping_costs")
          .insert(batch);
        if (insertError) throw new Error(insertError.message);
      }

      return NextResponse.json({
        ok: true,
        scope: "promotions",
        total_items: items.length,
        statuses_synced: statusesToSync,
        totals_by_status: totalsByStatus,
        matched: matchedItemsForFetch.length,
        updated: updateRows.length,
        inserted: insertRows.length,
        target_skus: targetSkus,
        targeted_sync: targetSkus.length > 0,
        sku_searches: skuSearches,
        duration_ms: Date.now() - startedAt,
        promotion_queries: promotionsByItem.size,
        seller_promotions: sellerPromotions.length,
        promotion_opportunities: promotionOpportunityRows.length,
      });
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
        const promotionResult = shippingOnly ? null : await promotionForMatchedItem(item);
        const detailedItem = detailedItemsByItem.get(item.id) || item;
        const priceToWinResult = shippingOnly ? null : await priceToWinForMatchedItem(item);
        const listingPriceResult = await listingPriceForMatchedItem(item);
        const meliCategoryResult = shippingOnly ? null : await meliCategoryForMatchedItem(item);
        const newShippingCost = Number(shippingResult?.cost || 0);
        const newFixedFeeAmount = fixedFeeAmount(listingPriceResult);
        const shippingSource = shippingResult?.source || null;
        const { data: current } = await supabase
          .from("mercadolibre_shipping_costs")
          .select("*")
          .eq("product_id", product.id)
          .eq("meli_item_id", item.id)
          .maybeSingle();

        const oldShippingCost = Number(current?.shipping_cost_amount || 0);
        matched += 1;
        if (!shippingOnly) addCategoryObservation(categoryFeeObservations, product.category, listingPriceResult, meliCategoryResult);

        const detectedInstallmentsText = detectInstallmentsText(
          detailedItem,
          detailedItem.listing_type_id ? listingTypeNames.get(detailedItem.listing_type_id) || detailedItem.listing_type_id : null,
        );
        const detectedInstallments = installmentCountFromText(detectedInstallmentsText);
        const detectedFinancingFeeRate = financingFeeRate(listingPriceResult);
        const optionCode =
          detectedInstallments
            ? optionCodeForInstallments(detectedInstallments)
            : optionCodeByFinancingRate(detectedFinancingFeeRate, (currentInstallmentFees || []) as CurrentInstallmentFee[]);

        if (!shippingOnly && optionCode && optionCode !== "MC" && Number.isFinite(detectedFinancingFeeRate) && detectedFinancingFeeRate > 0) {
          const currentRates = financingFeeObservations.get(optionCode) || [];
          currentRates.push(detectedFinancingFeeRate);
          financingFeeObservations.set(optionCode, currentRates);
        }

        const promotionPayload = promotionResult ? {
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
        } : {};

        const metadataPayload = {
          meli_item_id: item.id,
          meli_thumbnail: itemThumbnail(detailedItem),
          meli_title: detailedItem.title || null,
          meli_permalink: detailedItem.permalink || null,
          meli_price: Number(detailedItem.price ?? 0) || null,
          meli_currency_id: detailedItem.currency_id || null,
          ...promotionPayload,
          meli_listing_type_id: detailedItem.listing_type_id || null,
          meli_listing_type_name: detailedItem.listing_type_id ? listingTypeNames.get(detailedItem.listing_type_id) || detailedItem.listing_type_id : null,
          ...(shippingOnly ? {} : {
            meli_sale_fee_amount: Number(listingPriceResult?.sale_fee_amount || 0) || null,
            meli_sale_fee_details: listingPriceResult?.sale_fee_details || null,
            meli_financing_fee_rate: detectedFinancingFeeRate,
          }),
          meli_sale_terms: detailedItem.sale_terms || [],
          meli_tags: detailedItem.tags || [],
          meli_installments_text: detectedInstallmentsText,
          meli_status: detailedItem.status || null,
          meli_stock: Number(detailedItem.available_quantity ?? 0),
          meli_free_shipping: Boolean(detailedItem.shipping?.free_shipping),
          meli_shipping_mode: detailedItem.shipping?.mode || null,
          meli_logistic_type: detailedItem.shipping?.logistic_type || null,
          meli_catalog_listing: Boolean(detailedItem.catalog_listing),
          meli_catalog_product_id: detailedItem.catalog_product_id || priceToWinResult?.catalog_product_id || null,
          meli_domain_id: detailedItem.domain_id || null,
          ...(shippingOnly ? {} : {
            meli_catalog_status: priceToWinResult?.status || null,
            meli_catalog_price_to_win: Number(priceToWinResult?.price_to_win || 0) || null,
            meli_catalog_current_price: Number(priceToWinResult?.current_price || 0) || null,
            meli_catalog_consistent: priceToWinResult?.consistent ?? null,
            meli_catalog_visit_share: priceToWinResult?.visit_share !== undefined && priceToWinResult?.visit_share !== null
              ? String(priceToWinResult.visit_share)
              : null,
            meli_catalog_competitors_sharing_first_place: priceToWinResult?.competitors_sharing_first_place ?? null,
            meli_catalog_reason: priceToWinResult?.reason || [],
          }),
          meli_cost_source: shippingSource || null,
          meli_last_sync_at: now,
        };

        if (!newShippingCost) {
          noShippingCost += 1;

          const shippingPayload: Record<string, unknown> = {
            product_id: product.id,
            sku: product.sku,
            fixed_fee_amount: newFixedFeeAmount || Number(current?.fixed_fee_amount || 0),
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

        const shippingPayload: Record<string, unknown> = {
          product_id: product.id,
          sku: product.sku,
          fixed_fee_amount: newFixedFeeAmount || Number(current?.fixed_fee_amount || 0),
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

    const categoryFeeRows = [...categoryFeeObservations.entries()].map(([category, observation]) => {
      const meliCategoryIds = [...observation.meliCategories.keys()];
      const meliCategoryNames = [...observation.meliCategories.values()];
      const sourceLabel = meliCategoryNames.length
        ? `MercadoLibre: ${meliCategoryNames.slice(0, 4).join(", ")}${meliCategoryNames.length > 4 ? "..." : ""}`
        : "MercadoLibre listing_prices";

      return {
        category,
        marketplace_fee_rate: Number(observation.rate.toFixed(3)),
        active: true,
        notes: `Sincronizado desde ${sourceLabel}`,
        meli_category_ids: meliCategoryIds,
        meli_category_names: meliCategoryNames,
        meli_source: "listing_prices.sale_fee_details",
        meli_last_sync_at: now,
        updated_at: now,
      };
    });

    if (categoryFeeRows.length) {
      const { error: categoryFeeError } = await supabase
        .from("mercadolibre_category_fees")
        .upsert(categoryFeeRows, { onConflict: "category" });
      if (categoryFeeError) throw new Error(categoryFeeError.message);
    }

    let installmentFeeUpdates = 0;
    for (const [code, rates] of financingFeeObservations.entries()) {
      if (!rates.length) continue;
      const rate = Math.max(...rates.filter((value) => Number.isFinite(value)));
      if (!Number.isFinite(rate) || rate <= 0) continue;

      const { error: installmentFeeError } = await supabase
        .from("mercadolibre_installment_fees")
        .update({
          financing_fee_rate: Number(rate.toFixed(3)),
          notes: `Sincronizado desde MercadoLibre listing_prices (${rates.length} publicaciones)`,
          updated_at: now,
        })
        .eq("code", code);

      if (installmentFeeError) throw new Error(installmentFeeError.message);
      installmentFeeUpdates += 1;
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
      target_skus: targetSkus,
      targeted_sync: targetSkus.length > 0,
      sku_searches: skuSearches,
      duration_ms: Date.now() - startedAt,
      shipping_queries: shippingCostsByItem.size,
      promotion_queries: promotionsByItem.size,
      listing_price_queries: listingPriceByItem.size,
      seller_promotions: sellerPromotions.length,
      promotion_opportunities: promotionOpportunityRows.length,
      category_fee_updates: categoryFeeRows.length,
      installment_fee_updates: installmentFeeUpdates,
      logs: logs.slice(0, 50),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar MercadoLibre.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
