"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import {
  calculatePriceSummary,
  defaultTaxSettings,
  mercadoLibreClassicOption,
  moneyWithCents,
  normalizeOption,
  percent,
} from "@/lib/pricing";
import type {
  MercadoLibreCategoryFee,
  MercadoLibreInstallmentFee,
  MercadoLibrePriceOption,
  MercadoLibrePromotionOpportunity,
  MercadoLibreShippingCost,
  Product,
  ProductChannelMargin,
  TaxSettings,
} from "@/lib/types";

type ProductPromoGroup = {
  product: Product;
  publications: MercadoLibreShippingCost[];
  opportunities: MercadoLibrePromotionOpportunity[];
  activePromotionCount: number;
  bestMeliAmount: number;
  bestMeliRate: number;
  minPrice: number | null;
  thumbnail: string | null;
  latestSync: string | null;
};

type PublicationVariantGroup = {
  key: string;
  title: string;
  catalogProductId: string | null;
  domainId: string | null;
  branchKind: "catalog_listing" | "seller_listing";
  itemIds: string[];
  rows: PublicationPromoRow[];
};

type PublicationPromoRow = {
  publication: MercadoLibreShippingCost;
  opportunities: MercadoLibrePromotionOpportunity[];
  installmentCount: number;
  installmentLabel: string;
  bestOpportunity: MercadoLibrePromotionOpportunity | null;
};

type InstallmentSummary = {
  label: string;
  publication: MercadoLibreShippingCost;
  row: PublicationPromoRow;
  opportunityCount: number;
  bestOpportunity: MercadoLibrePromotionOpportunity | null;
  bestMeliAmount: number;
  promoPrice: number | null;
  effectiveSalePrice: number | null;
  rentability: number | null;
  netProfit: number | null;
};

type PromoComparison = {
  key: string;
  promotionId?: string | null;
  status: "Vigente" | "Para activar";
  name: string;
  promoPrice: number | null;
  effectiveSalePrice: number | null;
  meliAmount: number;
  meliRate: number;
  sellerAmount: number;
  sellerRate: number;
  rentability: number | null;
  netProfit: number | null;
  startDate?: string | null;
  endDate?: string | null;
  joined?: boolean;
  scheduled?: boolean;
};

type PromoTrafficLightItem = {
  key: string;
  sku: string;
  title: string;
  itemId: string;
  installmentCount: number;
  installmentLabel: string;
  promotionName: string;
  promoPrice: number | null;
  effectiveSalePrice: number | null;
  meliAmount: number;
  meliRate: number;
  sellerAmount: number;
  sellerRate: number;
  startDate?: string | null;
  endDate?: string | null;
  margin: number;
  netProfit: number;
  status: "Vigente" | "Para activar";
  activeMargin?: number | null;
  activeEffectiveSalePrice?: number | null;
};

type PromoTrafficLightGroup = {
  sku: string;
  productName: string;
  items: PromoTrafficLightItem[];
};

type PromoTrafficLights = {
  red: PromoTrafficLightGroup[];
  yellow: PromoTrafficLightGroup[];
  scheduled: PromoTrafficLightGroup[];
  scheduledShared: PromoTrafficLightGroup[];
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

function hasFutureStart(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return false;
  return true;
}

function futureStartLabel(value?: string | null) {
  if (!hasFutureStart(value)) return null;
  return `Arranca ${formatDateTime(value)}`;
}

function isCurrentOpportunity(item: MercadoLibrePromotionOpportunity) {
  const status = `${item.promotion_status || ""} ${item.item_promotion_status || ""}`.toLowerCase();
  if (/finished|expired|ended|cancel|closed|inactive/.test(status)) return false;
  const end = item.end_date ? new Date(item.end_date).getTime() : 0;
  return !end || end > Date.now();
}

function isActiveOpportunity(item: MercadoLibrePromotionOpportunity) {
  const itemStatus = String(item.item_promotion_status || "").toLowerCase();
  if (itemStatus) return /started|active/.test(itemStatus);
  return /started|active/.test(String(item.promotion_status || "").toLowerCase());
}

function isActivePromotionStatus(value?: string | null) {
  return /started|active|vigente/.test(String(value || "").toLowerCase());
}

function isScheduledOpportunity(item: MercadoLibrePromotionOpportunity) {
  const status = `${item.promotion_status || ""} ${item.item_promotion_status || ""}`.toLowerCase();
  const offerId = String(item.offer_id || "").toUpperCase();
  if (/program|scheduled/.test(status)) return true;
  if (/pending/.test(status) && offerId.startsWith("OFFER")) return true;
  const start = item.start_date ? new Date(item.start_date).getTime() : 0;
  return Boolean(start && Number.isFinite(start) && start > Date.now());
}

function isJoinedOpportunity(item: MercadoLibrePromotionOpportunity) {
  const status = String(item.item_promotion_status || "").toLowerCase();
  if (/started|active/.test(status)) return true;
  return false;
}

function productKey(product: Product) {
  return product.id || product.sku;
}

function installmentCampaignTag(publication?: MercadoLibreShippingCost | null) {
  if (!publication) return null;
  const saleTerms = Array.isArray(publication.meli_sale_terms) ? publication.meli_sale_terms : [];
  const searchable = [
    ...(Array.isArray(publication.meli_tags) ? publication.meli_tags : []),
    ...saleTerms.flatMap((term) => {
      const value = term as { id?: string; name?: string; value_name?: string; value_id?: string };
      return [value.id, value.name, value.value_name, value.value_id];
    }),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (searchable.includes("3x_campaign")) return "3x_campaign";
  if (searchable.includes("9x_campaign")) return "9x_campaign";
  if (searchable.includes("12x_campaign")) return "12x_campaign";
  return null;
}

function installmentLabel(publication: MercadoLibreShippingCost) {
  const campaignTag = installmentCampaignTag(publication);
  if (campaignTag === "3x_campaign") return "3 cuotas";
  if (campaignTag === "9x_campaign") return "9 cuotas";
  if (campaignTag === "12x_campaign") return "12 cuotas";
  if (publication.meli_installments_text) return publication.meli_installments_text;
  if (publication.meli_listing_type_id === "gold_special") return "1 pago";
  if (publication.meli_listing_type_id === "gold_pro") return "6 cuotas";
  return "Sin dato";
}

function installmentCountFromLabel(label: string) {
  const normalized = label.toLowerCase();
  const match = normalized.match(/(\d{1,2})\s*(x|cuotas?)/i);
  if (match?.[1]) return Number(match[1]);
  if (normalized.includes("1 pago") || normalized.includes("clasica") || normalized.includes("clásica")) return 1;
  return 999;
}

function publicationTags(publication: MercadoLibreShippingCost) {
  return Array.isArray(publication.meli_tags) ? publication.meli_tags.map((tag) => String(tag)) : [];
}

function publicationBranchKind(publication: MercadoLibreShippingCost): "catalog_listing" | "seller_listing" {
  return publicationTags(publication).includes("user_product_listing") ? "catalog_listing" : "seller_listing";
}

function normalizedPublicationTitle(publication: MercadoLibreShippingCost) {
  return (publication.meli_title || publication.sku || publication.meli_item_id || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(1|3|6|9|12)\s*(x|cuotas?)\b/g, "")
    .replace(/\b(clasica|premium|sin cuotas|con cuotas)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function publicationFamilyKey(publication: MercadoLibreShippingCost) {
  const sku = publication.sku || "sin-sku";
  const branchKind = publicationBranchKind(publication);
  const catalogKey = publication.meli_catalog_product_id
    ? `catalog:${publication.meli_catalog_product_id}`
    : `domain:${publication.meli_domain_id || "sin-domain"}:${normalizedPublicationTitle(publication)}`;
  return `${sku}|${catalogKey}|${branchKind}`;
}

function publicationBranchLabel(branchKind: PublicationVariantGroup["branchKind"]) {
  return branchKind === "catalog_listing" ? "Catalogo ML" : "Publicacion vendedor";
}

function hasMeliContribution(item?: MercadoLibrePromotionOpportunity | null) {
  return Number(item?.meli_amount || 0) > 0 || Number(item?.meli_percentage || 0) > 0;
}

function publicationHasMeliContribution(publication: MercadoLibreShippingCost) {
  return Number(publication.meli_promo_meli_amount || 0) > 0 || Number(publication.meli_promo_meli_rate || 0) > 0;
}

function samePrice(left?: number | null, right?: number | null) {
  if (!left || !right) return false;
  return Math.abs(Number(left) - Number(right)) < 1;
}

function publicationPromotionDates(
  publication: MercadoLibreShippingCost,
  promoName?: string | null,
  promoPrice?: number | null,
) {
  const raw = Array.isArray(publication.meli_promotions) ? publication.meli_promotions : [];
  const targetName = String(promoName || "").toLowerCase();

  for (const entry of raw) {
    const payload = entry as { data?: unknown };
    const data = payload.data;
    if (Array.isArray(data)) {
      const match = data.find((item) => {
        const promo = item as Record<string, unknown>;
        const name = String(promo.name || promo.type || "").toLowerCase();
        const price = Number(promo.price || promo.total_price_for_boosted_offer || 0);
        return (
          (targetName && name && (name === targetName || name.includes(targetName) || targetName.includes(name))) ||
          samePrice(price, promoPrice)
        );
      }) as Record<string, unknown> | undefined;
      if (match) {
        return {
          startDate: typeof match.start_date === "string" ? match.start_date : null,
          endDate: typeof match.finish_date === "string" ? match.finish_date : typeof match.end_date === "string" ? match.end_date : null,
        };
      }
    }

    const prices = (data as { prices?: unknown[] } | null)?.prices;
    if (Array.isArray(prices)) {
      const match = prices.find((item) => {
        const price = item as { amount?: number | null };
        return samePrice(price.amount, promoPrice);
      }) as { conditions?: { start_time?: string | null; end_time?: string | null } } | undefined;
      if (match?.conditions) {
        return {
          startDate: match.conditions.start_time || null,
          endDate: match.conditions.end_time || null,
        };
      }
    }
  }

  return { startDate: null, endDate: null };
}

function meliContributionAmount(
  promoPrice?: number | null,
  meliAmount?: number | null,
  meliRate?: number | null,
  originalPrice?: number | null,
  sellerRate?: number | null,
) {
  const amount = Number(meliAmount || 0);
  if (amount > 0) return amount;
  const price = Number(promoPrice || 0);
  const rate = Number(meliRate || 0);
  const seller = Number(sellerRate || 0);
  const original = Number(originalPrice || 0);
  const totalRate = rate + seller;
  const totalDiscount = original > 0 && price > 0 ? Math.max(original - price, 0) : 0;
  if (totalDiscount > 0 && totalRate > 0 && rate > 0) return (totalDiscount * rate) / totalRate;
  return 0;
}

function effectiveSalePrice(
  promoPrice?: number | null,
  meliAmount?: number | null,
  meliRate?: number | null,
  originalPrice?: number | null,
  sellerRate?: number | null,
) {
  const price = Number(promoPrice || 0);
  if (!price) return null;
  return price + meliContributionAmount(price, meliAmount, meliRate, originalPrice, sellerRate);
}

function rawPromotionOpportunities(publication: MercadoLibreShippingCost): MercadoLibrePromotionOpportunity[] {
  const raw = Array.isArray(publication.meli_promotions) ? publication.meli_promotions : [];
  const sellerPromotionPayload = raw.find((entry) => {
    const value = entry as { endpoint?: string; data?: unknown };
    return value.endpoint?.includes("/seller-promotions/items/") && Array.isArray(value.data);
  }) as { data?: unknown[] } | undefined;

  if (!Array.isArray(sellerPromotionPayload?.data)) return [];

  return sellerPromotionPayload.data
    .map((item) => {
      const promo = item as Record<string, unknown>;
      const originalPrice = Number(promo.original_price || publication.meli_price || 0);
      const basePromoPrice =
        Number(promo.price || 0) ||
        Number(promo.suggested_discounted_price || 0) ||
        null;
      const promoPrice =
        basePromoPrice ||
        Number(promo.total_price_for_boosted_offer || 0) ||
        null;
      const meliPercentage = Number(promo.meli_percentage || 0);
      const sellerPercentage = Number(promo.seller_percentage || 0);
      const baseDiscount = originalPrice && basePromoPrice ? Math.max(originalPrice - basePromoPrice, 0) : 0;
      const totalContributionRate = meliPercentage + sellerPercentage;
      const boostMeliAmount = Number(promo.discount_meli_boost_amount || promo.discount_meli_boosted_amount || 0);
      const meliAmount =
        Number(promo.meli_amount || 0) ||
        (baseDiscount && totalContributionRate && meliPercentage ? (baseDiscount * meliPercentage) / totalContributionRate : 0);
      const sellerAmount =
        Number(promo.seller_amount || 0) ||
        Number(promo.discount_amount || 0) ||
        (baseDiscount && totalContributionRate && sellerPercentage ? (baseDiscount * sellerPercentage) / totalContributionRate : 0);

      return {
        promotion_id: String(promo.id || promo.ref_id || promo.type || "promo"),
        promotion_name: String(promo.name || promo.type || "Promocion ML"),
        promotion_type: typeof promo.type === "string" ? promo.type : null,
        promotion_status: typeof promo.status === "string" ? promo.status : null,
        item_promotion_status: typeof promo.status === "string" ? promo.status : null,
        offer_id: typeof promo.ref_id === "string" ? promo.ref_id : null,
        meli_item_id: publication.meli_item_id || "",
        original_price: originalPrice || null,
        promo_price: promoPrice,
        min_discounted_price: Number(promo.min_discounted_price || 0) || null,
        max_discounted_price: Number(promo.max_discounted_price || 0) || null,
        suggested_discounted_price: Number(promo.suggested_discounted_price || 0) || null,
        seller_percentage: sellerPercentage || null,
        meli_percentage: meliPercentage || null,
        seller_amount: sellerAmount || null,
        meli_amount: meliAmount || boostMeliAmount ? Number(meliAmount || 0) + boostMeliAmount : null,
        start_date: typeof promo.start_date === "string" ? promo.start_date : null,
        end_date: typeof promo.finish_date === "string" ? promo.finish_date : typeof promo.end_date === "string" ? promo.end_date : null,
        raw: promo,
      };
    })
    .filter((item) => item.promo_price && item.promo_price > 0);
}

function bestOpportunity(items: MercadoLibrePromotionOpportunity[], onlyWithMeliContribution = false) {
  const filtered = onlyWithMeliContribution ? items.filter(hasMeliContribution) : items;
  if (!filtered.length) return null;
  return [...filtered].sort((a, b) => {
    const amountA = Number(a.meli_amount || 0);
    const amountB = Number(b.meli_amount || 0);
    if (amountA !== amountB) return amountB - amountA;
    return Number(a.promo_price || 0) - Number(b.promo_price || 0);
  })[0];
}

function optionMatchesInstallment(option: MercadoLibrePriceOption, count: number) {
  if (count === 1) return option.code === "MC" || !option.installment_count;
  return Number(option.installment_count || 0) === count;
}

function validFinancingFeeRate(value?: number | null) {
  const rate = Number(value || 0);
  return Number.isFinite(rate) && rate > 0 && rate < 80 ? rate : null;
}

function promoComparisonKey(item: PromoComparison) {
  const name = item.name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return [
    name,
    Math.round(Number(item.promoPrice || 0) * 100),
    Math.round(Number(item.meliAmount || 0) * 100),
  ].join("|");
}

function normalizePromoIdentity(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function samePromotionIdentity(left: PromoComparison, right: PromoComparison) {
  if (left.promotionId && right.promotionId && left.promotionId === right.promotionId) return true;
  const leftName = normalizePromoIdentity(left.name);
  const rightName = normalizePromoIdentity(right.name);
  return Boolean(leftName && rightName && leftName === rightName);
}

function samePromotionEconomics(left: PromoComparison, right: PromoComparison) {
  return (
    samePrice(left.promoPrice, right.promoPrice) &&
    samePrice(left.meliAmount, right.meliAmount) &&
    samePrice(left.sellerAmount, right.sellerAmount)
  );
}

function promoBuyerPrice(item: PromoComparison) {
  return Number(item.promoPrice || item.effectiveSalePrice || 0);
}

function dedupePromoComparisons(items: PromoComparison[]) {
  const map = new Map<string, PromoComparison>();
  items.forEach((item) => {
    const key = promoComparisonKey(item);
    const current = map.get(key);
    if (!current || item.status === "Vigente") map.set(key, item);
  });
  return [...map.values()];
}

function opportunityKey(item: MercadoLibrePromotionOpportunity) {
  return [
    item.promotion_id || "",
    item.meli_item_id || "",
    item.offer_id || "",
    item.item_promotion_status || "",
  ].join("|");
}

function mergeOpportunities(
  tableOpportunities: MercadoLibrePromotionOpportunity[],
  rawOpportunities: MercadoLibrePromotionOpportunity[],
) {
  const map = new Map<string, MercadoLibrePromotionOpportunity>();
  rawOpportunities.forEach((item) => map.set(opportunityKey(item), item));
  tableOpportunities.forEach((item) => {
    const key = opportunityKey(item);
    const current = map.get(key);
    map.set(key, {
      ...current,
      ...item,
      start_date: item.start_date || current?.start_date || null,
      end_date: item.end_date || current?.end_date || null,
    });
  });
  return [...map.values()];
}

function promotionCountForPublication(
  publication: MercadoLibreShippingCost,
  opportunities: MercadoLibrePromotionOpportunity[],
  onlyWithMeliContribution: boolean,
) {
  const hasStartedOpportunity = opportunities.some((item) =>
    isActiveOpportunity(item),
  );
  const activePromo =
    publication.meli_promo_price &&
    !hasStartedOpportunity &&
    (!onlyWithMeliContribution || publicationHasMeliContribution(publication))
      ? [{
          key: `${publication.meli_item_id}-active-count`,
          status: "Vigente" as const,
          name: publication.meli_promo_name || publication.meli_promo_status || "Promo vigente",
          promoPrice: Number(publication.meli_promo_price || 0),
          effectiveSalePrice: effectiveSalePrice(
            publication.meli_promo_price,
            publication.meli_promo_meli_amount,
            publication.meli_promo_meli_rate,
            publication.meli_price,
            publication.meli_promo_seller_rate,
          ),
          meliAmount: Number(publication.meli_promo_meli_amount || 0),
          meliRate: Number(publication.meli_promo_meli_rate || 0),
          sellerAmount: Number(publication.meli_promo_seller_amount || 0),
          sellerRate: Number(publication.meli_promo_seller_rate || 0),
          rentability: null,
          netProfit: null,
        }]
      : [];

  const opportunityPromos = opportunities
    .filter((item) => !onlyWithMeliContribution || hasMeliContribution(item))
    .map((item) => {
      return {
        key: item.offer_id || item.promotion_id || `${publication.meli_item_id}-${item.promo_price}`,
        status: isActiveOpportunity(item) ? "Vigente" as const : "Para activar" as const,
        name: item.promotion_name || item.promotion_id,
        promoPrice: Number(item.promo_price || 0) || null,
        effectiveSalePrice: effectiveSalePrice(item.promo_price, item.meli_amount, item.meli_percentage),
        meliAmount: Number(item.meli_amount || 0),
        meliRate: Number(item.meli_percentage || 0),
        sellerAmount: Number(item.seller_amount || 0),
        sellerRate: Number(item.seller_percentage || 0),
        rentability: null,
        netProfit: null,
      };
    });

  return dedupePromoComparisons([...activePromo, ...opportunityPromos]).length;
}

export default function PromocionesMeliPage() {
  const router = useRouter();
  const supabase = createClient();

  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [opportunities, setOpportunities] = useState<MercadoLibrePromotionOpportunity[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>([]);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(null);
  const [selectedInstallments, setSelectedInstallments] = useState<Record<string, string>>({});
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [onlyMeliContribution, setOnlyMeliContribution] = useState(false);
  const [onlySharedFuture, setOnlySharedFuture] = useState(false);
  const [redThreshold, setRedThreshold] = useState(5);
  const [yellowThreshold, setYellowThreshold] = useState(5);
  const [syncingMeli, setSyncingMeli] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function loadData() {
    setLoading(true);
    setError(null);

    const [
      productsResponse,
      publicationsResponse,
      opportunitiesResponse,
      installmentsResponse,
      categoryFeesResponse,
      taxesResponse,
      marginsResponse,
    ] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .neq("status", "discontinued")
        .order("name", { ascending: true }),
      supabase
        .from("mercadolibre_shipping_costs")
        .select("*")
        .eq("active", true)
        .eq("meli_status", "active")
        .order("updated_at", { ascending: false }),
      supabase
        .from("mercadolibre_promotion_opportunities")
        .select("*")
        .order("meli_amount", { ascending: false }),
      supabase
        .from("mercadolibre_installment_fees")
        .select("*")
        .eq("active", true)
        .order("code", { ascending: true }),
      supabase
        .from("mercadolibre_category_fees")
        .select("*")
        .eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").single(),
      supabase.from("product_channel_margins").select("*"),
    ]);

    setLoading(false);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);

    if (publicationsResponse.error) setError(publicationsResponse.error.message);
    else setPublications((publicationsResponse.data || []) as MercadoLibreShippingCost[]);

    if (opportunitiesResponse.error) setError(opportunitiesResponse.error.message);
    else setOpportunities((opportunitiesResponse.data || []) as MercadoLibrePromotionOpportunity[]);

    if (installmentsResponse.error) setError(installmentsResponse.error.message);
    else setInstallments(((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]).filter((item) => item.code !== "MC"));

    if (categoryFeesResponse.error) setError(categoryFeesResponse.error.message);
    else setCategoryFees((categoryFeesResponse.data || []) as MercadoLibreCategoryFee[]);

    if (taxesResponse.error) setError(taxesResponse.error.message);
    else setTaxes((taxesResponse.data || defaultTaxSettings()) as TaxSettings);

    if (marginsResponse.error) setError(marginsResponse.error.message);
    else setMarginSettings((marginsResponse.data || []) as ProductChannelMargin[]);
  }

  async function copyItemId(itemId?: string | null) {
    if (!itemId) return;
    try {
      await navigator.clipboard.writeText(itemId);
      setCopiedItemId(itemId);
      window.setTimeout(() => {
        setCopiedItemId((current) => (current === itemId ? null : current));
      }, 1800);
    } catch {
      setError("No se pudo copiar el ID de la publicacion.");
    }
  }

  async function syncMercadoLibreData() {
    if (syncingMeli) return;
    setSyncingMeli(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch("/api/mercadolibre/sync-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "promotions" }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error || "No se pudo sincronizar MercadoLibre.");
        return;
      }
      await loadData();
    } catch (syncError) {
      setError(
        syncError instanceof DOMException && syncError.name === "AbortError"
          ? "La sincronizacion de MercadoLibre tardo mas de 2 minutos. Proba de nuevo o sincroniza por SKU desde Productos."
          : syncError instanceof Error ? syncError.message : "No se pudo sincronizar MercadoLibre.",
      );
    } finally {
      window.clearTimeout(timeout);
      setSyncingMeli(false);
    }
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo<ProductPromoGroup[]>(() => {
    const productsById = new Map(products.map((product) => [product.id, product]));
    const productsBySku = new Map(products.map((product) => [product.sku, product]));
    const opportunitiesByItem = new Map<string, MercadoLibrePromotionOpportunity[]>();

    opportunities.filter(isCurrentOpportunity).forEach((opportunity) => {
      const current = opportunitiesByItem.get(opportunity.meli_item_id) || [];
      current.push(opportunity);
      opportunitiesByItem.set(opportunity.meli_item_id, current);
    });

    const map = new Map<string, ProductPromoGroup>();

    publications.forEach((publication) => {
      const product =
        productsById.get(publication.product_id) ||
        (publication.sku ? productsBySku.get(publication.sku) : undefined);
      if (!product) return;

      const key = productKey(product);
      const publicationOpportunities = publication.meli_item_id
        ? opportunitiesByItem.get(publication.meli_item_id) || []
        : [];
      const current = map.get(key) || {
        product,
        publications: [],
        opportunities: [],
        activePromotionCount: 0,
        bestMeliAmount: 0,
        bestMeliRate: 0,
        minPrice: null,
        thumbnail: null,
        latestSync: null,
      };

      current.publications.push(publication);
      current.opportunities.push(...publicationOpportunities);
      current.activePromotionCount += publication.meli_promo_price ? 1 : 0;
      current.bestMeliAmount = Math.max(
        current.bestMeliAmount,
        Number(publication.meli_promo_meli_amount || 0),
        ...publicationOpportunities.map((item) => Number(item.meli_amount || 0)),
      );
      current.bestMeliRate = Math.max(
        current.bestMeliRate,
        Number(publication.meli_promo_meli_rate || 0),
        ...publicationOpportunities.map((item) => Number(item.meli_percentage || 0)),
      );

      const price = Number(publication.meli_price || publication.meli_promo_price || 0);
      if (price > 0) current.minPrice = current.minPrice === null ? price : Math.min(current.minPrice, price);
      if (!current.thumbnail && publication.meli_thumbnail) current.thumbnail = publication.meli_thumbnail;
      const sync = publication.meli_last_sync_at || publication.updated_at || null;
      if (sync && (!current.latestSync || sync > current.latestSync)) current.latestSync = sync;
      publicationOpportunities.forEach((opportunity) => {
        const opportunitySync = opportunity.last_sync_at || opportunity.updated_at || opportunity.created_at || null;
        if (opportunitySync && (!current.latestSync || opportunitySync > current.latestSync)) {
          current.latestSync = opportunitySync;
        }
      });

      map.set(key, current);
    });

    return [...map.values()].sort((a, b) => {
      if (a.bestMeliAmount !== b.bestMeliAmount) return b.bestMeliAmount - a.bestMeliAmount;
      return (a.product.name || "").localeCompare(b.product.name || "", "es");
    });
  }, [products, publications, opportunities]);

  const filteredGroups = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return groups;
    return groups.filter((group) => {
      const haystack = [
        group.product.sku,
        group.product.name,
        group.product.brand,
        group.product.model,
        group.product.category,
        ...group.publications.map((item) => `${item.meli_item_id || ""} ${item.meli_title || ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(value);
    });
  }, [groups, query]);

  const selectedGroup = groups.find((group) => productKey(group.product) === selectedKey) || null;

  const selectedPublicationIds = new Set(
    selectedGroup?.publications.map((item) => item.meli_item_id).filter(Boolean) || [],
  );
  const selectedOpportunities = selectedGroup
    ? selectedGroup.opportunities.filter((item) => selectedPublicationIds.has(item.meli_item_id))
    : [];

  const pricingOptions = useMemo<MercadoLibrePriceOption[]>(() => {
    return [
      mercadoLibreClassicOption(),
      ...installments.map((item) =>
        normalizeOption({
          code: item.code,
          name: item.name,
          channel_type: item.channel_type,
          installment_count: item.installment_count,
          financing_fee_rate: item.financing_fee_rate,
          applies_marketplace_fee: item.applies_marketplace_fee,
          applies_shipping: item.applies_shipping,
          applies_iibb: item.applies_iibb,
          applies_idc: item.applies_idc,
          applies_iigg: item.applies_iigg,
          applies_structure: item.applies_structure,
          applies_vat: item.applies_vat,
          active: item.active,
        }),
      ),
    ];
  }, [installments]);

  function categoryFeeForProduct(product: Product) {
    return categoryFees.find(
      (item) => item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    ) || null;
  }

  function channelSetting(productId: string | undefined, optionCode: string) {
    return marginSettings.find(
      (item) => item.product_id === productId && item.channel_code === optionCode,
    );
  }

  function rentabilityForProductRow(product: Product, row: PublicationPromoRow, salePrice?: number | null) {
    if (!salePrice || salePrice <= 0) return null;
    const option =
      pricingOptions.find((item) => optionMatchesInstallment(item, row.installmentCount)) ||
      mercadoLibreClassicOption();
    const publicationFinancingRate = validFinancingFeeRate(row.publication.meli_financing_fee_rate);
    const normalizedOption = normalizeOption({
      ...option,
      financing_fee_rate: publicationFinancingRate ?? Number(option.financing_fee_rate || 0),
    });
    const setting = channelSetting(product.id, normalizedOption.code);
    const result = calculatePriceSummary(
      product,
      normalizedOption,
      normalizedOption.applies_marketplace_fee ? categoryFeeForProduct(product) : null,
      taxes,
      normalizedOption.applies_shipping ? row.publication : null,
      {
        salePrice,
        structureAmount: Number(setting?.structure_amount || 0),
        manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
        salesCommissionRate: 0,
        saleAppliesVat: setting?.sale_applies_vat ?? Boolean(normalizedOption.applies_vat),
        costVatRate: Number(setting?.cost_vat_rate || 0),
        roundTo: 100,
        roundingMode: "nearest",
      },
    ) as { valid: boolean; marginOnNetSale?: number | null; netProfit?: number | null };
    if (!result.valid) return null;
    return {
      margin: Number(result.marginOnNetSale || 0),
      netProfit: Number(result.netProfit || 0),
    };
  }

  function rentabilityForRow(row: PublicationPromoRow, salePrice?: number | null) {
    if (!selectedGroup) return null;
    return rentabilityForProductRow(selectedGroup.product, row, salePrice);
  }

  const publicationFamilies = useMemo<PublicationVariantGroup[]>(() => {
    if (!selectedGroup) return [];
    const opportunitiesByItem = new Map<string, MercadoLibrePromotionOpportunity[]>();
    selectedOpportunities.forEach((opportunity) => {
      const current = opportunitiesByItem.get(opportunity.meli_item_id) || [];
      current.push(opportunity);
      opportunitiesByItem.set(opportunity.meli_item_id, current);
    });

    const families = new Map<string, PublicationVariantGroup>();

    selectedGroup.publications.forEach((publication) => {
      const label = installmentLabel(publication);
      const count = installmentCountFromLabel(label);
      const tableOpportunities = publication.meli_item_id
        ? opportunitiesByItem.get(publication.meli_item_id) || []
        : [];
      const rawOpportunities = rawPromotionOpportunities(publication).filter(isCurrentOpportunity);
      const rowOpportunities = mergeOpportunities(tableOpportunities, rawOpportunities);
      const key = publicationFamilyKey(publication) || publication.meli_item_id || publication.sku || "publicacion";
      const family = families.get(key) || {
        key,
        title: publication.meli_title || publication.meli_item_id || "Publicacion ML",
        catalogProductId: publication.meli_catalog_product_id || null,
        domainId: publication.meli_domain_id || null,
        branchKind: publicationBranchKind(publication),
        itemIds: [],
        rows: [],
      };

      if (publication.meli_item_id && !family.itemIds.includes(publication.meli_item_id)) {
        family.itemIds.push(publication.meli_item_id);
      }

      const best = bestOpportunity(rowOpportunities, onlyMeliContribution);
      if (
        onlyMeliContribution &&
        !publicationHasMeliContribution(publication) &&
        !best
      ) {
        families.set(key, family);
        return;
      }

      family.rows.push({
        publication,
        opportunities: rowOpportunities,
        installmentCount: count,
        installmentLabel: count === 1 ? "1 pago" : label,
        bestOpportunity: best,
      });
      families.set(key, family);
    });

    return [...families.values()]
      .filter((family) => family.rows.length > 0)
      .map((family) => ({
        ...family,
        rows: [...family.rows].sort((a, b) => {
          if (a.installmentCount !== b.installmentCount) return a.installmentCount - b.installmentCount;
          return Number(a.publication.meli_price || 0) - Number(b.publication.meli_price || 0);
        }),
      }))
      .sort((a, b) => {
        const aBest = Math.max(...a.rows.map((row) => Number(row.bestOpportunity?.meli_amount || row.publication.meli_promo_meli_amount || 0)));
        const bBest = Math.max(...b.rows.map((row) => Number(row.bestOpportunity?.meli_amount || row.publication.meli_promo_meli_amount || 0)));
        if (aBest !== bBest) return bBest - aBest;
        return a.title.localeCompare(b.title, "es");
      });
  }, [selectedGroup, selectedOpportunities, onlyMeliContribution]);

  const trafficLights = useMemo<PromoTrafficLights>(() => {
    const red: PromoTrafficLightItem[] = [];
    const yellow: PromoTrafficLightItem[] = [];
    const scheduled: PromoTrafficLightItem[] = [];
    const scheduledShared: PromoTrafficLightItem[] = [];

    function addItem(bucket: PromoTrafficLightItem[], item: PromoTrafficLightItem) {
      bucket.push(item);
    }

    groups.forEach((group) => {
      const opportunitiesByItem = new Map<string, MercadoLibrePromotionOpportunity[]>();
      group.opportunities.filter(isCurrentOpportunity).forEach((opportunity) => {
        const current = opportunitiesByItem.get(opportunity.meli_item_id) || [];
        current.push(opportunity);
        opportunitiesByItem.set(opportunity.meli_item_id, current);
      });

      group.publications.forEach((publication) => {
        const isActivePublication = String(publication.meli_status || "").toLowerCase() === "active";
        const label = installmentLabel(publication);
        const row: PublicationPromoRow = {
          publication,
          opportunities: mergeOpportunities(
            publication.meli_item_id ? opportunitiesByItem.get(publication.meli_item_id) || [] : [],
            rawPromotionOpportunities(publication).filter(isCurrentOpportunity),
          ),
          installmentCount: installmentCountFromLabel(label),
          installmentLabel: label,
          bestOpportunity: null,
        };

        const hasStartedOpportunity = row.opportunities.some(isActiveOpportunity);
        const hasActivePublicationPromo = isActivePromotionStatus(publication.meli_promo_status);
        const activePublicationPromoDates = publicationPromotionDates(
          publication,
          publication.meli_promo_name || publication.meli_promo_status,
          Number(publication.meli_promo_price || 0) || null,
        );
        const rows: PromoComparison[] = [
          ...(publication.meli_promo_price && !hasStartedOpportunity && hasActivePublicationPromo
            ? [{
                key: `${publication.meli_item_id}-active-light`,
                promotionId: null,
                status: "Vigente" as const,
                name: publication.meli_promo_name || publication.meli_promo_status || "Promo vigente",
                promoPrice: Number(publication.meli_promo_price || 0),
                effectiveSalePrice: effectiveSalePrice(
                  publication.meli_promo_price,
                  publication.meli_promo_meli_amount,
                  publication.meli_promo_meli_rate,
                  publication.meli_price,
                  publication.meli_promo_seller_rate,
                ),
                meliAmount: Number(publication.meli_promo_meli_amount || 0),
                meliRate: Number(publication.meli_promo_meli_rate || 0),
                sellerAmount: Number(publication.meli_promo_seller_amount || 0),
                sellerRate: Number(publication.meli_promo_seller_rate || 0),
                rentability: null,
                netProfit: null,
                startDate: activePublicationPromoDates.startDate,
                endDate: activePublicationPromoDates.endDate,
              }]
            : []),
          ...row.opportunities.map((opportunity) => {
            const promoEffectiveSalePrice = effectiveSalePrice(
              opportunity.promo_price,
              opportunity.meli_amount,
              opportunity.meli_percentage,
              opportunity.original_price || publication.meli_price,
              opportunity.seller_percentage,
            );
            const opportunityDates = publicationPromotionDates(
              publication,
              opportunity.promotion_name || opportunity.promotion_id,
              Number(opportunity.promo_price || 0) || null,
            );
            const startDate = opportunity.start_date || opportunityDates.startDate;
            const endDate = opportunity.end_date || opportunityDates.endDate;
            return {
              key: opportunity.offer_id || opportunity.promotion_id || `${publication.meli_item_id}-${opportunity.promo_price}`,
              promotionId: opportunity.promotion_id || null,
              status: isActiveOpportunity(opportunity) ? "Vigente" as const : "Para activar" as const,
              name: opportunity.promotion_name || opportunity.promotion_id,
              promoPrice: Number(opportunity.promo_price || 0) || null,
              effectiveSalePrice: promoEffectiveSalePrice,
              meliAmount: Number(opportunity.meli_amount || 0),
              meliRate: Number(opportunity.meli_percentage || 0),
              sellerAmount: Number(opportunity.seller_amount || 0),
              sellerRate: Number(opportunity.seller_percentage || 0),
              rentability: null,
              netProfit: null,
              startDate,
              endDate,
              joined: isJoinedOpportunity(opportunity),
              scheduled: isScheduledOpportunity({ ...opportunity, start_date: startDate, end_date: endDate }),
            };
          }),
        ];

        const calculatedPromos = dedupePromoComparisons(rows)
          .map((promo) => {
            const rentability = rentabilityForProductRow(group.product, row, promo.effectiveSalePrice);
            if (!rentability || rentability.margin < -100) return null;

            return {
              promo,
              margin: rentability.margin,
              netProfit: rentability.netProfit,
            };
          })
          .filter(Boolean) as Array<{ promo: PromoComparison; margin: number; netProfit: number }>;

        const activePromos = calculatedPromos.filter((item) => item.promo.status === "Vigente");
        const candidatePromos = calculatedPromos.filter((item) =>
          item.promo.status === "Para activar" &&
          !item.promo.scheduled &&
          !item.promo.joined &&
          !activePromos.some((activeItem) => samePromotionIdentity(activeItem.promo, item.promo)) &&
          !activePromos.some((activeItem) => samePromotionEconomics(activeItem.promo, item.promo)) &&
          (!activePromos.length || activePromos.some((activeItem) =>
            promoBuyerPrice(item.promo) > 0 &&
            promoBuyerPrice(activeItem.promo) > 0 &&
            promoBuyerPrice(item.promo) < promoBuyerPrice(activeItem.promo)
          )) &&
          !calculatedPromos.some((scheduledItem) =>
            scheduledItem.promo.status === "Para activar" &&
            scheduledItem.promo.scheduled &&
            samePromotionEconomics(scheduledItem.promo, item.promo)
          ) &&
          (Number(item.promo.meliAmount || 0) > 0 || Number(item.promo.meliRate || 0) > 0),
        );
        const scheduledPromos = calculatedPromos.filter((item) =>
          item.promo.status === "Para activar" &&
          item.promo.scheduled &&
          !item.promo.joined &&
          !activePromos.some((activeItem) => samePromotionIdentity(activeItem.promo, item.promo)),
        );
        const bestActive = [...activePromos].sort((a, b) => b.margin - a.margin)[0] || null;
        const bestScheduled = [...scheduledPromos].sort((a, b) => b.margin - a.margin)[0] || null;
        const bestSharedScheduled = [...scheduledPromos]
          .filter((item) => Number(item.promo.meliAmount || 0) > 0 || Number(item.promo.meliRate || 0) > 0)
          .sort((a, b) => b.margin - a.margin)[0] || null;

        activePromos.forEach(({ promo, margin, netProfit }) => {
          const rentability = rentabilityForProductRow(group.product, row, promo.effectiveSalePrice);
          if (!rentability) return;
          const normalizedInstallmentLabel = row.installmentCount === 1 ? "1 pago" : row.installmentLabel;

          const item = {
            key: `${group.product.sku}-${publication.meli_item_id}-${promo.key}-${promo.status}`,
            sku: group.product.sku,
            title: publication.meli_title || group.product.name,
            itemId: publication.meli_item_id || "-",
            installmentCount: row.installmentCount,
            installmentLabel: normalizedInstallmentLabel,
            promotionName: promo.name,
            promoPrice: promo.promoPrice,
            effectiveSalePrice: promo.effectiveSalePrice,
            meliAmount: promo.meliAmount,
            meliRate: promo.meliRate,
            sellerAmount: promo.sellerAmount,
            sellerRate: promo.sellerRate,
            startDate: promo.startDate,
            endDate: promo.endDate,
            margin,
            netProfit,
            status: promo.status,
          };

          if (margin < redThreshold) addItem(red, item);
        });

        if (isActivePublication && bestScheduled && bestScheduled.margin > yellowThreshold) {
          const promo = bestScheduled.promo;
          addItem(scheduled, {
            key: `${group.product.sku}-${publication.meli_item_id}-${promo.key}-${promo.status}-scheduled`,
            sku: group.product.sku,
            title: publication.meli_title || group.product.name,
            itemId: publication.meli_item_id || "-",
            installmentCount: row.installmentCount,
            installmentLabel: row.installmentCount === 1 ? "1 pago" : row.installmentLabel,
            promotionName: promo.name,
            promoPrice: promo.promoPrice,
            effectiveSalePrice: promo.effectiveSalePrice,
            meliAmount: promo.meliAmount,
            meliRate: promo.meliRate,
            sellerAmount: promo.sellerAmount,
            sellerRate: promo.sellerRate,
            startDate: promo.startDate,
            endDate: promo.endDate,
            margin: bestScheduled.margin,
            netProfit: bestScheduled.netProfit,
            status: promo.status,
          });
        }

        if (isActivePublication && bestSharedScheduled && bestSharedScheduled.margin > yellowThreshold) {
          const promo = bestSharedScheduled.promo;
          addItem(scheduledShared, {
            key: `${group.product.sku}-${publication.meli_item_id}-${promo.key}-${promo.status}-scheduled-shared`,
            sku: group.product.sku,
            title: publication.meli_title || group.product.name,
            itemId: publication.meli_item_id || "-",
            installmentCount: row.installmentCount,
            installmentLabel: row.installmentCount === 1 ? "1 pago" : row.installmentLabel,
            promotionName: promo.name,
            promoPrice: promo.promoPrice,
            effectiveSalePrice: promo.effectiveSalePrice,
            meliAmount: promo.meliAmount,
            meliRate: promo.meliRate,
            sellerAmount: promo.sellerAmount,
            sellerRate: promo.sellerRate,
            startDate: promo.startDate,
            endDate: promo.endDate,
            margin: bestSharedScheduled.margin,
            netProfit: bestSharedScheduled.netProfit,
            status: promo.status,
          });
        }

        if (isActivePublication) {
          candidatePromos
            .filter((candidate) => candidate.margin > yellowThreshold)
            .sort((a, b) => {
              const priceA = Number(a.promo.effectiveSalePrice || a.promo.promoPrice || 0);
              const priceB = Number(b.promo.effectiveSalePrice || b.promo.promoPrice || 0);
              if (priceA && priceB && priceA !== priceB) return priceA - priceB;
              return b.margin - a.margin;
            })
            .forEach((candidate) => {
              const promo = candidate.promo;
              addItem(yellow, {
                key: `${group.product.sku}-${publication.meli_item_id}-${promo.key}-${promo.status}`,
                sku: group.product.sku,
                title: publication.meli_title || group.product.name,
                itemId: publication.meli_item_id || "-",
                installmentCount: row.installmentCount,
                installmentLabel: row.installmentCount === 1 ? "1 pago" : row.installmentLabel,
                promotionName: promo.name,
                promoPrice: promo.promoPrice,
                effectiveSalePrice: promo.effectiveSalePrice,
                meliAmount: promo.meliAmount,
                meliRate: promo.meliRate,
                sellerAmount: promo.sellerAmount,
                sellerRate: promo.sellerRate,
                startDate: promo.startDate,
                endDate: promo.endDate,
                margin: candidate.margin,
                netProfit: candidate.netProfit,
                status: promo.status,
                activeMargin: bestActive?.margin ?? null,
                activeEffectiveSalePrice: bestActive?.promo.effectiveSalePrice ?? null,
              });
            });
        }
      });
    });

    function groupBySku(items: PromoTrafficLightItem[]) {
      const grouped = new Map<string, PromoTrafficLightGroup>();
      items.forEach((item) => {
        const current = grouped.get(item.sku) || {
          sku: item.sku,
          productName: products.find((product) => product.sku === item.sku)?.name || item.title,
          items: [],
        };
        const existingIndex = current.items.findIndex((currentItem) =>
          currentItem.installmentLabel === item.installmentLabel,
        );
        if (existingIndex === -1) {
          current.items.push(item);
        } else if (item.margin > current.items[existingIndex].margin) {
          current.items[existingIndex] = item;
        }
        grouped.set(item.sku, current);
      });

      return [...grouped.values()]
        .map((group) => ({
          ...group,
          items: [...group.items].sort((a, b) => {
            if (a.installmentCount !== b.installmentCount) return a.installmentCount - b.installmentCount;
            return b.margin - a.margin;
          }),
        }))
        .sort((a, b) => a.sku.localeCompare(b.sku, "es"));
    }

    function buyerPrice(item: PromoTrafficLightItem) {
      return Number(item.promoPrice || item.effectiveSalePrice || 0);
    }

    function groupYellowBySku(items: PromoTrafficLightItem[]) {
      const selected: PromoTrafficLightItem[] = [];
      const bySkuInstallment = new Map<string, PromoTrafficLightItem[]>();

      items.filter((item) => !hasFutureStart(item.startDate)).forEach((item) => {
        const key = `${item.sku}|${item.installmentLabel}`;
        bySkuInstallment.set(key, [...(bySkuInstallment.get(key) || []), item]);
      });

      bySkuInstallment.forEach((sameInstallmentItems) => {
        const marginWinner = [...sameInstallmentItems].sort((a, b) => b.margin - a.margin)[0];
        if (!marginWinner) return;
        selected.push(marginWinner);

        const winnerBuyerPrice = buyerPrice(marginWinner);
        const lowerBuyerPrice = sameInstallmentItems
          .filter((item) => item.key !== marginWinner.key && buyerPrice(item) > 0 && buyerPrice(item) < winnerBuyerPrice)
          .sort((a, b) => {
            const priceDiff = buyerPrice(a) - buyerPrice(b);
            if (priceDiff !== 0) return priceDiff;
            return b.margin - a.margin;
          })[0];

        if (lowerBuyerPrice) selected.push(lowerBuyerPrice);
      });

      const grouped = new Map<string, PromoTrafficLightGroup>();
      selected.forEach((item) => {
        const current = grouped.get(item.sku) || {
          sku: item.sku,
          productName: products.find((product) => product.sku === item.sku)?.name || item.title,
          items: [],
        };
        current.items.push(item);
        grouped.set(item.sku, current);
      });

      return [...grouped.values()]
        .map((group) => ({
          ...group,
          items: [...group.items].sort((a, b) => {
            if (a.installmentCount !== b.installmentCount) return a.installmentCount - b.installmentCount;
            if (a.installmentLabel === b.installmentLabel) return b.margin - a.margin;
            return b.margin - a.margin;
          }),
        }))
        .sort((a, b) => a.sku.localeCompare(b.sku, "es"));
    }

    return {
      red: groupBySku(red),
      yellow: groupYellowBySku(yellow),
      scheduled: groupBySku(scheduled),
      scheduledShared: groupBySku(scheduledShared),
    };
  }, [groups, products, pricingOptions, categoryFees, taxes, marginSettings, redThreshold, yellowThreshold]);

  return (
    <main className="container wide promociones-meli-page">
      <PageHero
        title="Promociones Meli"
        description={syncingMeli ? "Sincronizando publicaciones y promociones desde MercadoLibre..." : "Revisa productos activos en MercadoLibre, sus publicaciones y las promociones disponibles o vigentes detectadas en la ultima sincronizacion."}
        onRefresh={syncMercadoLibreData}
        refreshLabel={syncingMeli ? "Sincronizando..." : "Sincronizar ML"}
        refreshDisabled={syncingMeli}
      />

      {error && <div className="message error">{error}</div>}

      <section className="card promociones-workbar">
        <div className="promociones-current-product">
          <span className="promociones-thumb promociones-current-thumb">
            {selectedGroup?.thumbnail ? <img src={selectedGroup.thumbnail} alt="" /> : selectedGroup?.product.sku.slice(0, 2) || "ML"}
          </span>
          <div>
            <span className="small">Producto seleccionado</span>
            <h2>{selectedGroup ? selectedGroup.product.name : "Elegí un producto para empezar"}</h2>
            <p>
              {selectedGroup
                ? `${selectedGroup.product.sku} | ${selectedGroup.product.category || "Sin categoria"} | Sync ${formatDateTime(selectedGroup.latestSync)}`
                : `${groups.length} productos con publicaciones activas disponibles`}
            </p>
          </div>
        </div>
        <div className="promociones-workbar-actions">
          <div className="promociones-kpis compact">
            <div>
              <span>Productos ML</span>
              <strong>{groups.length}</strong>
            </div>
            <div>
              <span>Publicaciones</span>
              <strong>{selectedGroup?.publications.length || publications.length}</strong>
            </div>
            <div>
              <span>Promos</span>
              <strong>{selectedGroup ? selectedGroup.activePromotionCount + selectedGroup.opportunities.length : opportunities.filter(isCurrentOpportunity).length}</strong>
            </div>
          </div>
          <button className="button" type="button" onClick={() => setProductPickerOpen(true)}>
            Seleccionar producto
          </button>
        </div>
      </section>

      {productPickerOpen && (
        <div className="modal-backdrop promociones-picker-backdrop" onMouseDown={() => setProductPickerOpen(false)}>
          <div className="promociones-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Seleccionar producto</h2>
                <p className="small">Buscá por SKU, nombre, categoría o item de MercadoLibre.</p>
              </div>
              <button className="button ghost" type="button" onClick={() => setProductPickerOpen(false)}>
                Cerrar
              </button>
            </div>
            <div className="field">
              <label>Buscar</label>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="SKU, producto, marca, item ML..."
              />
            </div>
            <div className="promociones-picker-list">
              {loading ? (
                <p>Cargando publicaciones de MercadoLibre...</p>
              ) : (
                filteredGroups.map((group) => {
                  const selected = selectedGroup && productKey(selectedGroup.product) === productKey(group.product);
                  return (
                    <button
                      key={productKey(group.product)}
                      type="button"
                      className={`promociones-picker-row ${selected ? "active" : ""}`}
                  onClick={() => {
                        setSelectedKey(productKey(group.product));
                        setSelectedFamilyKey(null);
                        setSelectedInstallments({});
                        setProductPickerOpen(false);
                      }}
                    >
                      <span className="promociones-thumb">
                        {group.thumbnail ? <img src={group.thumbnail} alt="" /> : group.product.sku.slice(0, 2)}
                      </span>
                      <span className="promociones-product-main">
                        <strong>{group.product.name}</strong>
                        <span>{group.product.sku} | {group.product.category || "Sin categoria"}</span>
                      </span>
                      <span className="promociones-product-meta">
                        <strong>{group.publications.length}</strong>
                        <span>pub.</span>
                      </span>
                      <span className="promociones-product-meta">
                        <strong>{group.activePromotionCount + group.opportunities.length}</strong>
                        <span>promos</span>
                      </span>
                    </button>
                  );
                })
              )}
              {!loading && filteredGroups.length === 0 && (
                <div className="promociones-empty">No hay productos para esa búsqueda.</div>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="card promociones-detail promociones-full-detail">
        {selectedGroup ? (
          <>
            <div className="promociones-detail-header">
              <div>
                <h2>Publicaciones del producto</h2>
                <p>Elegí una publicación para ver sus variantes de 1, 3, 6, 9 y 12 cuotas.</p>
              </div>
              <div className="promociones-detail-actions">
                <label className="promociones-filter-toggle">
                  <input
                    type="checkbox"
                    checked={onlyMeliContribution}
                    onChange={(event) => setOnlyMeliContribution(event.target.checked)}
                  />
                  <span>Solo con aporte ML</span>
                </label>
                <div className="promociones-detail-stats">
                  <div>
                    <span>Precio ML desde</span>
                    <strong>{selectedGroup.minPrice ? moneyWithCents(selectedGroup.minPrice) : "-"}</strong>
                  </div>
                  <div>
                    <span>Mejor aporte ML</span>
                    <strong>{selectedGroup.bestMeliAmount ? moneyWithCents(selectedGroup.bestMeliAmount) : percent(selectedGroup.bestMeliRate)}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="promociones-family-list">
              {publicationFamilies.map((family) => {
                const expanded = selectedFamilyKey === family.key;
                const bestFamilyAmount = Math.max(...family.rows.map((row) => Number(row.bestOpportunity?.meli_amount || row.publication.meli_promo_meli_amount || 0)));
                const minFamilyPrice = Math.min(...family.rows.map((row) => Number(row.publication.meli_price || 0)).filter((price) => price > 0));
                const summaries: InstallmentSummary[] = family.rows.map((row) => {
                  const promoPrice = Number(row.bestOpportunity?.promo_price || row.publication.meli_promo_price || 0) || null;
                  const bestMeliAmount = Number(row.bestOpportunity?.meli_amount || row.publication.meli_promo_meli_amount || 0);
                  const bestMeliRate = Number(row.bestOpportunity?.meli_percentage || row.publication.meli_promo_meli_rate || 0);
                  const bestSellerRate = Number(row.bestOpportunity?.seller_percentage || row.publication.meli_promo_seller_rate || 0);
                  const summaryEffectiveSalePrice = effectiveSalePrice(
                    promoPrice,
                    bestMeliAmount,
                    bestMeliRate,
                    row.publication.meli_price,
                    bestSellerRate,
                  );
                  const rentability = rentabilityForRow(row, summaryEffectiveSalePrice);
                  return {
                    label: row.installmentLabel,
                    publication: row.publication,
                    row,
                    opportunityCount: promotionCountForPublication(
                      row.publication,
                      row.opportunities,
                      onlyMeliContribution,
                    ),
                    bestOpportunity: row.bestOpportunity,
                    bestMeliAmount,
                    promoPrice,
                    effectiveSalePrice: summaryEffectiveSalePrice,
                    rentability: rentability?.margin ?? null,
                    netProfit: rentability?.netProfit ?? null,
                  };
                });
                const selectedInstallmentKey = selectedInstallments[family.key] || summaries[0]?.publication.meli_item_id || "";
                const selectedSummary =
                  summaries.find((summary) => summary.publication.meli_item_id === selectedInstallmentKey) ||
                  summaries[0] ||
                  null;
                const promoComparisons: PromoComparison[] = selectedSummary
                  ? dedupePromoComparisons([
                      ...(selectedSummary.publication.meli_promo_price &&
                      (!onlyMeliContribution || publicationHasMeliContribution(selectedSummary.publication))
        ? (() => {
            const hasStartedOpportunity = selectedSummary.row.opportunities.some((item) =>
              isActiveOpportunity(item),
            );
            if (hasStartedOpportunity) return [];
            const activeEffectiveSalePrice = effectiveSalePrice(
              selectedSummary.publication.meli_promo_price,
              selectedSummary.publication.meli_promo_meli_amount,
              selectedSummary.publication.meli_promo_meli_rate,
              selectedSummary.publication.meli_price,
              selectedSummary.publication.meli_promo_seller_rate,
            );
                            const activePublicationPromoDates = publicationPromotionDates(
                              selectedSummary.publication,
                              selectedSummary.publication.meli_promo_name || selectedSummary.publication.meli_promo_status,
                              Number(selectedSummary.publication.meli_promo_price || 0) || null,
                            );
                            const rentability = rentabilityForRow(
                              selectedSummary.row,
                              activeEffectiveSalePrice,
                            );
                            return [{
                              key: `${selectedSummary.publication.meli_item_id}-active`,
                              promotionId: null,
                              status: "Vigente" as const,
                              name: selectedSummary.publication.meli_promo_name || selectedSummary.publication.meli_promo_status || "Promo vigente",
                              promoPrice: Number(selectedSummary.publication.meli_promo_price || 0),
                              effectiveSalePrice: activeEffectiveSalePrice,
                              meliAmount: Number(selectedSummary.publication.meli_promo_meli_amount || 0),
                              meliRate: Number(selectedSummary.publication.meli_promo_meli_rate || 0),
                              sellerAmount: Number(selectedSummary.publication.meli_promo_seller_amount || 0),
                              sellerRate: Number(selectedSummary.publication.meli_promo_seller_rate || 0),
                              rentability: rentability?.margin ?? null,
                              netProfit: rentability?.netProfit ?? null,
                              startDate: activePublicationPromoDates.startDate,
                              endDate: activePublicationPromoDates.endDate,
                            }];
                          })()
                        : []),
                      ...selectedSummary.row.opportunities
                        .filter((item) => !onlyMeliContribution || hasMeliContribution(item))
                        .map((item) => {
                          const promoEffectiveSalePrice = effectiveSalePrice(
                            item.promo_price,
                            item.meli_amount,
                            item.meli_percentage,
                            item.original_price || selectedSummary.publication.meli_price,
                            item.seller_percentage,
                          );
                          const rentability = rentabilityForRow(selectedSummary.row, promoEffectiveSalePrice);
                          return {
                            key: item.offer_id || item.promotion_id || `${selectedSummary.publication.meli_item_id}-${item.promo_price}`,
                            promotionId: item.promotion_id || null,
                            status: isActiveOpportunity(item) ? "Vigente" as const : "Para activar" as const,
                            name: item.promotion_name || item.promotion_id,
                            promoPrice: Number(item.promo_price || 0) || null,
                            effectiveSalePrice: promoEffectiveSalePrice,
                            meliAmount: Number(item.meli_amount || 0),
                            meliRate: Number(item.meli_percentage || 0),
                            sellerAmount: Number(item.seller_amount || 0),
                            sellerRate: Number(item.seller_percentage || 0),
                            rentability: rentability?.margin ?? null,
                            netProfit: rentability?.netProfit ?? null,
                            startDate: item.start_date || null,
                            endDate: item.end_date || null,
                          };
                        }),
                    ]).sort((a, b) => {
                      if (a.meliAmount !== b.meliAmount) return b.meliAmount - a.meliAmount;
                      return Number(b.rentability ?? -999) - Number(a.rentability ?? -999);
                    })
                  : [];
                return (
                  <article className={`promociones-family-card ${expanded ? "expanded" : ""}`} key={family.key}>
                    <button
                      className="promociones-family-button"
                      type="button"
                      onClick={() => setSelectedFamilyKey(expanded ? null : family.key)}
                    >
                      <span className="promociones-family-main">
                        <strong>{family.title}</strong>
                        <small>{family.rows.length} variante(s) de cuotas | desde {Number.isFinite(minFamilyPrice) ? moneyWithCents(minFamilyPrice) : "-"}</small>
                        <small className="promociones-family-meta">
                          {family.catalogProductId ? `Grupo ML ${family.catalogProductId}` : family.domainId || "Grupo ML sin catalogo"}
                          {" | "}
                          {publicationBranchLabel(family.branchKind)}
                          {" | "}
                          {family.itemIds.length} ID(s) asociados
                        </small>
                      </span>
                      <span className="promociones-family-installments">
                        {family.rows.map((row) => (
                          <span key={`${row.publication.meli_item_id}-pill`}>{row.installmentLabel}</span>
                        ))}
                      </span>
                      <span className="promociones-family-best">
                        <small>Mejor aporte ML</small>
                        <strong>{bestFamilyAmount ? moneyWithCents(bestFamilyAmount) : "-"}</strong>
                      </span>
                      <span className="promociones-expand-label">{expanded ? "Ocultar" : "Ver cuotas"}</span>
                    </button>

                    {expanded && (
                      <>
                      <div className="promociones-installment-summary-grid">
                        {summaries.map((summary) => (
                          <button
                            className={`promociones-installment-summary ${selectedSummary?.publication.meli_item_id === summary.publication.meli_item_id ? "active" : ""}`}
                            key={`${summary.publication.meli_item_id}-summary`}
                            type="button"
                            onClick={() =>
                              setSelectedInstallments((current) => ({
                                ...current,
                                [family.key]: summary.publication.meli_item_id || "",
                              }))
                            }
                          >
                            <div className="promociones-summary-head">
                              <div>
                                <strong>{summary.label}</strong>
                                <span
                                  className={`promociones-summary-item-id ${copiedItemId === summary.publication.meli_item_id ? "copied" : ""}`}
                                  role="button"
                                  tabIndex={0}
                                  title="Copiar ID de publicacion"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    copyItemId(summary.publication.meli_item_id);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key !== "Enter" && event.key !== " ") return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    copyItemId(summary.publication.meli_item_id);
                                  }}
                                >
                                  {copiedItemId === summary.publication.meli_item_id
                                    ? "Copiado"
                                    : summary.publication.meli_item_id || "-"}
                                </span>
                              </div>
                              <span>{summary.opportunityCount} promo(s)</span>
                            </div>
                            <div className="promociones-summary-values">
                              <div>
                                <span>Sin promo</span>
                                <strong>{moneyWithCents(summary.publication.meli_price || 0)}</strong>
                              </div>
                              <div>
                                <span>Mejor promo</span>
                                <strong>{summary.promoPrice ? moneyWithCents(summary.promoPrice) : "-"}</strong>
                              </div>
                              <div>
                                <span>Aporte ML</span>
                                <strong>{summary.bestMeliAmount ? moneyWithCents(summary.bestMeliAmount) : "-"}</strong>
                              </div>
                              <div>
                                <span>Venta real</span>
                                <strong>{summary.effectiveSalePrice ? moneyWithCents(summary.effectiveSalePrice) : "-"}</strong>
                              </div>
                              <div>
                                <span>Rentabilidad</span>
                                <strong className={summary.rentability !== null && summary.rentability < 0 ? "negative" : "positive"}>
                                  {summary.rentability !== null ? percent(summary.rentability) : "-"}
                                </strong>
                              </div>
                            </div>
                            <small>
                              {summary.bestOpportunity?.promotion_name || summary.publication.meli_promo_name || "Sin mejor promo detectada"}
                              {summary.netProfit !== null ? ` | Neto ${moneyWithCents(summary.netProfit)}` : ""}
                            </small>
                          </button>
                        ))}
                      </div>

                      <div className="promociones-promo-comparison">
                        <div className="promociones-promo-comparison-head">
                          <div>
                            <h3>Promos de {selectedSummary?.label || "-"}</h3>
                            <p>Activas y disponibles para activar en esta publicacion.</p>
                          </div>
                          <strong>{promoComparisons.length} promo(s)</strong>
                        </div>
                        {promoComparisons.length ? (
                          <div className="promociones-promo-table-wrap">
                            <table className="promociones-promo-table">
                              <thead>
                                <tr>
                                  <th>Estado</th>
                                  <th>Promocion</th>
                                  <th>Precio promo</th>
                                  <th>Venta real</th>
                                  <th>Aporte ML</th>
                                  <th>Aporte vendedor</th>
                                  <th>Rentabilidad</th>
                                  <th>Neto</th>
                                </tr>
                              </thead>
                              <tbody>
                                {promoComparisons.map((promo) => (
                                  <tr key={promo.key}>
                                    <td><span className={`promo-status ${promo.status === "Vigente" ? "active" : ""}`}>{promo.status}</span></td>
                                    <td>
                                      <strong>{promo.name}</strong>
                                      {futureStartLabel(promo.startDate) && (
                                        <span className="promo-date-badge">{futureStartLabel(promo.startDate)}</span>
                                      )}
                                    </td>
                                    <td>{promo.promoPrice ? moneyWithCents(promo.promoPrice) : "-"}</td>
                                    <td><strong>{promo.effectiveSalePrice ? moneyWithCents(promo.effectiveSalePrice) : "-"}</strong></td>
                                    <td>
                                      <strong>{promo.meliAmount ? moneyWithCents(promo.meliAmount) : percent(promo.meliRate)}</strong>
                                    </td>
                                    <td>{promo.sellerAmount ? moneyWithCents(promo.sellerAmount) : percent(promo.sellerRate)}</td>
                                    <td>
                                      <strong className={promo.rentability !== null && promo.rentability < 0 ? "negative" : "positive"}>
                                        {promo.rentability !== null ? percent(promo.rentability) : "-"}
                                      </strong>
                                    </td>
                                    <td>{promo.netProfit !== null ? moneyWithCents(promo.netProfit) : "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="promociones-empty">No hay promociones para esta cuota con el filtro actual.</div>
                        )}
                      </div>

                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="promociones-empty promociones-start-empty">
            <strong>Seleccioná un producto para empezar</strong>
            <span>El listado se abre en un popup para que después trabajes las promociones usando todo el ancho de pantalla.</span>
            <button className="button" type="button" onClick={() => setProductPickerOpen(true)}>
              Seleccionar producto
            </button>
          </div>
        )}
      </section>

      <section className="card promociones-traffic-light">
        <div className="promociones-traffic-head">
          <div>
            <h2>Ajustes pendientes</h2>
            <p>SKU/cuotas que requieren accion: promos activas con baja rentabilidad u oportunidades mejores para activar.</p>
          </div>
          <div className="promociones-traffic-actions">
            <label>
              Rojo
              <input
                type="number"
                min="-100"
                max="100"
                step="0.5"
                value={redThreshold}
                onChange={(event) => setRedThreshold(Number(event.target.value) || 0)}
              />
              <span>%</span>
            </label>
            <label>
              Amarillo
              <input
                type="number"
                min="-100"
                max="100"
                step="0.5"
                value={yellowThreshold}
                onChange={(event) => setYellowThreshold(Number(event.target.value) || 0)}
              />
              <span>%</span>
            </label>
            <button className="button ghost" type="button" onClick={syncMercadoLibreData} disabled={syncingMeli}>
              {syncingMeli ? "Sincronizando..." : "Sincronizar ML"}
            </button>
          </div>
        </div>
        <div className="promociones-traffic-grid">
          {[
            {
              key: "red",
              title: "Revisar activas",
              subtitle: `Vigentes con menos de ${percent(redThreshold)}`,
              groups: trafficLights.red,
            },
            {
              key: "yellow",
              title: "Conviene activar",
              subtitle: `Publicaciones activas con mas de ${percent(yellowThreshold)}`,
              groups: trafficLights.yellow,
            },
            {
              key: "scheduled",
              title: "Futuras",
              subtitle: onlySharedFuture ? "Promos futuras con aporte compartido" : "Promos futuras con fecha de inicio",
              groups: onlySharedFuture ? trafficLights.scheduledShared : trafficLights.scheduled,
            },
          ].map((column) => (
            <div className={`promociones-traffic-column ${column.key}`} key={column.key}>
              <div className="promociones-traffic-column-head">
                <div>
                  <h3>{column.title}</h3>
                  <p>{column.subtitle}</p>
                  {column.key === "scheduled" && (
                    <button
                      className={`promociones-column-filter ${onlySharedFuture ? "active" : ""}`}
                      type="button"
                      onClick={() => setOnlySharedFuture((current) => !current)}
                    >
                      {onlySharedFuture ? "Ver todas" : "Solo compartidas"}
                    </button>
                  )}
                </div>
                <strong>{column.groups.reduce((total, group) => total + group.items.length, 0)}</strong>
              </div>
              {column.groups.length ? (
                column.groups.map((group) => (
                  <article className="promociones-traffic-sku" key={`${column.key}-${group.sku}`}>
                    <div className="promociones-traffic-sku-head">
                      <div>
                        <strong>{group.sku}</strong>
                        <small>{group.productName}</small>
                      </div>
                      <span>{group.items.length}</span>
                    </div>
                    <div className="promociones-traffic-items">
                      {group.items.map((item) => (
                        <div className="promociones-traffic-item" key={item.key}>
                          <div className="promociones-traffic-main">
                            <strong>{item.installmentLabel}</strong>
                            <span>{item.promotionName}</span>
                            {futureStartLabel(item.startDate) && (
                              <span className="promo-date-badge">{futureStartLabel(item.startDate)}</span>
                            )}
                            <span>
                              Comprador {item.promoPrice ? moneyWithCents(item.promoPrice) : "-"} | Venta {item.effectiveSalePrice ? moneyWithCents(item.effectiveSalePrice) : "-"}
                            </span>
                            <span>
                              ML {item.meliAmount ? moneyWithCents(item.meliAmount) : percent(item.meliRate)} | Vendedor {item.sellerAmount ? moneyWithCents(item.sellerAmount) : percent(item.sellerRate)}
                            </span>
                            {item.activeMargin !== null && item.activeMargin !== undefined && item.activeMargin >= item.margin && (
                              <span className="promo-active-winner-badge">
                                Vigente gana margen {percent(item.activeMargin)}
                                {item.activeEffectiveSalePrice ? ` | Venta vigente ${moneyWithCents(item.activeEffectiveSalePrice)}` : ""}
                              </span>
                            )}
                          </div>
                          <div className="promociones-traffic-meta">
                            <button
                              type="button"
                              className={copiedItemId === item.itemId ? "copied" : ""}
                              title="Copiar ID de publicacion"
                              onClick={() => copyItemId(item.itemId)}
                            >
                              {copiedItemId === item.itemId ? "Copiado" : item.itemId}
                            </button>
                            <strong className={item.margin < redThreshold ? "negative" : "positive"}>{percent(item.margin)}</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))
              ) : (
                <div className="promociones-empty">Sin publicaciones en este grupo.</div>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
