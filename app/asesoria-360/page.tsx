"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { ChevronRight } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import {
  calculatePriceSummary,
  defaultTaxSettings,
  mercadoLibreClassicOption,
  moneyWithCents,
  normalizeOption,
  toNumber,
} from "@/lib/pricing";
import type {
  MercadoLibreCategoryFee,
  MercadoLibreInstallmentFee,
  MercadoLibreOrderItem,
  MercadoLibrePriceOption,
  MercadoLibrePromotionOpportunity,
  MercadoLibreShippingCost,
  Product,
  ProductChannelMargin,
  TaxSettings,
} from "@/lib/types";

type AdvisoryDraftRow = {
  id: string;
  accountName: string;
  date: string;
  sku: string;
  productName: string;
  itemId: string;
  itemTitle: string;
  installmentLabel: string;
  salePrice: number;
  offerPrice: number;
  targetMargin: number;
};

type AdvisoryPublicationRow = {
  publication: MercadoLibreShippingCost;
  installmentCount: number;
  installmentLabel: string;
};

type AdvisoryPublicationGroup = {
  key: string;
  title: string;
  catalogProductId: string | null;
  domainId: string | null;
  branchKind: "catalog_listing" | "seller_listing";
  itemIds: string[];
  rows: AdvisoryPublicationRow[];
};

type AdvisoryCandidate = {
  sku: string;
  productName: string;
  score: number;
  reason: string;
  stock: number;
  productStock: number;
  units30: number;
  inventoryValue: number;
  stockDays: number | null;
  publications: number;
  bestSalePrice: number | null;
  bestOfferPrice: number | null;
  hasActivePromo: boolean;
  bestMeliContributionRate: number;
  bestMeliContributionAmount: number;
  meliContributionCoverage: string;
};

const STORAGE_KEY = "adara-asesoria-360-draft";
const ACCOUNT_NAME = "ADARA RS";
const MAX_ROWS = 40;

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextWeekday(day: number) {
  const date = new Date();
  const current = date.getDay();
  let diff = day - current;
  if (diff <= 0) diff += 7;
  date.setDate(date.getDate() + diff);
  return dateInputValue(date);
}

function formatSheetDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function numberForSheet(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function itemIdWithoutPrefix(itemId?: string | null) {
  return (itemId || "").replace(/^MLA/i, "");
}

function publicationInstallments(publication: MercadoLibreShippingCost) {
  const text = `${publication.meli_installments_text || ""} ${publication.notes || ""}`.toLowerCase();
  const match = text.match(/(\d+)\s*cuota/);
  if (match) return Number(match[1]);
  if (text.includes("sin cuotas") || text.includes("1 pago")) return 1;
  return null;
}

function daysBetween(from: string) {
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) return Infinity;
  return (Date.now() - date.getTime()) / 86400000;
}

function stockDaysLabel(value: number | null) {
  if (value === null) return "Sin ventas";
  if (value < 7) return `${value.toFixed(1)} dias`;
  return `${Math.round(value)} dias`;
}

function isActiveOpportunity(item: MercadoLibrePromotionOpportunity) {
  const status = `${item.item_promotion_status || item.promotion_status || ""}`.toLowerCase();
  return status.includes("started") || status.includes("active");
}

function cappedScore(value: number, max: number) {
  return Math.min(Math.max(value, 0), max);
}

function costWithVat(product: Product) {
  const explicit = Number(product.cost_with_vat || 0);
  if (explicit > 0) return explicit;
  const base = Number(product.cost_without_vat || 0);
  const vat = Number(product.vat_rate || 0);
  return base > 0 ? base * (1 + vat / 100) : 0;
}

function inventoryValueScore(value: number) {
  if (value >= 5000000) return 35;
  if (value >= 2500000) return 28;
  if (value >= 1000000) return 20;
  if (value >= 500000) return 14;
  if (value >= 200000) return 8;
  return 0;
}

function stockAmountScore(stock: number) {
  if (stock >= 100) return 18;
  if (stock >= 50) return 14;
  if (stock >= 20) return 9;
  if (stock > 0) return 4;
  return 0;
}

function optionLabelForPublication(publication: MercadoLibreShippingCost) {
  const installments = publicationInstallments(publication);
  if (!installments || installments <= 1) return "1 pago";
  return `${installments} cuotas`;
}

function publicationTags(publication: MercadoLibreShippingCost) {
  return Array.isArray(publication.meli_tags) ? publication.meli_tags.map((tag) => String(tag)) : [];
}

function publicationBranchKind(publication: MercadoLibreShippingCost): AdvisoryPublicationGroup["branchKind"] {
  return publicationTags(publication).includes("user_product_listing") ? "catalog_listing" : "seller_listing";
}

function publicationBranchLabel(branchKind: AdvisoryPublicationGroup["branchKind"]) {
  return branchKind === "catalog_listing" ? "Catalogo ML" : "Publicacion vendedor";
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

function sortPricingOptions(options: MercadoLibrePriceOption[]) {
  const fixedOrder: Record<string, number> = { MC: 1, MP3: 2, MP6: 3, MP9: 4, MP12: 5 };
  return [...options].sort((a, b) => {
    const orderA = fixedOrder[a.code] ?? 1000;
    const orderB = fixedOrder[b.code] ?? 1000;
    if (orderA !== orderB) return orderA - orderB;
    return a.code.localeCompare(b.code, "es");
  });
}

export default function Asesoria360Page() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [opportunities, setOpportunities] = useState<MercadoLibrePromotionOpportunity[]>([]);
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>([]);
  const [query, setQuery] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [expandedPublicationGroups, setExpandedPublicationGroups] = useState<Record<string, boolean>>({});
  const [selectedDate, setSelectedDate] = useState(nextWeekday(1));
  const [targetMargin, setTargetMargin] = useState(5);
  const [draftRows, setDraftRows] = useState<AdvisoryDraftRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function fetchSalesSince(sinceIso: string) {
    const pageSize = 1000;
    const result: MercadoLibreOrderItem[] = [];

    for (let from = 0; from < 20000; from += pageSize) {
      const to = from + pageSize - 1;
      const response = await supabase
        .from("mercadolibre_order_items")
        .select("*")
        .gte("order_date", sinceIso)
        .neq("status", "cancelled")
        .order("order_date", { ascending: false })
        .range(from, to);

      if (response.error) return response;
      const page = (response.data || []) as MercadoLibreOrderItem[];
      result.push(...page);
      if (page.length < pageSize) break;
    }

    return { data: result, error: null };
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    const since = new Date();
    since.setDate(since.getDate() - 65);
    const [
      productsResponse,
      publicationsResponse,
      installmentsResponse,
      opportunitiesResponse,
      salesResponse,
      categoryFeesResponse,
      taxesResponse,
      marginsResponse,
    ] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active").order("sku", { ascending: true }),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true).eq("meli_status", "active").order("sku", { ascending: true }),
      supabase.from("mercadolibre_installment_fees").select("*").eq("active", true).order("code", { ascending: true }),
      supabase.from("mercadolibre_promotion_opportunities").select("*").order("meli_amount", { ascending: false }).limit(2000),
      fetchSalesSince(since.toISOString()),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").single(),
      supabase.from("product_channel_margins").select("*"),
    ]);
    setLoading(false);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);
    if (publicationsResponse.error) setError(publicationsResponse.error.message);
    else setPublications((publicationsResponse.data || []) as MercadoLibreShippingCost[]);
    if (installmentsResponse.error) setError(installmentsResponse.error.message);
    else setInstallments(((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]).filter((item) => item.code !== "MC"));
    if (opportunitiesResponse.error) setError(opportunitiesResponse.error.message);
    else setOpportunities((opportunitiesResponse.data || []) as MercadoLibrePromotionOpportunity[]);
    if (salesResponse.error) setSales([]);
    else setSales((salesResponse.data || []) as MercadoLibreOrderItem[]);
    if (categoryFeesResponse.error) setError(categoryFeesResponse.error.message);
    else setCategoryFees((categoryFeesResponse.data || []) as MercadoLibreCategoryFee[]);
    if (taxesResponse.error) setError(taxesResponse.error.message);
    else setTaxes((taxesResponse.data || defaultTaxSettings()) as TaxSettings);
    if (marginsResponse.error) setError(marginsResponse.error.message);
    else setMarginSettings((marginsResponse.data || []) as ProductChannelMargin[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AdvisoryDraftRow[];
        if (Array.isArray(parsed)) setDraftRows(parsed);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draftRows));
  }, [draftRows]);

  const pricingOptions = useMemo<MercadoLibrePriceOption[]>(() => {
    return sortPricingOptions([
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
    ]);
  }, [installments]);

  const productsBySku = useMemo(() => new Map(products.map((product) => [product.sku, product])), [products]);

  const publicationsBySku = useMemo(() => {
    const map = new Map<string, MercadoLibreShippingCost[]>();
    publications.forEach((publication) => {
      const sku = publication.sku || products.find((product) => product.id === publication.product_id)?.sku;
      if (!sku || !publication.meli_item_id) return;
      const current = map.get(sku) || [];
      current.push(publication);
      map.set(sku, current);
    });
    return map;
  }, [products, publications]);

  const productGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .map((product) => ({ product, publications: publicationsBySku.get(product.sku) || [] }))
      .filter((group) => group.publications.length > 0)
      .filter((group) => {
        const text = `${group.product.sku} ${group.product.name} ${group.product.brand || ""} ${group.product.model || ""}`.toLowerCase();
        return !q || text.includes(q);
      })
      .slice(0, 250);
  }, [products, publicationsBySku, query]);

  const selectedProduct = selectedSku ? productsBySku.get(selectedSku) || null : null;
  const selectedPublications = selectedSku ? publicationsBySku.get(selectedSku) || [] : [];

  const selectedPublicationGroups = useMemo<AdvisoryPublicationGroup[]>(() => {
    const families = new Map<string, AdvisoryPublicationGroup>();
    selectedPublications.forEach((publication) => {
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
      family.rows.push({
        publication,
        installmentCount: publicationInstallments(publication) || 999,
        installmentLabel: optionLabelForPublication(publication),
      });
      families.set(key, family);
    });

    return [...families.values()]
      .map((family) => ({
        ...family,
        rows: [...family.rows].sort((a, b) => {
          if (a.installmentCount !== b.installmentCount) return a.installmentCount - b.installmentCount;
          return String(a.publication.meli_item_id || "").localeCompare(String(b.publication.meli_item_id || ""), "es");
        }),
      }))
      .sort((a, b) => {
        const firstA = a.rows[0]?.installmentCount ?? 999;
        const firstB = b.rows[0]?.installmentCount ?? 999;
        if (firstA !== firstB) return firstA - firstB;
        return a.title.localeCompare(b.title, "es");
      });
  }, [selectedPublications]);

  function categoryFeeForProduct(product: Product) {
    return categoryFees.find((item) => item.category?.toLowerCase() === (product.category || "").toLowerCase()) || null;
  }

  function channelSetting(productId: string | undefined, optionCode: string) {
    return marginSettings.find((item) => item.product_id === productId && item.channel_code === optionCode);
  }

  function optionForPublication(publication: MercadoLibreShippingCost) {
    const count = publicationInstallments(publication);
    const byCount = pricingOptions.find((option) => Number(option.installment_count || 0) === Number(count || 0));
    if (byCount) return byCount;
    const financingRate = Number(publication.meli_financing_fee_rate || 0);
    const byRate = pricingOptions.find((option) => Math.abs(Number(option.financing_fee_rate || 0) - financingRate) < 0.05);
    return byRate || mercadoLibreClassicOption();
  }

  function offerPriceForPublication(product: Product, publication: MercadoLibreShippingCost, margin: number) {
    const option = normalizeOption(optionForPublication(publication));
    const setting = channelSetting(product.id, option.code);
    const result = calculatePriceSummary(
      product,
      option,
      option.applies_marketplace_fee ? categoryFeeForProduct(product) : null,
      taxes,
      option.applies_shipping ? publication : null,
      {
        desiredMarginRate: margin,
        desiredNetProfit: null,
        structureAmount: Number(setting?.structure_amount || 0),
        manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
        salesCommissionRate: Number(setting?.sales_commission_rate || 0),
        saleAppliesVat: setting?.sale_applies_vat ?? Boolean(option.applies_vat),
        costVatRate: Number(setting?.cost_vat_rate || 0),
        roundTo: 100,
        roundingMode: "nearest",
      },
    ) as { valid: boolean; roundedPrice?: number };
    return result.valid ? Number(result.roundedPrice || 0) : null;
  }

  const advisoryCandidates = useMemo<AdvisoryCandidate[]>(() => {
    const salesBySku = new Map<string, MercadoLibreOrderItem[]>();
    sales.forEach((sale) => {
      const sku = (sale.sku || "").toUpperCase();
      if (!sku) return;
      salesBySku.set(sku, [...(salesBySku.get(sku) || []), sale]);
    });

    const opportunitiesByItem = new Map<string, MercadoLibrePromotionOpportunity[]>();
    opportunities.forEach((opportunity) => {
      if (!opportunity.meli_item_id) return;
      opportunitiesByItem.set(opportunity.meli_item_id, [...(opportunitiesByItem.get(opportunity.meli_item_id) || []), opportunity]);
    });

    return productGroups
      .map(({ product, publications: groupPublications }) => {
        const skuSales = salesBySku.get(product.sku.toUpperCase()) || [];
        const units30 = skuSales
          .filter((sale) => daysBetween(sale.order_date) <= 30)
          .reduce((total, sale) => total + Number(sale.quantity || 0), 0);
        const units7 = skuSales
          .filter((sale) => daysBetween(sale.order_date) <= 7)
          .reduce((total, sale) => total + Number(sale.quantity || 0), 0);
        const activePublications = groupPublications.filter((publication) => publication.meli_status === "active");
        const stockSourcePublications = activePublications.length ? activePublications : groupPublications;
        const meliStock = stockSourcePublications.length
          ? Math.max(...stockSourcePublications.map((publication) => Number(publication.meli_stock || 0)))
          : 0;
        const productStock = Number(product.stock || 0);
        const stock = groupPublications.length ? meliStock : productStock;
        const dailyUnits = Math.max(units7 / 7, units30 / 30);
        const stockDays = dailyUnits > 0 ? stock / dailyUnits : null;
        const inventoryValue = stock * costWithVat(product);
        const hasActivePromo = groupPublications.some((publication) => {
          if (publication.meli_promo_price && publication.meli_promo_status && /started|active/i.test(publication.meli_promo_status)) return true;
          const itemOpportunities = publication.meli_item_id ? opportunitiesByItem.get(publication.meli_item_id) || [] : [];
          return itemOpportunities.some(isActiveOpportunity);
        });
        const activeMeliContributionsByPublication = groupPublications.map((publication) => {
          const currentPromoActive = publication.meli_promo_price && publication.meli_promo_status && /started|active/i.test(publication.meli_promo_status);
          const current = currentPromoActive
            ? [{
              rate: Number(publication.meli_promo_meli_rate || 0),
              amount: Number(publication.meli_promo_meli_amount || 0),
            }]
            : [];
          const itemOpportunities = publication.meli_item_id ? opportunitiesByItem.get(publication.meli_item_id) || [] : [];
          const activeOpportunities = itemOpportunities
            .filter(isActiveOpportunity)
            .map((opportunity) => ({
              rate: Number(opportunity.meli_percentage || 0),
              amount: Number(opportunity.meli_amount || 0),
            }));
          return [...current, ...activeOpportunities];
        });
        const activeMeliContributions = activeMeliContributionsByPublication.flat();
        const publicationsWithMeliContribution = activeMeliContributionsByPublication.filter((contributions) =>
          contributions.some((item) => item.rate > 0 || item.amount > 0),
        ).length;
        const meliContributionCoverageRatio = groupPublications.length
          ? publicationsWithMeliContribution / groupPublications.length
          : 0;
        const meliContributionCoverage = `${publicationsWithMeliContribution}/${groupPublications.length}`;
        const bestMeliContributionRate = activeMeliContributions.length
          ? Math.max(...activeMeliContributions.map((item) => item.rate))
          : 0;
        const bestMeliContributionAmount = activeMeliContributions.length
          ? Math.max(...activeMeliContributions.map((item) => item.amount))
          : 0;
        const bestSalePrice = Math.min(
          ...groupPublications
            .map((publication) => Number(publication.meli_price || 0))
            .filter((price) => price > 0),
        );
        const offerPrices = groupPublications
          .map((publication) => offerPriceForPublication(product, publication, targetMargin))
          .filter((price): price is number => Boolean(price && price > 0));
        const bestOfferPrice = offerPrices.length ? Math.min(...offerPrices) : null;
        const reasons: string[] = [];
        let score = 0;
        const hasLowMeliContribution = bestMeliContributionRate < 2 && bestMeliContributionAmount < 10000;
        const needsExtraPromo =
          stock > 0 &&
          (
            !hasActivePromo ||
            publicationsWithMeliContribution === 0 ||
            meliContributionCoverageRatio < 1 ||
            hasLowMeliContribution
          );

        if (stock > 0) {
          score += stockAmountScore(stock);
          reasons.push(`stock disponible ${stock}`);
        }
        if (!hasActivePromo) {
          score += 24;
          reasons.push("sin promo activa");
        }
        if (publicationsWithMeliContribution === 0) {
          score += 34;
          reasons.push("sin aporte ML compartido");
        } else if (meliContributionCoverageRatio < 0.5) {
          score += 26;
          reasons.push(`aporte ML parcial ${meliContributionCoverage}`);
        } else if (meliContributionCoverageRatio < 1) {
          score += 18;
          reasons.push(`aporte ML parcial ${meliContributionCoverage}`);
        } else if (hasLowMeliContribution) {
          score += 12;
          reasons.push(`aporte ML bajo ${bestMeliContributionRate.toFixed(1)}%`);
        }
        score += inventoryValueScore(inventoryValue);
        if (inventoryValue >= 1000000) {
          reasons.push(`stock valorizado ${moneyWithCents(inventoryValue)}`);
        } else if (inventoryValue >= 200000) {
          reasons.push(`valor parado ${moneyWithCents(inventoryValue)}`);
        }
        if (units30 === 0 && stock > 0) {
          score += 24;
          reasons.push("sin ventas 30d");
          if (inventoryValue >= 3000000) {
            score += 12;
            reasons.push("alto valor sin ventas 30d");
          }
        } else if (stock >= 30 && units30 <= 5) {
          score += 18;
          reasons.push("baja rotacion 30d");
        } else if (stock >= 15 && units30 <= 2) {
          score += 14;
          reasons.push("stock quieto");
        }
        if (stockDays !== null && stockDays > 45) {
          score += stockDays > 90 ? 18 : 12;
          reasons.push("muchos dias de stock");
        }
        if (stock > 0 && units30 > 0) {
          const turnover = units30 / stock;
          if (turnover <= 0.1) score += 12;
          else if (turnover <= 0.25) score += 7;
        }
        if (groupPublications.length >= 2) {
          score += 6;
          reasons.push("varias MLA para rotar");
        }
        if (bestOfferPrice && Number.isFinite(bestSalePrice) && bestSalePrice > 0) {
          const discount = ((bestSalePrice - bestOfferPrice) / bestSalePrice) * 100;
          if (discount >= 8) {
            score += 8;
            reasons.push(`oferta sugerida ${discount.toFixed(1)}% menor`);
          }
        }
        score = Math.round(cappedScore(score, 100));

        return {
          sku: product.sku,
          productName: product.name,
          score,
          reason: reasons.length ? reasons.slice(0, 3).join(" | ") : "candidato estable",
          stock,
          productStock,
          units30,
          inventoryValue,
          stockDays,
          publications: groupPublications.length,
          bestSalePrice: Number.isFinite(bestSalePrice) ? bestSalePrice : null,
          bestOfferPrice,
          hasActivePromo,
          bestMeliContributionRate,
          bestMeliContributionAmount,
          meliContributionCoverage,
          needsExtraPromo,
        };
      })
      .filter((candidate) => candidate.stock > 0 && candidate.needsExtraPromo && candidate.score > 0)
      .sort((a, b) => b.score - a.score || b.inventoryValue - a.inventoryValue || b.stock - a.stock)
      .slice(0, 12);
  }, [productGroups, sales, opportunities, targetMargin]);

  function rowKey(sku: string, date: string) {
    return `${sku}|${date}`;
  }

  function addPublication(publication: MercadoLibreShippingCost) {
    if (!selectedProduct || !publication.meli_item_id) return;
    if (draftRows.length >= MAX_ROWS) {
      setError(`La lista ya tiene ${MAX_ROWS} MLA.`);
      return;
    }
    if (draftRows.some((row) => rowKey(row.sku, row.date) === rowKey(selectedProduct.sku, selectedDate))) {
      setError("Ese SKU ya esta cargado para ese dia. Elegi otro dia o borra la fila existente.");
      return;
    }
    if (draftRows.some((row) => row.itemId === publication.meli_item_id && row.date === selectedDate)) {
      setError("Ese MLA ya esta cargado para ese dia.");
      return;
    }
    const offerPrice = offerPriceForPublication(selectedProduct, publication, targetMargin);
    const salePrice = Number(publication.meli_price || 0);
    if (!offerPrice || !salePrice) {
      setError("No pude calcular precio oferta o falta el precio actual de MercadoLibre.");
      return;
    }
    setDraftRows((current) => [
      ...current,
      {
        id: `${publication.meli_item_id}-${selectedDate}-${Date.now()}`,
        accountName: ACCOUNT_NAME,
        date: selectedDate,
        sku: selectedProduct.sku,
        productName: selectedProduct.name,
        itemId: publication.meli_item_id || "",
        itemTitle: publication.meli_title || selectedProduct.name,
        installmentLabel: optionLabelForPublication(publication),
        salePrice,
        offerPrice,
        targetMargin,
      },
    ]);
    setError(null);
  }

  const sheetRows = useMemo(() => {
    return draftRows.map((row) => ({
      "ID DE LA CUENTA": row.accountName,
      "Fecha de inicio": formatSheetDate(row.date),
      "Fecha de Fin": formatSheetDate(row.date),
      "ID de los items MLA": itemIdWithoutPrefix(row.itemId),
      "Precio de la oferta": numberForSheet(row.offerPrice),
      "Precio PVP (precio de venta al publico)": numberForSheet(row.salePrice),
    }));
  }, [draftRows]);

  function sheetTsv() {
    const headers = [
      "ID DE LA CUENTA",
      "Fecha de inicio",
      "Fecha de Fin",
      "ID de los items MLA",
      "Precio de la oferta",
      "Precio PVP (precio de venta al publico)",
    ];
    return [
      headers.join("\t"),
      ...sheetRows.map((row) => headers.map((header) => String(row[header as keyof typeof row] ?? "")).join("\t")),
    ].join("\n");
  }

  async function copySheet() {
    await navigator.clipboard.writeText(sheetTsv());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function exportXlsx() {
    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Asesoria 360");
    XLSX.writeFile(workbook, "asesoria-360.xlsx");
  }

  return (
    <main className="container wide asesoria360-page">
      <PageHero
        title="Asesoria 360"
        description="Armado semanal de hasta 40 MLA para tarjetas nuevas de descuento."
        onRefresh={loadData}
        refreshLabel={loading ? "Actualizando..." : "Actualizar"}
        refreshDisabled={loading}
      />

      {error && <div className="message error">{error}</div>}

      <section className="card asesoria360-ranking">
        <div className="asesoria360-panel-head">
          <div>
            <h2>Ranking automatico</h2>
            <p>Productos con stock disponible ordenados por necesidad de pedir promo extra y aporte ML.</p>
          </div>
          <span className="badge">{advisoryCandidates.length}</span>
        </div>
        <div className="asesoria360-ranking-list">
          {advisoryCandidates.map((candidate) => (
            <article className="asesoria360-candidate-card" key={candidate.sku}>
              <div>
                <strong>{candidate.sku}</strong>
                <span>{candidate.productName}</span>
                <small>{candidate.reason}</small>
              </div>
              <div className="asesoria360-candidate-stats">
                <span>Score <strong>{candidate.score}</strong></span>
                <span>Stock <strong>{candidate.stock}</strong></span>
                <span>Valor <strong>{moneyWithCents(candidate.inventoryValue)}</strong></span>
                <span>30d <strong>{candidate.units30}</strong></span>
                <span>Dias <strong>{stockDaysLabel(candidate.stockDays)}</strong></span>
                <span>Aporte ML <strong>{candidate.bestMeliContributionRate ? `${candidate.bestMeliContributionRate.toFixed(1)}%` : moneyWithCents(candidate.bestMeliContributionAmount)}</strong></span>
                <span>Cobertura ML <strong>{candidate.meliContributionCoverage}</strong></span>
                <span>MLA <strong>{candidate.publications}</strong></span>
              </div>
              <div className="asesoria360-candidate-price">
                <span>Venta {moneyWithCents(candidate.bestSalePrice)}</span>
                <strong>Oferta {moneyWithCents(candidate.bestOfferPrice)}</strong>
              </div>
              <button className="button" type="button" onClick={() => setSelectedSku(candidate.sku)}>
                Usar
              </button>
            </article>
          ))}
          {!advisoryCandidates.length && <div className="asesoria360-empty">Sin candidatos automaticos con los datos actuales.</div>}
        </div>
      </section>

      <section className="card asesoria360-workspace">
        <div className="asesoria360-products">
          <div className="asesoria360-panel-head">
            <div>
              <h2>Elegir SKU</h2>
              <p>Productos activos con publicaciones MLA disponibles.</p>
            </div>
            <span className="badge">{productGroups.length}</span>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, nombre o modelo" />
          <div className="asesoria360-sku-list">
            {productGroups.map(({ product, publications: groupPublications }) => (
              <button
                key={product.sku}
                type="button"
                className={`asesoria360-sku ${selectedSku === product.sku ? "active" : ""}`}
                onClick={() => setSelectedSku(product.sku)}
              >
                <strong>{product.sku}</strong>
                <span>{product.name}</span>
                <small>{groupPublications.length} MLA</small>
              </button>
            ))}
          </div>
        </div>

        <div className="asesoria360-publications">
          <div className="asesoria360-panel-head">
            <div>
              <h2>{selectedProduct ? selectedProduct.sku : "Selecciona un SKU"}</h2>
              <p>{selectedProduct ? selectedProduct.name : "Despues elegis dia, margen y MLA."}</p>
            </div>
          </div>

          <div className="asesoria360-controls">
            <div className="field">
              <label>Dia para cargar</label>
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
            </div>
            <div className="field">
              <label>Ganancia final objetivo</label>
              <div className="asesoria360-percent-input">
                <input value={targetMargin} onChange={(event) => setTargetMargin(Number(toNumber(event.target.value) ?? 0))} />
                <span>%</span>
              </div>
            </div>
          </div>
          <div className="asesoria360-days">
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(1))}>Lun prox.</button>
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(2))}>Mar prox.</button>
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(3))}>Mie prox.</button>
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(4))}>Jue prox.</button>
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(5))}>Vie prox.</button>
          </div>

          <div className="asesoria360-mla-list">
            {!selectedProduct && <div className="asesoria360-empty">Elegi un SKU para ver sus publicaciones.</div>}
            {selectedProduct && selectedPublicationGroups.map((group) => {
              const expanded = Boolean(expandedPublicationGroups[group.key]);
              const minSalePrice = Math.min(...group.rows.map((row) => Number(row.publication.meli_price || Infinity)));
              const installmentText = group.rows.map((row) => row.installmentLabel).join(", ");
              return (
                <article key={group.key} className={`asesoria360-family-card ${expanded ? "expanded" : ""}`}>
                  <button
                    type="button"
                    className="asesoria360-family-button"
                    onClick={() => setExpandedPublicationGroups((current) => ({ ...current, [group.key]: !expanded }))}
                  >
                    <span className="asesoria360-family-main">
                      <strong>{group.title}</strong>
                      <small>{publicationBranchLabel(group.branchKind)} | {group.itemIds.length} ID(s) | {group.rows.length} variante(s)</small>
                      <small>{group.catalogProductId ? `Grupo ML ${group.catalogProductId}` : group.domainId || "Sin grupo ML"}</small>
                    </span>
                    <span className="asesoria360-family-installments">{installmentText}</span>
                    <span className="asesoria360-family-price">Desde {Number.isFinite(minSalePrice) ? moneyWithCents(minSalePrice) : "-"}</span>
                    <span className="item-action asesoria360-family-toggle">
                      {expanded ? "Ocultar" : "Ver"}
                      <ChevronRight aria-hidden="true" />
                    </span>
                  </button>

                  {expanded && (
                    <div className="asesoria360-family-rows">
                      {group.rows.map((row) => {
                        const publication = row.publication;
                        const offerPrice = offerPriceForPublication(selectedProduct, publication, targetMargin);
                        const disabled = draftRows.some((draft) => rowKey(draft.sku, draft.date) === rowKey(selectedProduct.sku, selectedDate));
                        return (
                          <article key={publication.id || publication.meli_item_id} className="asesoria360-mla-card">
                            <div>
                              <strong>{row.installmentLabel}</strong>
                              <span>{publication.meli_item_id}</span>
                              <small>{publication.meli_listing_type_name || publication.meli_listing_type_id || "Tipo sin dato"}</small>
                            </div>
                            <div className="asesoria360-price-stack">
                              <span>Venta {moneyWithCents(publication.meli_price)}</span>
                              <strong>Oferta {moneyWithCents(offerPrice)}</strong>
                            </div>
                            <button type="button" className="button" disabled={disabled || draftRows.length >= MAX_ROWS} onClick={() => addPublication(publication)}>
                              Agregar
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card asesoria360-draft">
        <div className="asesoria360-panel-head">
          <div>
            <h2>Lista para planilla</h2>
            <p>{draftRows.length}/{MAX_ROWS} MLA cargados.</p>
          </div>
          <div className="actions">
            <button className="button ghost" type="button" onClick={copySheet} disabled={!draftRows.length}>{copied ? "Copiado" : "Copiar planilla"}</button>
            <button className="button ghost" type="button" onClick={exportXlsx} disabled={!draftRows.length}>Exportar XLSX</button>
            <button className="button danger" type="button" onClick={() => setDraftRows([])} disabled={!draftRows.length}>Borrar todo</button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Fecha inicio</th>
                <th>Fecha fin</th>
                <th>MLA</th>
                <th>SKU</th>
                <th>Cuotas</th>
                <th>Precio oferta</th>
                <th>PVP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draftRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.accountName}</td>
                  <td>{formatSheetDate(row.date)}</td>
                  <td>{formatSheetDate(row.date)}</td>
                  <td>{itemIdWithoutPrefix(row.itemId)}</td>
                  <td><strong>{row.sku}</strong><br /><span className="small">{row.productName}</span></td>
                  <td>{row.installmentLabel}</td>
                  <td>{moneyWithCents(row.offerPrice)}<br /><span className="small">Margen {row.targetMargin}%</span></td>
                  <td>{moneyWithCents(row.salePrice)}</td>
                  <td><button className="button danger" type="button" onClick={() => setDraftRows((current) => current.filter((item) => item.id !== row.id))}>Borrar</button></td>
                </tr>
              ))}
              {!draftRows.length && (
                <tr>
                  <td colSpan={9} className="asesoria360-empty">Todavia no agregaste MLA a la lista.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
