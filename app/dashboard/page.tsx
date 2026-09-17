"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Database, RefreshCcw, Search, ShieldCheck } from "lucide-react";
import { usePricingLoad } from '@/lib/usePricingLoad';
import { PricingDataStatus, PricingPagination } from '@/components/PricingDataStatus';
import { normalizeFilter, categoryOptions } from '@/lib/pricingData';
import { groupAlerts, resolutionHref } from '@/lib/accountAlerts';
import { promotionCoverage } from '@/lib/promotionState';
import { useRememberedView } from '@/lib/useRememberedView';
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
  MercadoLibreOrderItem,
  MercadoLibrePriceOption,
  MercadoLibrePromotionOpportunity,
  MercadoLibreShippingCost,
  Product,
  ProductChannelMargin,
  TaxSettings,
} from "@/lib/types";

type ActionType =
  | "paused_stock"
  | "low_margin"
  | "negative_sale"
  | "b2b_margin"
  | "activate_promo"
  | "future_promo"
  | "missing_promo"
  | "high_margin_low_rotation"
  | "low_margin_high_rotation"
  | "stock_risk"
  | "stock_idle"
  | "missing_local_product"
  | "data_issue";

type Priority = "critica" | "alta" | "media" | "baja";

type AccountAction = {
  key: string;
  type: ActionType;
  priority: Priority;
  sku: string;
  productName: string;
  itemId?: string | null;
  title: string;
  detail: string;
  href: string;
  margin?: number | null;
  stock?: number | null;
  units7?: number;
  units30?: number;
  buyerPrice?: number | null;
  salePrice?: number | null;
  meliAmount?: number | null;
  startDate?: string | null;
};

type RotationStats = {
  units7: number;
  units30: number;
  units60: number;
  revenue30: number;
  lastSale?: string | null;
};

type SyncProgress = {
  percent: number;
  label: string;
};

type MercadoLibreSyncLog = {
  sku?: string | null;
  meli_item_id?: string | null;
  status?: string | null;
  message?: string | null;
  created_at?: string | null;
};

type B2BMarginGuard = {
  meli_item_id: string;
  minimum_purchase_unit: number;
  sku: string;
  target_margin_rate: number | string;
  required_meli_contribution?: number | string | null;
  active: boolean;
  last_checked_at?: string | null;
  paused_at?: string | null;
  paused_reason?: string | null;
};

const ML_FIXED_FEE_PRICE_LIMIT = 30000;

function nowIso() {
  return new Date().toISOString();
}

function numberValue(value: unknown) {
  return Number(value || 0);
}

function daysSince(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / 86400000;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "Sin datos";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function daysBetween(from?: string | null) {
  if (!from) return Infinity;
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) return Infinity;
  return (Date.now() - date.getTime()) / 86400000;
}

function publicationInstallments(publication: MercadoLibreShippingCost) {
  const saleTerms = Array.isArray(publication.meli_sale_terms) ? publication.meli_sale_terms : [];
  const searchable = [
    publication.meli_installments_text,
    publication.notes,
    publication.meli_listing_type_id,
    ...(Array.isArray(publication.meli_tags) ? publication.meli_tags : []),
    ...saleTerms.flatMap((term) => {
      const value = term as { id?: string; name?: string; value_name?: string; value_id?: string };
      return [value.id, value.name, value.value_name, value.value_id];
    }),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (searchable.includes("3x_campaign")) return 3;
  if (searchable.includes("9x_campaign")) return 9;
  if (searchable.includes("12x_campaign")) return 12;
  if (searchable.includes("gold_special")) return 1;
  if (searchable.includes("gold_pro")) return 6;

  const match = searchable.match(/(\d{1,2})\s*(x|cuotas?)/i);
  if (match) return Number(match[1]);
  if (searchable.includes("sin cuotas") || searchable.includes("1 pago") || searchable.includes("clasica") || searchable.includes("clásica")) return 1;
  return null;
}

function installmentLabel(count?: number | null) {
  if (!count || count <= 1) return "1 pago";
  return `${count} cuotas`;
}

function isActiveOpportunity(item: MercadoLibrePromotionOpportunity) {
  const status = `${item.item_promotion_status || item.promotion_status || ""}`.toLowerCase();
  return status.includes("started") || status.includes("active");
}

function isFutureOpportunity(item: MercadoLibrePromotionOpportunity, currentIso = nowIso()) {
  if (!item.start_date) return false;
  if (isActiveOpportunity(item)) return false;
  return item.start_date > currentIso;
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

function promotionFixedFeeAmount(opportunity: MercadoLibrePromotionOpportunity) {
  const raw = (opportunity.raw || {}) as {
    listing_price_fixed_fee_amount?: number | string | null;
    fixed_fee_amount?: number | string | null;
    listing_price?: {
      sale_fee_details?: {
        fixed_fee?: number | string | null;
        fixed_fee_amount?: number | string | null;
        unit_fee?: number | string | null;
        sale_unit_fee?: number | string | null;
      } | null;
    } | null;
  };
  const details = raw.listing_price?.sale_fee_details || {};
  return Number(
    raw.listing_price_fixed_fee_amount ||
      raw.fixed_fee_amount ||
      details.fixed_fee ||
      details.fixed_fee_amount ||
      details.unit_fee ||
      details.sale_unit_fee ||
      0,
  );
}

function stockFromLogMessage(message?: string | null) {
  const match = `${message || ""}`.match(/Stock ML:\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function readJsonResponse(response: Response, fallbackMessage: string) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const cleanText = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    throw new Error(`${fallbackMessage}${response.status ? ` (${response.status})` : ""}: ${cleanText.slice(0, 180) || "respuesta no JSON"}`);
  }
}

function isJwtClockError(message?: string | null) {
  return /jwt issued at future/i.test(message || "");
}

function priorityLabel(priority: Priority) {
  if (priority === "critica") return "Critica";
  if (priority === "alta") return "Alta";
  if (priority === "media") return "Media";
  return "Baja";
}

function typeLabel(type: ActionType) {
  const labels: Record<ActionType, string> = {
    paused_stock: "Pausada con stock",
    low_margin: "Margen bajo",
    negative_sale: "Venta con pérdida",
    b2b_margin: "Mayorista con margen bajo",
    activate_promo: "Promo para activar",
    future_promo: "Promo futura",
    missing_promo: "Sin promo",
    high_margin_low_rotation: "Margen alto sin rotar",
    low_margin_high_rotation: "Vende con poco margen",
    stock_risk: "Riesgo de stock",
    stock_idle: "Stock quieto",
    missing_local_product: "En ML sin producto",
    data_issue: "Dato a revisar",
  };
  return labels[type];
}

function actionTone(type: ActionType) {
  if (type === "paused_stock" || type === "low_margin" || type === "negative_sale" || type === "b2b_margin") return "review";
  if (type === "future_promo") return "future";
  if (type === "data_issue" || type === "missing_local_product") return "data_issue";
  if (type === "missing_promo") return "missing_promo";
  return "activate";
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const dataLoad = usePricingLoad('dashboard', supabase);
  const [listPage, setListPage] = useState(1);
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [opportunities, setOpportunities] = useState<MercadoLibrePromotionOpportunity[]>([]);
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>([]);
  const [syncLogs, setSyncLogs] = useState<MercadoLibreSyncLog[]>([]);
  const [b2bGuards, setB2bGuards] = useState<B2BMarginGuard[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ActionType>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function loadData(options: { quiet?: boolean; initial?: boolean } = {}) {
    const since = new Date(); since.setHours(0,0,0,0); since.setDate(since.getDate() - 65);
    setLoading(true);
    try { await dataLoad.run({ products: { table: 'products', filters: [['neq','status','discontinued']] }, publications: { table: 'mercadolibre_shipping_costs', filters: [['eq','active',true]] }, opportunities: { table: 'mercadolibre_promotion_opportunities' }, installments: { table: 'mercadolibre_installment_fees', filters: [['eq','active',true]] }, categories: { table: 'mercadolibre_category_fees', filters: [['eq','active',true]] }, taxes: { table: 'tax_settings', filters: [['eq','key','default']] }, margins: { table: 'product_channel_margins' }, sales: { table: 'mercadolibre_order_items', columns: 'id,order_id,order_date,status,meli_item_id,variation_id,sku,product_id,title,quantity,unit_price,total_amount,real_total_net_profit,normalized_total_net_profit,real_net_sale_price,normalized_net_sale_price,updated_at', filters: [['gte','order_date',since.toISOString()],['neq','status','cancelled']], order: 'order_date', ascending: false }, logs: { table: 'mercadolibre_shipping_sync_logs', columns: 'id,sku,meli_item_id,status,message,created_at', filters: [['eq','status','sku_not_found']] }, guards: { table: 'mercadolibre_b2b_margin_guard' } }, data => { setProducts(data.products); setPublications(data.publications); setOpportunities(data.opportunities); setInstallments(data.installments.filter(item => item.code !== 'MC')); setCategoryFees(data.categories); setTaxes(data.taxes[0] || defaultTaxSettings()); setMarginSettings(data.margins); setSales(data.sales); setSyncLogs(data.logs); setB2bGuards(data.guards); }, !options.initial); }
    finally { setLoading(false); }
  }

  async function syncAccount() {
    setSyncing(true);
    setError(null);
    setSyncInfo(null);
    setSyncProgress({ percent: 3, label: "Preparando sincronizacion completa..." });
    let progressCap = 18;
    const updateProgress = (percent: number, label: string) => {
      const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
      setSyncProgress((current) => ({
        percent: Math.max(current?.percent || 0, safePercent),
        label,
      }));
    };
    const progressTimer = window.setInterval(() => {
      setSyncProgress((current) => {
        if (!current) return current;
        const next = Math.min(progressCap, current.percent + Math.max(1, Math.round((progressCap - current.percent) * 0.18)));
        return { ...current, percent: next };
      });
    }, 900);

    try {
      const statuses = [
        { value: "active", label: "activas" },
        { value: "paused", label: "pausadas" },
        { value: "under_review", label: "en revision" },
      ];
      const pageLimit = 10;
      let resetPromotions = true;
      const shippingTotals = {
        updated: 0,
        changed: 0,
        promotionOpportunities: 0,
        installmentFeeUpdates: 0,
        categoryFeeUpdates: 0,
        matched: 0,
        totalItems: 0,
      };

      for (const [statusIndex, status] of statuses.entries()) {
        let offset = 0;
        let total = pageLimit;

        const shippingPercent = (processed: number, totalItems: number) => {
          const statusWeight = 77 / statuses.length;
          const cappedTotal = Math.max(1, Math.min(totalItems || pageLimit, 1000));
          const statusRatio = Math.max(0, Math.min(processed / cappedTotal, 1));
          return Math.min(82, Math.round(5 + statusIndex * statusWeight + statusRatio * statusWeight));
        };

        while (offset < total && offset < 1000) {
          const percentDone = shippingPercent(offset, total);
          progressCap = Math.max(progressCap, percentDone + 2);
          updateProgress(percentDone, `Actualizando publicaciones ${status.label}: ${offset + 1}-${Math.min(offset + pageLimit, Math.max(total, offset + pageLimit))} de ${Math.min(total, 1000)}...`);
          const shippingResponse = await fetch("/api/mercadolibre/sync-shipping", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope: "all",
              statuses: [status.value],
              offset,
              pageLimit,
              resetPromotions,
            }),
          });
          const shippingData = await readJsonResponse(shippingResponse, "MercadoLibre devolvio una respuesta inesperada");
          if (!shippingResponse.ok) throw new Error(shippingData?.error || "No se pudo sincronizar MercadoLibre.");

          total = Number(shippingData?.totals_by_status?.[status.value] || shippingData?.total_items || 0);
          shippingTotals.updated += Number(shippingData?.updated || 0);
          shippingTotals.changed += Number(shippingData?.changed || 0);
          shippingTotals.promotionOpportunities += Number(shippingData?.promotion_opportunities || 0);
          shippingTotals.installmentFeeUpdates += Number(shippingData?.installment_fee_updates || 0);
          shippingTotals.categoryFeeUpdates += Number(shippingData?.category_fee_updates || 0);
          shippingTotals.matched += Number(shippingData?.matched || 0);
          shippingTotals.totalItems += Number(shippingData?.total_items || 0);
          resetPromotions = false;
          offset += pageLimit;
          const nextPercent = shippingPercent(Math.min(offset, total), total);
          progressCap = Math.max(progressCap, nextPercent + 2);
          updateProgress(nextPercent, `Publicaciones ${status.label}: ${Math.min(offset, total, 1000)} de ${Math.min(total, 1000)} procesadas.`);

          if (Number(shippingData?.total_items || 0) === 0) break;
        }
      }

      progressCap = 92;
      updateProgress(84, "Actualizando ventas y rentabilidad real...");
      const salesResponse = await fetch("/api/mercadolibre/sync-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 60, chunkDays: 7 }),
      });
      const salesData = await readJsonResponse(salesResponse, "Ventas ML devolvio una respuesta inesperada");
      if (!salesResponse.ok) throw new Error(salesData?.error || "No se pudieron sincronizar ventas.");

      progressCap = 98;
      updateProgress(94, "Recargando dashboard con datos actualizados...");
      setSyncInfo(
        `Sync completa: ${shippingTotals.updated} publicaciones actualizadas, ${shippingTotals.changed} costos de envio cambiados, ` +
        `${shippingTotals.promotionOpportunities} promos guardadas, ${shippingTotals.installmentFeeUpdates} costos de cuotas actualizados, ` +
        `${shippingTotals.categoryFeeUpdates} costos de canal actualizados. Ventas: ${salesData.saved || 0} items guardados.`,
      );
      await loadData();
      updateProgress(100, "Sincronizacion completa.");
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudo sincronizar la cuenta.");
    } finally {
      window.clearInterval(progressTimer);
      setSyncing(false);
      window.setTimeout(() => setSyncProgress(null), 1800);
    }
  }

  useEffect(() => {
    checkSession();
    loadData({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

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

  function publicationForMargin(publication: MercadoLibreShippingCost, buyerPrice?: number | null, fixedFeeOverride?: number | null) {
    const fixedFeeAmount = Number(publication.fixed_fee_amount || 0);
    const fixedFeeFromPromotion = Number(fixedFeeOverride || 0);
    const priceForFixedFee = Number(buyerPrice || 0);
    if (fixedFeeAmount > 0 || fixedFeeFromPromotion <= 0 || priceForFixedFee <= 0 || priceForFixedFee > ML_FIXED_FEE_PRICE_LIMIT) return publication;
    return { ...publication, fixed_fee_amount: fixedFeeFromPromotion };
  }

  function marginForPublication(
    product: Product,
    publication: MercadoLibreShippingCost,
    salePrice?: number | null,
    buyerPrice?: number | null,
    fixedFeeOverride?: number | null,
  ) {
    if (!salePrice || salePrice <= 0) return null;
    const priceForFixedFee = Number(salePrice || buyerPrice || 0);
    if (priceForFixedFee > 0 && priceForFixedFee <= ML_FIXED_FEE_PRICE_LIMIT && Number(publication.fixed_fee_amount || 0) <= 0 && Number(fixedFeeOverride || 0) <= 0) return null;
    const option = normalizeOption(optionForPublication(publication));
    const marginPublication = publicationForMargin(publication, salePrice || buyerPrice, fixedFeeOverride);
    if (option.applies_shipping && (marginPublication.free_shipping || marginPublication.meli_free_shipping) && !Number(marginPublication.shipping_cost_amount || 0)) return null;
    const setting = channelSetting(product.id, option.code);
    const result = calculatePriceSummary(
      product,
      option,
      option.applies_marketplace_fee ? categoryFeeForProduct(product) : null,
      taxes,
      option.applies_shipping ? marginPublication : null,
      {
        salePrice,
        structureAmount: Number(setting?.structure_amount || 0),
        manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
        salesCommissionRate: Number(setting?.sales_commission_rate || 0),
        saleAppliesVat: setting?.sale_applies_vat ?? Boolean(option.applies_vat),
        costVatRate: Number(setting?.cost_vat_rate || 0),
        roundTo: 100,
        roundingMode: "nearest",
      },
    ) as { valid: boolean; marginOnNetSale?: number | null };
    return result.valid ? Number(result.marginOnNetSale || 0) : null;
  }

  const account = useMemo(() => {
    const currentIso = nowIso();
    const activePublications = publications.filter((publication) => publication.meli_status === "active" && Boolean(productsById.get(publication.product_id)));
    const pausedPublications = publications.filter((publication) => publication.meli_status && publication.meli_status !== "active" && Boolean(productsById.get(publication.product_id)));
    const publicationsByItemId = new Map(activePublications.map((publication) => [publication.meli_item_id, publication]));
    const salesBySku = new Map<string, MercadoLibreOrderItem[]>();

    sales.forEach((sale) => {
      const sku = (sale.sku || "").toUpperCase();
      if (!sku) return;
      salesBySku.set(sku, [...(salesBySku.get(sku) || []), sale]);
    });

    const rotationBySku = new Map<string, RotationStats>();
    products.forEach((product) => {
      const sku = product.sku.toUpperCase();
      const skuSales = salesBySku.get(sku) || [];
      const byDays = (days: number) => skuSales.filter((sale) => daysBetween(sale.order_date) <= days);
      const sales7 = byDays(7);
      const sales30 = byDays(30);
      const sales60 = byDays(60);
      rotationBySku.set(sku, {
        units7: sales7.reduce((total, sale) => total + numberValue(sale.quantity), 0),
        units30: sales30.reduce((total, sale) => total + numberValue(sale.quantity), 0),
        units60: sales60.reduce((total, sale) => total + numberValue(sale.quantity), 0),
        revenue30: sales30.reduce((total, sale) => total + numberValue(sale.total_amount), 0),
        lastSale: skuSales[0]?.order_date || null,
      });
    });

    const actions: AccountAction[] = [];
    const activePromoKeys = new Set<string>();
    const localSkuSet = new Set(products.map((product) => product.sku.toUpperCase()));
    const missingLocalProductLogs = new Map<string, MercadoLibreSyncLog>();

    activePublications.forEach((publication) => {
      const product = productsById.get(publication.product_id);
      if (!product) return;
      if (Number(publication.meli_promo_price || 0) > 0) activePromoKeys.add(`${product.sku}|${publicationInstallments(publication) || 1}`);
    });
    opportunities.filter(isActiveOpportunity).forEach((opportunity) => {
      const publication = publicationsByItemId.get(opportunity.meli_item_id);
      const product = publication ? productsById.get(publication.product_id) : null;
      if (!publication || !product) return;
      activePromoKeys.add(`${product.sku}|${publicationInstallments(publication) || 1}`);
    });

    syncLogs.forEach((log) => {
      const sku = (log.sku || "").toUpperCase();
      const itemId = log.meli_item_id || "";
      const stock = stockFromLogMessage(log.message);
      if (!sku || !itemId || !stock || stock <= 0) return;
      if (localSkuSet.has(sku)) return;
      if ((daysSince(log.created_at) ?? 99) > 2) return;
      const key = `${sku}|${itemId}`;
      if (!missingLocalProductLogs.has(key)) missingLocalProductLogs.set(key, log);
    });

    missingLocalProductLogs.forEach((log) => {
      const stock = stockFromLogMessage(log.message);
      actions.push({
        key: `missing-local-${log.sku}-${log.meli_item_id}`,
        type: "missing_local_product",
        priority: "critica",
        sku: log.sku || "SIN SKU",
        productName: "Publicacion ML sin producto local",
        itemId: log.meli_item_id,
        title: "Publicacion con stock fuera de la app",
        detail: log.message || "MercadoLibre la informo en la sync, pero no existe el SKU en productos.",
        href: "/productos",
        stock,
      });
    });

    pausedPublications.forEach((publication) => {
      const product = productsById.get(publication.product_id);
      if (!product) return;
      const stock = Number(publication.meli_stock ?? product.stock ?? 0);
      if (stock <= 0) return;
      const rotation = rotationBySku.get(product.sku.toUpperCase());
      const syncAge = daysSince(publication.meli_last_sync_at || publication.updated_at || publication.created_at);
      if (syncAge === null || syncAge > 1) {
        actions.push({
          key: `data-paused-sync-${publication.id || publication.meli_item_id}`,
          type: "data_issue",
          priority: "alta",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Publicacion no activa con stock viejo",
          detail: `Estado ML: ${publication.meli_status || "desconocido"}. Ultima sync: ${formatDateTime(publication.meli_last_sync_at || publication.updated_at || publication.created_at)}.`,
          href: "/configuracion/mercadolibre",
          stock,
          units7: rotation?.units7 || 0,
          units30: rotation?.units30 || 0,
        });
        return;
      }
      actions.push({
        key: `paused-${publication.id || publication.meli_item_id}`,
        type: "paused_stock",
        priority: "critica",
        sku: product.sku,
        productName: product.name,
        itemId: publication.meli_item_id,
        title: "Publicacion pausada con stock",
        detail: `Estado ML: ${publication.meli_status || "desconocido"}. Revisar si se puede reactivar.`,
        href: "/productos",
        stock,
        units7: rotation?.units7 || 0,
        units30: rotation?.units30 || 0,
      });
    });

    // Cada rango mayorista queda guardado por MLA y cantidad. El margen fue
    // calculado al activarlo con el precio real de ML; si queda bajo o
    // negativo debe aparecer arriba en el controlador, no escondido dentro
    // de la pantalla de precios.
    b2bGuards
      .filter((guard) => guard.active)
      .forEach((guard) => {
        const margin = Number(guard.target_margin_rate || 0);
        if (!Number.isFinite(margin) || margin >= 5) return;
        const product = products.find((item) => item.sku.toUpperCase() === String(guard.sku || "").toUpperCase());
        if (!product) return;
        const publication = publications.find((item) => item.meli_item_id === guard.meli_item_id);
        const rotation = rotationBySku.get(product.sku.toUpperCase());
        actions.push({
          key: `b2b-margin-${guard.meli_item_id}-${guard.minimum_purchase_unit}`,
          type: "b2b_margin",
          priority: margin <= 0 ? "critica" : "alta",
          sku: product.sku,
          productName: product.name,
          itemId: guard.meli_item_id,
          title: margin <= 0 ? "Mayorista activo con margen negativo" : "Mayorista activo con margen bajo",
          detail: `${guard.minimum_purchase_unit} u. o más · verificá el precio mayorista y el aporte vigente de ML.`,
          href: `/precios?sku=${encodeURIComponent(product.sku)}`,
          margin,
          stock: Number(publication?.meli_stock ?? product.stock ?? 0),
          units7: rotation?.units7 || 0,
          units30: rotation?.units30 || 0,
        });
      });

    // Una pérdida ya realizada no debe quedar oculta detrás del margen actual
    // de la publicación: se marca durante 24 h para que sea lo primero a revisar.
    sales
      .filter((sale) => daysBetween(sale.order_date) <= 1)
      .forEach((sale) => {
        const profit = Number(sale.real_total_net_profit ?? sale.normalized_total_net_profit);
        if (!Number.isFinite(profit) || profit >= 0) return;
        const product = (sale.product_id ? productsById.get(sale.product_id) : null) || products.find((item) => item.sku.toUpperCase() === String(sale.sku || "").toUpperCase());
        const units = numberValue(sale.quantity);
        const netSale = numberValue(sale.real_net_sale_price ?? sale.normalized_net_sale_price) * units;
        const margin = netSale > 0 ? profit / netSale * 100 : null;
        const publication = publications.find((item) => item.meli_item_id === sale.meli_item_id);
        actions.push({
          key: `negative-sale-${sale.id || sale.order_id}-${sale.meli_item_id}`,
          type: "negative_sale",
          priority: "critica",
          sku: sale.sku || product?.sku || "SIN SKU",
          productName: sale.title || product?.name || "Venta Mercado Libre",
          itemId: sale.meli_item_id,
          title: "Venta reciente con margen negativo",
          detail: `${formatDateTime(sale.order_date)} · Vendido ${moneyWithCents(sale.total_amount)} · Pérdida ${moneyWithCents(profit)}.`,
          href: "/monitor-ventas",
          margin,
          stock: Number(publication?.meli_stock ?? product?.stock ?? 0),
          salePrice: numberValue(sale.total_amount),
        });
      });

    activePublications.forEach((publication) => {
      const product = productsById.get(publication.product_id);
      if (!product) return;
      const sku = product.sku.toUpperCase();
      const rotation = rotationBySku.get(sku) || { units7: 0, units30: 0, units60: 0, revenue30: 0 };
      const stock = Number(publication.meli_stock ?? product.stock ?? 0);
      const installment = publicationInstallments(publication) || 1;
      const currentBuyerPrice = Number(publication.meli_promo_price || publication.meli_price || 0) || null;
      const currentSalePrice = Number(publication.meli_promo_price || 0)
        ? effectiveSalePrice(publication.meli_promo_price, publication.meli_promo_meli_amount, publication.meli_promo_meli_rate, publication.meli_original_price || publication.meli_price, publication.meli_promo_seller_rate)
        : currentBuyerPrice;
      const currentMargin = marginForPublication(product, publication, currentSalePrice, currentBuyerPrice);
      const targetMargin = Number(channelSetting(product.id, optionForPublication(publication).code)?.desired_margin_rate ?? 5);

      if (!Number(product.cost_without_vat || 0)) {
        actions.push({
          key: `data-cost-${product.id}`,
          type: "data_issue",
          priority: "alta",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Producto sin costo",
          detail: "Sin costo no se puede confiar en margenes ni sugerencias.",
          href: "/productos",
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
        });
      }

      if ((daysSince(publication.meli_last_sync_at || publication.updated_at || publication.created_at) ?? 99) > 1) {
        actions.push({
          key: `data-sync-${publication.id || publication.meli_item_id}`,
          type: "data_issue",
          priority: "media",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Datos ML atrasados",
          detail: `Ultima sync: ${formatDateTime(publication.meli_last_sync_at || publication.updated_at || publication.created_at)}.`,
          href: "/configuracion/mercadolibre",
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
        });
      }

      if (promotionCoverage(publication).known && !dataLoad.incomplete && !activePromoKeys.has(`${product.sku}|${installment}`)) {
        actions.push({
          key: `missing-promo-${publication.id || publication.meli_item_id}`,
          type: "missing_promo",
          priority: "media",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Publicacion activa sin promo vigente",
          detail: `${installmentLabel(installment)} sin promo activa detectada.`,
          href: "/promociones-meli",
          margin: currentMargin,
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
          salePrice: currentSalePrice,
          buyerPrice: currentBuyerPrice,
        });
      }

      if (currentMargin !== null && currentMargin < targetMargin - 0.1) {
        actions.push({
          key: `low-margin-${publication.id || publication.meli_item_id}`,
          type: "low_margin",
          priority: currentMargin <= 0 || currentMargin < 5 ? "critica" : "alta",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Margen real debajo del objetivo",
          detail: `${publication.meli_promo_name || "Precio, promo, envío o costo a revisar."} · Real ${percent(currentMargin)} / objetivo ${percent(targetMargin)}.`,
          href: `/precios?sku=${encodeURIComponent(product.sku)}`,
          margin: currentMargin,
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
          salePrice: currentSalePrice,
          buyerPrice: currentBuyerPrice,
        });
      } else if (currentMargin !== null && currentMargin < 10 && (rotation.units7 >= 3 || rotation.units30 >= 8)) {
        actions.push({
          key: `low-margin-rotation-${publication.id || publication.meli_item_id}`,
          type: "low_margin_high_rotation",
          priority: "alta",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Vende bien pero deja poco margen",
          detail: "Conviene revisar precio o costo antes de escalar ventas.",
          href: `/precios?sku=${encodeURIComponent(product.sku)}`,
          margin: currentMargin,
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
          salePrice: currentSalePrice,
          buyerPrice: currentBuyerPrice,
        });
      } else if (currentMargin !== null && currentMargin >= 25 && rotation.units30 === 0 && stock > 0) {
        actions.push({
          key: `high-margin-idle-${publication.id || publication.meli_item_id}`,
          type: "high_margin_low_rotation",
          priority: "alta",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Margen alto y sin ventas recientes",
          detail: "Hay espacio para promo o ajuste de precio.",
          href: "/rotacion-sku?estado=slow",
          margin: currentMargin,
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
          salePrice: currentSalePrice,
          buyerPrice: currentBuyerPrice,
        });
      }

    });

    // El stock y la rotación corresponden al SKU, no a cada MLA o cuota.
    // Las publicaciones pueden compartir inventario: nunca sumamos sus stocks.
    const stockPublicationsBySku = new Map<string, MercadoLibreShippingCost[]>();
    activePublications.forEach((publication) => {
      const sku = productsById.get(publication.product_id)!.sku.toUpperCase();
      stockPublicationsBySku.set(sku, [...(stockPublicationsBySku.get(sku) || []), publication]);
    });
    stockPublicationsBySku.forEach((skuPublications, sku) => {
      const product = productsById.get(skuPublications[0].product_id)!;
      const rotation = rotationBySku.get(sku) || { units7: 0, units30: 0, units60: 0, revenue30: 0 };
      const withStock = skuPublications.filter((publication) => publication.meli_stock != null);
      const synced = withStock.map((publication) => ({
        publication,
        time: new Date(publication.meli_last_sync_at || publication.updated_at || 0).getTime(),
      })).filter((item) => Number.isFinite(item.time) && item.time > 0);
      const latest = Math.max(0, ...synced.map((item) => item.time));
      const stockSources = synced.length
        ? synced.filter((item) => latest - item.time <= 10 * 60 * 1000).map((item) => item.publication)
        : withStock;
      const stock = stockSources.length
        ? Math.max(...stockSources.map((publication) => numberValue(publication.meli_stock)))
        : numberValue(product.stock);
      const dailyUnits = Math.max(rotation.units7 / 7, rotation.units30 / 30, rotation.units60 / 60);
      const stockDays = dailyUnits > 0 ? stock / dailyUnits : null;

      if (stockDays !== null && stockDays < 14) {
        actions.push({
          key: `stock-risk-${sku}`,
          type: "stock_risk",
          priority: "media",
          sku: product.sku,
          productName: product.name,
          title: "Riesgo de quedarse sin stock",
          detail: `Stock estimado para ${stock <= 0 ? 0 : Math.max(1, Math.round(stockDays))} dias. Ventas de todas las publicaciones del SKU.`,
          href: "/rotacion-sku?estado=break_risk",
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
        });
      } else if (stock >= 5 && rotation.units30 === 0) {
        actions.push({
          key: `stock-idle-${sku}`,
          type: "stock_idle",
          priority: "media",
          sku: product.sku,
          productName: product.name,
          title: "Stock sin rotacion",
          detail: "Sin ventas en 30 dias con stock disponible.",
          href: "/rotacion-sku?estado=capital_idle",
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
        });
      }
    });

    opportunities.forEach((opportunity) => {
      if (isActiveOpportunity(opportunity)) return;
      const publication = publicationsByItemId.get(opportunity.meli_item_id);
      if (!publication) return;
      const product = productsById.get(publication.product_id);
      if (!product) return;
      const buyerPrice = Number(opportunity.promo_price || 0) || null;
      const meliAmount = meliContributionAmount(buyerPrice, opportunity.meli_amount, opportunity.meli_percentage, opportunity.original_price || publication.meli_price, opportunity.seller_percentage);
      const salePrice = effectiveSalePrice(buyerPrice, meliAmount, opportunity.meli_percentage, opportunity.original_price || publication.meli_price, opportunity.seller_percentage);
      const margin = marginForPublication(product, publication, salePrice, buyerPrice, promotionFixedFeeAmount(opportunity));
      if (margin === null || margin < 5) return;
      const future = isFutureOpportunity(opportunity, currentIso);
      const rotation = rotationBySku.get(product.sku.toUpperCase());
      actions.push({
        key: `${future ? "future" : "activate"}-${opportunity.offer_id || opportunity.promotion_id}-${opportunity.meli_item_id}`,
        type: future ? "future_promo" : "activate_promo",
        priority: margin >= 12 || meliAmount >= 10000 ? "alta" : "media",
        sku: product.sku,
        productName: product.name,
        itemId: opportunity.meli_item_id,
        title: future ? "Promo futura rentable" : "Promo rentable para activar",
        detail: `${opportunity.promotion_name || opportunity.promotion_id} · ${installmentLabel(publicationInstallments(publication))}`,
        href: future ? "/asesoria-360" : "/promociones-meli",
        margin,
        stock: Number(publication.meli_stock ?? product.stock ?? 0),
        units7: rotation?.units7 || 0,
        units30: rotation?.units30 || 0,
        buyerPrice,
        salePrice,
        meliAmount,
        startDate: opportunity.start_date || null,
      });
    });

    const latestSync = publications.map((publication) => publication.meli_last_sync_at || publication.updated_at || publication.created_at || null).filter(Boolean).sort().at(-1) || null;
    const typeCounts = actions.reduce((acc, action) => {
      acc[action.type] = (acc[action.type] || 0) + 1;
      return acc;
    }, {} as Record<ActionType, number>);
    const priorityOrder: Record<Priority, number> = { critica: 1, alta: 2, media: 3, baja: 4 };
    const typeOrder: Record<ActionType, number> = {
      paused_stock: 1,
      negative_sale: 2,
      missing_local_product: 3,
      low_margin: 4,
      b2b_margin: 5,
      low_margin_high_rotation: 6,
      activate_promo: 7,
      high_margin_low_rotation: 8,
      stock_risk: 9,
      stock_idle: 10,
      missing_promo: 11,
      future_promo: 12,
      data_issue: 13,
    };

    return {
      actions: actions.sort((a, b) => {
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) return priorityOrder[a.priority] - priorityOrder[b.priority];
        if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
        return Number(b.margin || 0) - Number(a.margin || 0);
      }),
      typeCounts,
      latestSync,
      activePublications: activePublications.length,
      pausedWithStock: typeCounts.paused_stock || 0,
      b2bLowMargin: typeCounts.b2b_margin || 0,
      sales7: [...rotationBySku.values()].reduce((total, item) => total + item.units7, 0),
      sales30: [...rotationBySku.values()].reduce((total, item) => total + item.units30, 0),
      revenue30: [...rotationBySku.values()].reduce((total, item) => total + item.revenue30, 0),
    };
  }, [products, productsById, publications, opportunities, sales, pricingOptions, categoryFees, taxes, marginSettings, syncLogs, b2bGuards, dataLoad.incomplete]);

  const filteredActions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return account.actions.filter((action) => {
      if (typeFilter !== "all" && action.type !== typeFilter) return false;
      if (priorityFilter !== "all" && action.priority !== priorityFilter) return false;
      if (!needle) return true;
      return `${action.sku} ${action.productName} ${action.itemId || ""} ${action.title} ${action.detail}`.toLowerCase().includes(needle);
    });
  }, [account.actions, priorityFilter, query, typeFilter]);

  const alertGroups = useMemo(() => groupAlerts(filteredActions), [filteredActions]);
  useRememberedView(supabase, 'dashboard', [query, typeFilter, priorityFilter, listPage], (values) => { setQuery(values[0]); setTypeFilter(values[1]); setPriorityFilter(values[2]); setListPage(values[3]); }, !dataLoad.incomplete);
  return (
    <main className="container wide dashboard-page opportunities-page">
      <PageHero
        title="Control de cuenta"
        description="Detectá y resolvé primero los problemas que pueden afectar margen, stock o precios mayoristas."
        icon={<ShieldCheck aria-hidden="true" />}
        onRefresh={() => loadData()}
        refreshLabel={loading ? "Actualizando..." : "Actualizar vista"}
        refreshDisabled={loading || syncing}
        actions={
          <button className="button" type="button" onClick={syncAccount} disabled={loading || syncing}>
            <RefreshCcw aria-hidden="true" />
            {syncing ? "Sincronizando..." : "Sincronizar con Mercado Libre"}
          </button>
        }
      />

      <PricingDataStatus state={dataLoad.state} publications={publications} onRefresh={() => loadData()} />
      {error && <div className="message error">{error}</div>}
      {syncInfo && <div className="message success">{syncInfo}</div>}
      {syncProgress && (
        <section className="card dashboard-sync-progress" aria-live="polite">
          <div className="dashboard-sync-progress-head">
            <strong>{syncProgress.label}</strong>
            <span>{syncProgress.percent}%</span>
          </div>
          <div className="dashboard-sync-progress-track">
            <span style={{ width: `${syncProgress.percent}%` }} />
          </div>
          <small>La sincronizacion completa puede tardar varios minutos si hay muchas publicaciones.</small>
        </section>
      )}

      <section className="dashboard-account-score-grid">
        <article className={`card dashboard-kpi dashboard-kpi-primary ${account.pausedWithStock ? "danger" : "success"}`}>
          <span>Pausadas con stock</span>
          <strong>{dataLoad.initial ? "—" : account.pausedWithStock}</strong>
          <small>Se pueden estar perdiendo ventas</small>
        </article>
        <article className={`card dashboard-kpi dashboard-kpi-primary ${(account.typeCounts.low_margin || 0) ? "danger" : "success"}`}>
          <span>Margen real bajo objetivo</span>
          <strong>{dataLoad.initial ? "—" : account.typeCounts.low_margin || 0}</strong>
          <small>Publicaciones activas debajo de su margen configurado</small>
        </article>
        <article className={`card dashboard-kpi dashboard-kpi-primary ${account.b2bLowMargin ? "danger" : "success"}`}>
          <span>Mayorista a revisar</span>
          <strong>{dataLoad.initial ? "—" : account.b2bLowMargin}</strong>
          <small>Rangos B2B activos debajo de 5%</small>
        </article>
        <article className={`card dashboard-kpi dashboard-kpi-primary ${account.actions.filter((action) => action.priority === "critica").length ? "danger" : "success"}`}>
          <span>Alertas críticas</span>
          <strong>{dataLoad.initial ? "—" : account.actions.filter((action) => action.priority === "critica").length}</strong>
          <small>Resolver antes de ajustar promociones</small>
        </article>
      </section>

      <section className="opportunity-summary-grid dashboard-action-summary">
        <button className={`kpi-card opportunity-summary ${typeFilter === "all" ? "active" : ""}`} type="button" onClick={() => setTypeFilter("all")}>
          <span className="kpi-label">Todas las alertas</span>
          <strong className="kpi-value">{dataLoad.initial ? "—" : account.actions.length}</strong>
          <small className="kpi-meta">Ordenadas por impacto</small>
        </button>
        {(["paused_stock", "low_margin", "b2b_margin", "data_issue", "stock_risk"] as ActionType[]).map((type) => (
          <button className={`kpi-card opportunity-summary ${typeFilter === type ? "active" : ""}`} type="button" onClick={() => setTypeFilter(type)} key={type}>
            <span className="kpi-label">{typeLabel(type)}</span>
            <strong className="kpi-value">{dataLoad.initial ? "—" : account.typeCounts[type] || 0}</strong>
            <small className="kpi-meta">Ver casos</small>
          </button>
        ))}
      </section>

      <section className="card toolbar-card opportunity-toolbar">
        <label className="search-control">
          <Search aria-hidden="true" />
          <input className="form-control search-field" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar alertas" placeholder="Buscar SKU, MLA, producto o alerta" />
        </label>
        <select className="form-control" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as typeof priorityFilter)}>
          <option value="all">Todas las prioridades</option>
          <option value="critica">Critica</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>
        <select className="form-control" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
          <option value="all">Todos los tipos</option>
          <option value="paused_stock">Pausadas con stock</option>
          <option value="b2b_margin">Mayorista con margen bajo</option>
          <option value="missing_local_product">En ML sin producto</option>
          <option value="low_margin">Margen bajo</option>
          <option value="negative_sale">Venta con pérdida</option>
          <option value="activate_promo">Promos para activar</option>
          <option value="missing_promo">Sin promo</option>
          <option value="high_margin_low_rotation">Margen alto sin rotar</option>
          <option value="low_margin_high_rotation">Vende con poco margen</option>
          <option value="stock_risk">Riesgo de stock</option>
          <option value="stock_idle">Stock quieto</option>
          <option value="future_promo">Promos futuras</option>
          <option value="data_issue">Datos</option>
        </select>
      </section>

      <section className="card opportunity-list-card">
          <div className="opportunity-list-head">
            <div>
            <h2>Problemas para actuar</h2>
            <p>{filteredActions.length} resultado(s). Casos calculados sobre los datos guardados; verificar fecha y cobertura antes de actuar.</p>
          </div>
          <div className="dashboard-last-sync">
            <Database aria-hidden="true" />
            <span>Sync ML {formatDateTime(account.latestSync)}</span>
          </div>
        </div>

        <PricingPagination page={listPage} total={dataLoad.initial ? 0 : alertGroups.length} onPage={setListPage} />
        <p>{dataLoad.initial ? '—' : alertGroups.length} productos afectados · {dataLoad.initial ? '—' : new Set(filteredActions.map(item => item.itemId).filter(Boolean)).size} publicaciones · {dataLoad.initial ? '—' : filteredActions.length} alertas. Las ventas se cuentan por SKU; margen y precio corresponden al MLA.</p>
        <details className="pricing-explanation"><summary>Severidad y alcance</summary><p>Regla existente: margen negativo, cero o menor al 5% se clasifica crítico. Un desvío de más de 0,1 puntos frente al objetivo es alto si el margen alcanza 5%. Por eso una diferencia pequeña puede ser crítica cuando el margen absoluto es menor al 5%. No se cambiaron estos umbrales de negocio.</p><p>Revisar antes de actuar si faltan datos o las publicaciones están atrasadas. Actualizar vista sólo consulta la base. Sincronizar con Mercado Libre actualiza la integración y puede ejecutar las protecciones mayoristas configuradas.</p></details>
        <div className="opportunity-action-list">
          {alertGroups.slice((Math.min(listPage, Math.max(1, Math.ceil(alertGroups.length / 40))) - 1) * 40, Math.min(listPage, Math.max(1, Math.ceil(alertGroups.length / 40))) * 40).map((group) => (
            <details className="pricing-alert-group" key={group.sku}>
              <summary><strong>{group.sku} · {group.alerts[0].productName}</strong><span>{group.alerts.length} alertas · {group.publications} publicaciones · Prioridad {priorityLabel(group.alerts[0].priority)}</span><small>Ventas del SKU: {group.alerts[0].units7 ?? '—'} u. / 7 días · {group.alerts[0].units30 ?? '—'} u. / 30 días</small></summary>
              {group.alerts.map((item) => (
            <article className={`action-card opportunity-row ${actionTone(item.type)} priority-${item.priority}`} key={item.key}>
              <div className="opportunity-row-main">
                <div className="opportunity-row-title">
                  <span className={`badge ${item.priority === "critica" ? "badge-high" : item.priority === "alta" ? "badge-warning" : "badge-neutral"}`}>{priorityLabel(item.priority)}</span>
                  <span className="badge badge-low">{typeLabel(item.type)}</span>
                  {item.startDate && <span className="badge badge-date">Desde {formatDate(item.startDate)}</span>}
                </div>
                <strong>{item.sku} - {item.productName}</strong>
                <small>{item.title}: {item.detail}</small><small>{dataLoad.incomplete || (item.itemId && (!publications.find(publication => publication.meli_item_id === item.itemId)?.meli_last_sync_at || Date.now() - Date.parse(publications.find(publication => publication.meli_item_id === item.itemId)?.meli_last_sync_at || '') > 86400000)) ? 'Requiere verificación: datos parciales o desactualizados · ' : ''}{item.itemId ? 'Dato ML: ' + formatDateTime(publications.find(publication => publication.meli_item_id === item.itemId)?.meli_last_sync_at) : 'Métrica consolidada por SKU'}</small>
                <small>{[item.itemId, typeof item.stock === "number" ? `Stock ${item.stock}` : null].filter(Boolean).join(" | ")}</small>
              </div>

              <div className="opportunity-row-metrics">
                <div className="mini-stat">
                  <span>Margen</span>
                  <strong className={item.margin === null || item.margin === undefined ? "neutral" : item.margin < 5 ? "negative" : item.margin < 10 ? "warning" : "positive"}>{item.margin === undefined || item.margin === null ? "-" : percent(item.margin)}</strong>
                </div>
                <div className="mini-stat">
                  <span>Venta SKU 7d</span>
                  <strong>{item.units7 ?? 0} u.</strong>
                </div>
                <div className="mini-stat">
                  <span>Venta SKU 30d</span>
                  <strong>{item.units30 ?? 0} u.</strong>
                </div>
                <div className="mini-stat">
                  <span>Precio / aporte</span>
                  <strong>{moneyWithCents(item.salePrice || item.buyerPrice || null)}{item.meliAmount ? ` · ML ${moneyWithCents(item.meliAmount)}` : ""}</strong>
                </div>
              </div>

              <Link className="button opportunity-open-button" href={resolutionHref(item)}>
                {item.type === "b2b_margin" ? "Ver mayorista" : item.type === "low_margin" || item.type === "low_margin_high_rotation" ? "Revisar precio" : "Resolver"}
                <ChevronRight aria-hidden="true" />
              </Link>
            </article>
              ))}</details>
          ))}

          {loading && !filteredActions.length && (
            <>
              <div className="skeleton skeleton-action" />
              <div className="skeleton skeleton-action" />
              <div className="skeleton skeleton-action" />
            </>
          )}
          {!dataLoad.incomplete && !filteredActions.length && <div className="empty-state">No hay acciones para los filtros actuales.</div>}
        </div>
      </section>

    </main>
  );
}
