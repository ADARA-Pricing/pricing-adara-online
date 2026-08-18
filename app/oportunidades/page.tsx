"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Search, Target } from "lucide-react";
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

type OpportunityType = "review" | "activate" | "future" | "missing_promo" | "data_issue";
type OpportunityPriority = "alta" | "media" | "baja";

type OpportunityAction = {
  key: string;
  type: OpportunityType;
  priority: OpportunityPriority;
  sku: string;
  productName: string;
  itemId?: string | null;
  installments?: string;
  title: string;
  detail: string;
  margin?: number | null;
  buyerPrice?: number | null;
  salePrice?: number | null;
  currentPrice?: number | null;
  meliAmount?: number | null;
  meliRate?: number | null;
  startDate?: string | null;
  href: string;
};

function nowIso() {
  return new Date().toISOString();
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(value));
}

function daysSince(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
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

function isScheduledOpportunity(item: MercadoLibrePromotionOpportunity, currentIso = nowIso()) {
  return isFutureOpportunity(item, currentIso);
}

function hasMeliContribution(item: MercadoLibrePromotionOpportunity, meliAmount?: number | null) {
  return Number(meliAmount || 0) > 0 || Number(item.meli_amount || 0) > 0 || Number(item.meli_percentage || 0) > 0;
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

function priorityForMargin(type: OpportunityType, margin?: number | null, meliAmount = 0): OpportunityPriority {
  if (type === "review") return "alta";
  if (type === "data_issue") return "media";
  if (Number(margin || 0) >= 10 || Number(meliAmount || 0) >= 10000) return "alta";
  if (Number(margin || 0) >= 5) return "media";
  return "baja";
}

function typeLabel(type: OpportunityType) {
  if (type === "review") return "Revisar activa";
  if (type === "activate") return "Activar promo";
  if (type === "future") return "Futura";
  if (type === "missing_promo") return "Sin promo";
  return "Datos";
}

function typeBadgeClass(type: OpportunityType) {
  if (type === "review") return "badge-high";
  if (type === "future") return "badge-warning";
  if (type === "missing_promo" || type === "data_issue") return "badge-neutral";
  return "badge-low";
}

function priorityBadgeClass(priority: OpportunityPriority) {
  if (priority === "alta") return "badge-high";
  if (priority === "media") return "badge-warning";
  return "badge-low";
}

function marginTone(margin?: number | null) {
  if (margin === undefined || margin === null) return "neutral";
  if (margin < 5) return "negative";
  if (margin < 10) return "warning";
  return "positive";
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

const ML_FIXED_FEE_PRICE_LIMIT = 30000;

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

export default function OpportunitiesPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [opportunities, setOpportunities] = useState<MercadoLibrePromotionOpportunity[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | OpportunityType>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | OpportunityPriority>("all");
  const [query, setQuery] = useState("");
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
      installmentsResponse,
      categoryFeesResponse,
      taxesResponse,
      marginsResponse,
    ] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active").order("sku", { ascending: true }),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true).eq("meli_status", "active"),
      supabase.from("mercadolibre_installment_fees").select("*").eq("active", true).order("code", { ascending: true }),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").single(),
      supabase.from("product_channel_margins").select("*"),
    ]);

    const allOpportunities: MercadoLibrePromotionOpportunity[] = [];
    let opportunitiesError: string | null = null;
    for (let from = 0; ; from += 1000) {
      const to = from + 999;
      const response = await supabase
        .from("mercadolibre_promotion_opportunities")
        .select("*")
        .order("meli_amount", { ascending: false })
        .range(from, to);
      if (response.error) {
        opportunitiesError = response.error.message;
        break;
      }
      const rows = (response.data || []) as MercadoLibrePromotionOpportunity[];
      allOpportunities.push(...rows);
      if (rows.length < 1000) break;
    }

    setLoading(false);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);
    if (publicationsResponse.error) setError(publicationsResponse.error.message);
    else setPublications((publicationsResponse.data || []) as MercadoLibreShippingCost[]);
    if (opportunitiesError) setError(opportunitiesError);
    else setOpportunities(allOpportunities);
    if (installmentsResponse.error) setError(installmentsResponse.error.message);
    else setInstallments(((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]).filter((item) => item.code !== "MC"));
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
    if (
      fixedFeeAmount > 0 ||
      fixedFeeFromPromotion <= 0 ||
      priceForFixedFee <= 0 ||
      priceForFixedFee > ML_FIXED_FEE_PRICE_LIMIT
    ) {
      return publication;
    }

    return {
      ...publication,
      fixed_fee_amount: fixedFeeFromPromotion,
    };
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
    if (
      priceForFixedFee > 0 &&
      priceForFixedFee <= ML_FIXED_FEE_PRICE_LIMIT &&
      Number(publication.fixed_fee_amount || 0) <= 0 &&
      Number(fixedFeeOverride || 0) <= 0
    ) {
      return null;
    }
    const option = normalizeOption(optionForPublication(publication));
    const marginPublication = publicationForMargin(publication, salePrice || buyerPrice, fixedFeeOverride);
    if (
      option.applies_shipping &&
      (marginPublication.free_shipping || marginPublication.meli_free_shipping) &&
      !Number(marginPublication.shipping_cost_amount || 0)
    ) {
      return null;
    }
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

  const actions = useMemo<OpportunityAction[]>(() => {
    const currentIso = nowIso();
    const activePublications = publications.filter((publication) => Boolean(productsById.get(publication.product_id)));
    const publicationsByItemId = new Map(activePublications.map((publication) => [publication.meli_item_id, publication]));
    const rows: OpportunityAction[] = [];

    activePublications.forEach((publication) => {
      const product = productsById.get(publication.product_id);
      if (!product) return;
      const sku = product.sku;
      const name = product.name;
      const installments = installmentLabel(publicationInstallments(publication));
      const itemId = publication.meli_item_id || "";

      if (!Number(product.cost_without_vat || 0)) {
        rows.push({
          key: `data-cost-${product.id}`,
          type: "data_issue",
          priority: "media",
          sku,
          productName: name,
          title: "Producto sin costo",
          detail: "Cargar costo para poder calcular margen real.",
          href: "/productos",
        });
      }
      if (!Number(publication.meli_price || 0)) {
        rows.push({
          key: `data-price-${publication.id || itemId}`,
          type: "data_issue",
          priority: "media",
          sku,
          productName: name,
          itemId,
          installments,
          title: "Publicacion sin precio ML",
          detail: "Sin precio vigente no se puede comparar contra promos.",
          href: "/productos",
        });
      }
      if (publication.free_shipping && !Number(publication.shipping_cost_amount || 0)) {
        rows.push({
          key: `data-shipping-${publication.id || itemId}`,
          type: "data_issue",
          priority: "media",
          sku,
          productName: name,
          itemId,
          installments,
          title: "Envio gratis sin costo",
          detail: "Revisar sincronizacion o cargar costo de envio para esta publicacion.",
          href: "/productos",
        });
      }
      if ((daysSince(publication.meli_last_sync_at || publication.updated_at || publication.created_at) ?? 99) > 1) {
        rows.push({
          key: `data-sync-${publication.id || itemId}`,
          type: "data_issue",
          priority: "baja",
          sku,
          productName: name,
          itemId,
          installments,
          title: "Datos ML viejos",
          detail: "Conviene sincronizar antes de decidir precio o promo.",
          href: "/configuracion/mercadolibre",
        });
      }

      if (Number(publication.meli_promo_price || 0) > 0) {
        const buyerPrice = Number(publication.meli_promo_price || 0);
        const meliAmount = meliContributionAmount(
          buyerPrice,
          publication.meli_promo_meli_amount,
          publication.meli_promo_meli_rate,
          publication.meli_original_price || publication.meli_price,
          publication.meli_promo_seller_rate,
        );
        const salePrice = effectiveSalePrice(
          buyerPrice,
          meliAmount,
          publication.meli_promo_meli_rate,
          publication.meli_original_price || publication.meli_price,
          publication.meli_promo_seller_rate,
        );
        const margin = marginForPublication(product, publication, salePrice, buyerPrice);
        if (margin !== null && margin < 5) {
          rows.push({
            key: `review-${publication.id || itemId}`,
            type: "review",
            priority: "alta",
            sku,
            productName: name,
            itemId,
            installments,
            title: "Promo vigente con margen bajo",
            detail: publication.meli_promo_name || "Promo vigente",
            margin,
            buyerPrice,
            salePrice,
            currentPrice: Number(publication.meli_price || 0) || null,
            meliAmount,
            meliRate: Number(publication.meli_promo_meli_rate || 0),
            href: "/promociones-meli",
          });
        }
      }
    });

    opportunities.forEach((opportunity) => {
      if (isActiveOpportunity(opportunity)) return;
      const publication = publicationsByItemId.get(opportunity.meli_item_id);
      if (!publication) return;
      const product = productsById.get(publication.product_id);
      if (!product) return;
      const buyerPrice = Number(opportunity.promo_price || 0) || null;
      const meliAmount = meliContributionAmount(
        buyerPrice,
        opportunity.meli_amount,
        opportunity.meli_percentage,
        opportunity.original_price || publication.meli_price,
        opportunity.seller_percentage,
      );
      const salePrice = effectiveSalePrice(
        buyerPrice,
        meliAmount,
        opportunity.meli_percentage,
        opportunity.original_price || publication.meli_price,
        opportunity.seller_percentage,
      );
      const margin = marginForPublication(product, publication, salePrice, buyerPrice, promotionFixedFeeAmount(opportunity));
      if (margin === null || margin < 5) return;
      const future = isScheduledOpportunity(opportunity, currentIso);
      const type: OpportunityType = future ? "future" : "activate";
      if (type === "activate" && !hasMeliContribution(opportunity, meliAmount)) return;
      rows.push({
        key: `${type}-${opportunity.offer_id || opportunity.promotion_id}-${opportunity.meli_item_id}`,
        type,
        priority: priorityForMargin(type, margin, meliAmount),
        sku: product.sku,
        productName: product.name,
        itemId: opportunity.meli_item_id,
        installments: installmentLabel(publicationInstallments(publication)),
        title: future ? "Promo futura rentable" : "Promo rentable para activar",
        detail: opportunity.promotion_name || opportunity.promotion_id,
        margin,
        buyerPrice,
        salePrice,
        currentPrice: Number(publication.meli_price || 0) || null,
        meliAmount,
        meliRate: Number(opportunity.meli_percentage || 0),
        startDate: opportunity.start_date || null,
        href: future ? "/asesoria-360" : "/promociones-meli",
      });
    });

    const activePromoKeys = new Set<string>();
    activePublications.forEach((publication) => {
      const product = productsById.get(publication.product_id);
      if (!product) return;
      if (!Number(publication.meli_promo_price || 0)) return;
      activePromoKeys.add(`${product.sku}|${publicationInstallments(publication) || 1}`);
    });
    opportunities.filter(isActiveOpportunity).forEach((opportunity) => {
      const publication = publicationsByItemId.get(opportunity.meli_item_id);
      const product = publication ? productsById.get(publication.product_id) : null;
      if (!publication || !product) return;
      activePromoKeys.add(`${product.sku}|${publicationInstallments(publication) || 1}`);
    });

    activePublications.forEach((publication) => {
      const product = productsById.get(publication.product_id);
      if (!product) return;
      const count = publicationInstallments(publication) || 1;
      if (activePromoKeys.has(`${product.sku}|${count}`)) return;
      rows.push({
        key: `missing-${publication.id || publication.meli_item_id}`,
        type: "missing_promo",
        priority: "baja",
        sku: product.sku,
        productName: product.name,
        itemId: publication.meli_item_id,
        installments: installmentLabel(count),
        title: "Sin promo vigente en esta cuota",
        detail: "Puede servir para Asesoria 360 o para buscar oportunidad futura.",
        currentPrice: Number(publication.meli_price || 0) || null,
        href: "/asesoria-360",
      });
    });

    const priorityOrder: Record<OpportunityPriority, number> = { alta: 1, media: 2, baja: 3 };
    const typeOrder: Record<OpportunityType, number> = { review: 1, activate: 2, future: 3, missing_promo: 4, data_issue: 5 };
    return rows.sort((a, b) => {
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) return priorityOrder[a.priority] - priorityOrder[b.priority];
      if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
      return Number(b.margin || 0) - Number(a.margin || 0);
    });
  }, [productsById, publications, opportunities, pricingOptions, categoryFees, taxes, marginSettings]);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter((item) => {
      const matchesType = typeFilter === "all" || item.type === typeFilter;
      const matchesPriority = priorityFilter === "all" || item.priority === priorityFilter;
      const text = `${item.sku} ${item.productName} ${item.itemId || ""} ${item.title} ${item.detail}`.toLowerCase();
      return matchesType && matchesPriority && (!q || text.includes(q));
    });
  }, [actions, typeFilter, priorityFilter, query]);

  const countsByType = useMemo(() => {
    return actions.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {} as Record<OpportunityType, number>);
  }, [actions]);

  return (
    <main className="container wide opportunities-page">
      <PageHero
        title="Centro de Oportunidades"
        description="Bandeja de acciones para promociones, datos incompletos y Asesoria 360."
        icon={<Target aria-hidden="true" />}
        actions={<Link className="button secondary page-back-button" href="/dashboard"><ArrowLeft aria-hidden="true" />Volver al dashboard</Link>}
        onRefresh={loadData}
        refreshLabel={loading ? "Actualizando..." : "Actualizar"}
        refreshDisabled={loading}
      />

      {error && <div className="message error">{error}</div>}

      <section className="opportunity-summary-grid">
        <button className={`kpi-card opportunity-summary ${typeFilter === "all" ? "active" : ""}`} type="button" onClick={() => setTypeFilter("all")}>
          <span className="kpi-label">Total</span>
          <strong className="kpi-value">{actions.length}</strong>
          <small className="kpi-meta">Todas las acciones</small>
        </button>
        {(["review", "activate", "future", "missing_promo", "data_issue"] as OpportunityType[]).map((type) => (
          <button className={`kpi-card opportunity-summary ${type} ${typeFilter === type ? "active" : ""}`} type="button" onClick={() => setTypeFilter(type)} key={type}>
            <span className="kpi-label">{typeLabel(type)}</span>
            <strong className="kpi-value">{countsByType[type] || 0}</strong>
            <small className="kpi-meta">{type === "future" ? "Para mirar fecha" : type === "data_issue" ? "Bloquean calculo" : "Accionable"}</small>
          </button>
        ))}
      </section>

      <section className="card toolbar-card opportunity-toolbar">
        <label className="search-control">
          <Search aria-hidden="true" />
          <input className="form-control search-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, MLA, producto o promo" />
        </label>
        <select className="form-control" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as typeof priorityFilter)}>
          <option value="all">Todas las prioridades</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>
        <select className="form-control" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
          <option value="all">Todos los tipos</option>
          <option value="review">Revisar activa</option>
          <option value="activate">Activar promo</option>
          <option value="future">Futuras</option>
          <option value="missing_promo">Sin promo</option>
          <option value="data_issue">Datos</option>
        </select>
      </section>

      <section className="card opportunity-list-card">
        <div className="opportunity-list-head">
          <div>
            <h2>Acciones</h2>
            <p>{filteredActions.length} resultado(s) segun filtros actuales.</p>
          </div>
        </div>

        <div className="opportunity-action-list">
          {filteredActions.map((item) => (
            <article className={`action-card opportunity-row ${item.type} priority-${item.priority}`} key={item.key}>
              <div className="opportunity-row-main">
                <div className="opportunity-row-title">
                  <span className={`badge ${typeBadgeClass(item.type)}`}>{typeLabel(item.type)}</span>
                  <span className={`badge ${priorityBadgeClass(item.priority)}`}>{item.priority}</span>
                  {item.startDate && <span className="badge badge-date">Desde {formatDate(item.startDate)}</span>}
                </div>
                <strong>{item.sku} - {item.productName}</strong>
                <small>{item.title}: {item.detail}</small>
                <small>{item.itemId || "-"}{item.installments ? ` | ${item.installments}` : ""}</small>
              </div>

              <div className="opportunity-row-metrics">
                <div className="mini-stat">
                  <span>Margen</span>
                  <strong className={`mini-stat-value ${marginTone(item.margin)}`}>{item.margin === undefined || item.margin === null ? "-" : percent(item.margin)}</strong>
                </div>
                <div className="mini-stat">
                  <span>Venta</span>
                  <strong>{moneyWithCents(item.salePrice || item.currentPrice || null)}</strong>
                </div>
                <div className="mini-stat">
                  <span>Comprador</span>
                  <strong>{moneyWithCents(item.buyerPrice || item.currentPrice || null)}</strong>
                </div>
                <div className="mini-stat">
                  <span>Aporte ML</span>
                  <strong>{moneyWithCents(item.meliAmount || 0)} - {percent(item.meliRate || 0)}</strong>
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
          {!loading && !filteredActions.length && <div className="empty-state">No hay oportunidades para los filtros elegidos.</div>}
        </div>
      </section>
    </main>
  );
}
