"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgePercent, BarChart3, ChevronRight, Database, PackageX, RefreshCcw, Search, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
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
  | "activate_promo"
  | "future_promo"
  | "missing_promo"
  | "high_margin_low_rotation"
  | "low_margin_high_rotation"
  | "stock_risk"
  | "stock_idle"
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
    activate_promo: "Promo para activar",
    future_promo: "Promo futura",
    missing_promo: "Sin promo",
    high_margin_low_rotation: "Margen alto sin rotar",
    low_margin_high_rotation: "Vende con poco margen",
    stock_risk: "Riesgo de stock",
    stock_idle: "Stock quieto",
    data_issue: "Dato a revisar",
  };
  return labels[type];
}

function actionTone(type: ActionType) {
  if (type === "paused_stock" || type === "low_margin") return "review";
  if (type === "future_promo") return "future";
  if (type === "data_issue") return "data_issue";
  if (type === "missing_promo") return "missing_promo";
  return "activate";
}

function scoreTone(score: number) {
  if (score >= 85) return "success";
  if (score >= 70) return "warning";
  return "danger";
}

export default function DashboardPage() {
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
  const [typeFilter, setTypeFilter] = useState<"all" | ActionType>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function fetchSalesSince(sinceIso: string) {
    const pageSize = 1000;
    const result: MercadoLibreOrderItem[] = [];
    for (let from = 0; from < 20000; from += pageSize) {
      const response = await supabase
        .from("mercadolibre_order_items")
        .select("*")
        .gte("order_date", sinceIso)
        .neq("status", "cancelled")
        .order("order_date", { ascending: false })
        .range(from, from + pageSize - 1);
      if (response.error) return response;
      const page = (response.data || []) as MercadoLibreOrderItem[];
      result.push(...page);
      if (page.length < pageSize) break;
    }
    return { data: result, error: null };
  }

  async function fetchOpportunities() {
    const result: MercadoLibrePromotionOpportunity[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const response = await supabase
        .from("mercadolibre_promotion_opportunities")
        .select("*")
        .order("meli_amount", { ascending: false })
        .range(from, from + 999);
      if (response.error) return response;
      const rows = (response.data || []) as MercadoLibrePromotionOpportunity[];
      result.push(...rows);
      if (rows.length < 1000) break;
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
      opportunitiesResponse,
      salesResponse,
      installmentsResponse,
      categoryFeesResponse,
      taxesResponse,
      marginsResponse,
    ] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active").order("sku", { ascending: true }),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true),
      fetchOpportunities(),
      fetchSalesSince(since.toISOString()),
      supabase.from("mercadolibre_installment_fees").select("*").eq("active", true).order("code", { ascending: true }),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
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
    if (salesResponse.error) setError(salesResponse.error.message);
    else setSales((salesResponse.data || []) as MercadoLibreOrderItem[]);
    if (installmentsResponse.error) setError(installmentsResponse.error.message);
    else setInstallments(((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]).filter((item) => item.code !== "MC"));
    if (categoryFeesResponse.error) setError(categoryFeesResponse.error.message);
    else setCategoryFees((categoryFeesResponse.data || []) as MercadoLibreCategoryFee[]);
    if (taxesResponse.error) setError(taxesResponse.error.message);
    else setTaxes((taxesResponse.data || defaultTaxSettings()) as TaxSettings);
    if (marginsResponse.error) setError(marginsResponse.error.message);
    else setMarginSettings((marginsResponse.data || []) as ProductChannelMargin[]);
  }

  async function syncAccount() {
    setSyncing(true);
    setError(null);
    setSyncInfo(null);
    try {
      const shippingResponse = await fetch("/api/mercadolibre/sync-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      const shippingData = await shippingResponse.json();
      if (!shippingResponse.ok) throw new Error(shippingData?.error || "No se pudo sincronizar MercadoLibre.");

      const salesResponse = await fetch("/api/mercadolibre/sync-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 60, chunkDays: 7 }),
      });
      const salesData = await salesResponse.json();
      if (!salesResponse.ok) throw new Error(salesData?.error || "No se pudieron sincronizar ventas.");

      setSyncInfo(
        `Sync completa: ${shippingData.updated || 0} publicaciones actualizadas, ${shippingData.changed || 0} costos de envio cambiados, ` +
        `${shippingData.promotion_opportunities || 0} promos guardadas, ${shippingData.installment_fee_updates || 0} costos de cuotas actualizados, ` +
        `${shippingData.category_fee_updates || 0} costos de canal actualizados. Ventas: ${salesData.saved || 0} items guardados.`,
      );
      await loadData();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudo sincronizar la cuenta.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    checkSession();
    loadData();
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

    pausedPublications.forEach((publication) => {
      const product = productsById.get(publication.product_id);
      if (!product) return;
      const stock = Number(publication.meli_stock ?? product.stock ?? 0);
      if (stock <= 0) return;
      const rotation = rotationBySku.get(product.sku.toUpperCase());
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
      const dailyUnits = Math.max(rotation.units7 / 7, rotation.units30 / 30, rotation.units60 / 60);
      const stockDays = dailyUnits > 0 ? stock / dailyUnits : null;

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

      if (!activePromoKeys.has(`${product.sku}|${installment}`)) {
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

      if (currentMargin !== null && currentMargin < 5) {
        actions.push({
          key: `low-margin-${publication.id || publication.meli_item_id}`,
          type: "low_margin",
          priority: "critica",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Margen peligroso en publicacion activa",
          detail: publication.meli_promo_name || "Revisar precio, promo, envio o costo.",
          href: "/rentabilidad-meli",
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
          href: "/rentabilidad-meli",
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
          href: "/promociones-meli",
          margin: currentMargin,
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
          salePrice: currentSalePrice,
          buyerPrice: currentBuyerPrice,
        });
      }

      if (stockDays !== null && stockDays < 14) {
        actions.push({
          key: `stock-risk-${publication.id || publication.meli_item_id}`,
          type: "stock_risk",
          priority: "media",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Riesgo de quedarse sin stock",
          detail: `Stock estimado para ${Math.max(1, Math.round(stockDays))} dias.`,
          href: "/rotacion-sku",
          margin: currentMargin,
          stock,
          units7: rotation.units7,
          units30: rotation.units30,
        });
      } else if (stock >= 5 && rotation.units30 === 0) {
        actions.push({
          key: `stock-idle-${publication.id || publication.meli_item_id}`,
          type: "stock_idle",
          priority: "media",
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id,
          title: "Stock sin rotacion",
          detail: "Sin ventas en 30 dias con stock disponible.",
          href: "/rotacion-sku",
          margin: currentMargin,
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
    const pillarPenalties = {
      stock: Math.min(40, (typeCounts.paused_stock || 0) * 10 + (typeCounts.stock_risk || 0) * 5 + (typeCounts.stock_idle || 0) * 3),
      promos: Math.min(45, (typeCounts.missing_promo || 0) * 3 + (typeCounts.activate_promo || 0) * 2 + (typeCounts.future_promo || 0)),
      rentabilidad: Math.min(50, (typeCounts.low_margin || 0) * 12 + (typeCounts.low_margin_high_rotation || 0) * 7),
      rotacion: Math.min(35, (typeCounts.high_margin_low_rotation || 0) * 6 + (typeCounts.stock_idle || 0) * 3),
      datos: Math.min(35, (typeCounts.data_issue || 0) * 4),
    };
    const pillars = [
      { key: "stock", label: "Stock", score: Math.max(0, 100 - pillarPenalties.stock), detail: `${(typeCounts.paused_stock || 0) + (typeCounts.stock_risk || 0) + (typeCounts.stock_idle || 0)} alertas` },
      { key: "promos", label: "Promos", score: Math.max(0, 100 - pillarPenalties.promos), detail: `${(typeCounts.missing_promo || 0) + (typeCounts.activate_promo || 0)} oportunidades` },
      { key: "rentabilidad", label: "Rentabilidad", score: Math.max(0, 100 - pillarPenalties.rentabilidad), detail: `${(typeCounts.low_margin || 0) + (typeCounts.low_margin_high_rotation || 0)} riesgos` },
      { key: "rotacion", label: "Rotacion", score: Math.max(0, 100 - pillarPenalties.rotacion), detail: `${(typeCounts.high_margin_low_rotation || 0) + (typeCounts.stock_idle || 0)} lentos` },
      { key: "datos", label: "Datos", score: Math.max(0, 100 - pillarPenalties.datos), detail: `${typeCounts.data_issue || 0} pendientes` },
    ];
    const score = Math.round(pillars.reduce((total, pillar) => total + pillar.score, 0) / pillars.length);
    const priorityOrder: Record<Priority, number> = { critica: 1, alta: 2, media: 3, baja: 4 };
    const typeOrder: Record<ActionType, number> = {
      paused_stock: 1,
      low_margin: 2,
      low_margin_high_rotation: 3,
      activate_promo: 4,
      high_margin_low_rotation: 5,
      stock_risk: 6,
      stock_idle: 7,
      missing_promo: 8,
      future_promo: 9,
      data_issue: 10,
    };

    return {
      score,
      pillars,
      actions: actions.sort((a, b) => {
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) return priorityOrder[a.priority] - priorityOrder[b.priority];
        if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
        return Number(b.margin || 0) - Number(a.margin || 0);
      }),
      typeCounts,
      latestSync,
      activePublications: activePublications.length,
      pausedWithStock: typeCounts.paused_stock || 0,
      sales7: [...rotationBySku.values()].reduce((total, item) => total + item.units7, 0),
      sales30: [...rotationBySku.values()].reduce((total, item) => total + item.units30, 0),
      revenue30: [...rotationBySku.values()].reduce((total, item) => total + item.revenue30, 0),
    };
  }, [products, productsById, publications, opportunities, sales, pricingOptions, categoryFees, taxes, marginSettings]);

  const filteredActions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return account.actions.filter((action) => {
      if (typeFilter !== "all" && action.type !== typeFilter) return false;
      if (priorityFilter !== "all" && action.priority !== priorityFilter) return false;
      if (!needle) return true;
      return `${action.sku} ${action.productName} ${action.itemId || ""} ${action.title} ${action.detail}`.toLowerCase().includes(needle);
    });
  }, [account.actions, priorityFilter, query, typeFilter]);

  return (
    <main className="container wide dashboard-page opportunities-page">
      <PageHero
        title="Dashboard"
        description="Salud de la cuenta MercadoLibre: stock, promociones, rentabilidad, rotacion y calidad de datos."
        icon={<ShieldCheck aria-hidden="true" />}
        onRefresh={loadData}
        refreshLabel={loading ? "Actualizando..." : "Actualizar"}
        refreshDisabled={loading || syncing}
        actions={
          <button className="button" type="button" onClick={syncAccount} disabled={loading || syncing}>
            <RefreshCcw aria-hidden="true" />
            {syncing ? "Sincronizando..." : "Sync completa"}
          </button>
        }
      />

      {error && <div className="message error">{error}</div>}
      {syncInfo && <div className="message success">{syncInfo}</div>}

      <section className="dashboard-account-score-grid">
        <article className={`card dashboard-score-card ${scoreTone(account.score)}`}>
          <span>Score cuenta</span>
          <strong>{account.score}</strong>
          <small>Promedio de stock, promos, rentabilidad, rotacion y datos</small>
        </article>
        <article className="card dashboard-kpi dashboard-kpi-primary">
          <span>Acciones pendientes</span>
          <strong>{account.actions.length}</strong>
          <small>{account.actions.filter((action) => action.priority === "critica" || action.priority === "alta").length} de prioridad alta o critica</small>
        </article>
        <article className={`card dashboard-kpi dashboard-kpi-primary ${account.pausedWithStock ? "danger" : "success"}`}>
          <span>Pausadas con stock</span>
          <strong>{account.pausedWithStock}</strong>
          <small>Publicaciones que pueden estar perdiendo ventas</small>
        </article>
        <article className="card dashboard-kpi dashboard-kpi-primary">
          <span>Ventas 7 / 30 dias</span>
          <strong>{account.sales7} / {account.sales30}</strong>
          <small>{moneyWithCents(account.revenue30)} vendidos en 30 dias</small>
        </article>
      </section>

      <section className="dashboard-pillar-grid">
        {account.pillars.map((pillar) => (
          <article className={`dashboard-pillar-card ${scoreTone(pillar.score)}`} key={pillar.key}>
            <span>{pillar.label}</span>
            <strong>{pillar.score}</strong>
            <small>{pillar.detail}</small>
          </article>
        ))}
      </section>

      <section className="opportunity-summary-grid dashboard-action-summary">
        <button className={`kpi-card opportunity-summary ${typeFilter === "all" ? "active" : ""}`} type="button" onClick={() => setTypeFilter("all")}>
          <span className="kpi-label">Todas</span>
          <strong className="kpi-value">{account.actions.length}</strong>
          <small className="kpi-meta">Acciones priorizadas</small>
        </button>
        {(["paused_stock", "low_margin", "activate_promo", "missing_promo", "high_margin_low_rotation"] as ActionType[]).map((type) => (
          <button className={`kpi-card opportunity-summary ${typeFilter === type ? "active" : ""}`} type="button" onClick={() => setTypeFilter(type)} key={type}>
            <span className="kpi-label">{typeLabel(type)}</span>
            <strong className="kpi-value">{account.typeCounts[type] || 0}</strong>
            <small className="kpi-meta">Ver casos</small>
          </button>
        ))}
      </section>

      <section className="card toolbar-card opportunity-toolbar">
        <label className="search-control">
          <Search aria-hidden="true" />
          <input className="form-control search-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, MLA, producto o alerta" />
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
          <option value="low_margin">Margen bajo</option>
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
            <h2>Acciones recomendadas</h2>
            <p>{filteredActions.length} resultado(s). Ordenado por impacto operativo.</p>
          </div>
          <div className="dashboard-last-sync">
            <Database aria-hidden="true" />
            <span>Sync ML {formatDateTime(account.latestSync)}</span>
          </div>
        </div>

        <div className="opportunity-action-list">
          {filteredActions.map((item) => (
            <article className={`action-card opportunity-row ${actionTone(item.type)} priority-${item.priority}`} key={item.key}>
              <div className="opportunity-row-main">
                <div className="opportunity-row-title">
                  <span className={`badge ${item.priority === "critica" ? "badge-high" : item.priority === "alta" ? "badge-warning" : "badge-neutral"}`}>{priorityLabel(item.priority)}</span>
                  <span className="badge badge-low">{typeLabel(item.type)}</span>
                  {item.startDate && <span className="badge badge-date">Desde {formatDate(item.startDate)}</span>}
                </div>
                <strong>{item.sku} - {item.productName}</strong>
                <small>{item.title}: {item.detail}</small>
                <small>{item.itemId || "-"}{typeof item.stock === "number" ? ` | Stock ${item.stock}` : ""}</small>
              </div>

              <div className="opportunity-row-metrics">
                <div className="mini-stat">
                  <span>Margen</span>
                  <strong className={item.margin === null || item.margin === undefined ? "neutral" : item.margin < 5 ? "negative" : item.margin < 10 ? "warning" : "positive"}>{item.margin === undefined || item.margin === null ? "-" : percent(item.margin)}</strong>
                </div>
                <div className="mini-stat">
                  <span>Venta 7d</span>
                  <strong>{item.units7 ?? 0} u.</strong>
                </div>
                <div className="mini-stat">
                  <span>Venta 30d</span>
                  <strong>{item.units30 ?? 0} u.</strong>
                </div>
                <div className="mini-stat">
                  <span>Precio / aporte</span>
                  <strong>{moneyWithCents(item.salePrice || item.buyerPrice || null)}{item.meliAmount ? ` · ML ${moneyWithCents(item.meliAmount)}` : ""}</strong>
                </div>
              </div>

              <Link className="button opportunity-open-button" href={item.href}>
                Abrir
                <ChevronRight aria-hidden="true" />
              </Link>
            </article>
          ))}

          {loading && !filteredActions.length && (
            <>
              <div className="skeleton skeleton-action" />
              <div className="skeleton skeleton-action" />
              <div className="skeleton skeleton-action" />
            </>
          )}
          {!loading && !filteredActions.length && <div className="empty-state">No hay acciones para los filtros actuales.</div>}
        </div>
      </section>

      <section className="dashboard-next-cases">
        <article className="card dashboard-next-card">
          <PackageX aria-hidden="true" />
          <strong>Stock</strong>
          <span>Pausadas con stock, stock quieto y riesgo de quiebre.</span>
        </article>
        <article className="card dashboard-next-card">
          <BadgePercent aria-hidden="true" />
          <strong>Promos</strong>
          <span>Sin promo activa, oportunidades rentables y promos futuras.</span>
        </article>
        <article className="card dashboard-next-card">
          <TrendingDown aria-hidden="true" />
          <strong>Rentabilidad</strong>
          <span>Margen bajo, margen peligroso y ventas que escalan poco margen.</span>
        </article>
        <article className="card dashboard-next-card">
          <TrendingUp aria-hidden="true" />
          <strong>Rotacion</strong>
          <span>Margen alto sin ventas y productos para empujar.</span>
        </article>
        <article className="card dashboard-next-card">
          <BarChart3 aria-hidden="true" />
          <strong>Datos</strong>
          <span>Sync viejo, costos faltantes y calculos incompletos.</span>
        </article>
      </section>
    </main>
  );
}
