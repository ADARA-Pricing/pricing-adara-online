"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

type DashboardOpportunity = {
  key: string;
  kind: "activate" | "future" | "review";
  sku: string;
  productName: string;
  itemId: string;
  installments: string;
  promotionName: string;
  margin: number | null;
  buyerPrice: number | null;
  meliAmount: number;
  meliRate: number;
  startDate?: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(value));
}

function publicationInstallments(publication: MercadoLibreShippingCost) {
  const text = `${publication.meli_installments_text || ""} ${publication.notes || ""}`.toLowerCase();
  const match = text.match(/(\d+)\s*cuota/);
  if (match) return Number(match[1]);
  if (text.includes("sin cuotas") || text.includes("1 pago")) return 1;
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

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [opportunities, setOpportunities] = useState<MercadoLibrePromotionOpportunity[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>([]);
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
      supabase.from("products").select("*").eq("status", "active").order("sku", { ascending: true }),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true).eq("meli_status", "active"),
      supabase.from("mercadolibre_promotion_opportunities").select("*").order("meli_amount", { ascending: false }).limit(1000),
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

  const activeProductsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const productsBySku = useMemo(() => new Map(products.map((product) => [product.sku, product])), [products]);

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

  function marginForPublication(product: Product, publication: MercadoLibreShippingCost, salePrice?: number | null) {
    if (!salePrice || salePrice <= 0) return null;
    const option = normalizeOption(optionForPublication(publication));
    const setting = channelSetting(product.id, option.code);
    const result = calculatePriceSummary(
      product,
      option,
      option.applies_marketplace_fee ? categoryFeeForProduct(product) : null,
      taxes,
      option.applies_shipping ? publication : null,
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

  const dashboardData = useMemo(() => {
    const currentIso = nowIso();
    const activePublications = publications.filter((publication) => Boolean(activeProductsById.get(publication.product_id)));
    const publicationsByItemId = new Map(activePublications.map((publication) => [publication.meli_item_id, publication]));
    const activePromoPublications = activePublications.filter((publication) => Number(publication.meli_promo_price || 0) > 0);
    const latestSync = activePublications
      .map((publication) => publication.meli_last_sync_at || publication.updated_at || publication.created_at || null)
      .filter(Boolean)
      .sort()
      .at(-1) || null;

    const lowMarginActive = activePromoPublications
      .map((publication): DashboardOpportunity | null => {
        const product = activeProductsById.get(publication.product_id);
        if (!product) return null;
        const margin = marginForPublication(product, publication, Number(publication.meli_promo_price || 0));
        return {
          key: `review-${publication.meli_item_id}`,
          kind: "review" as const,
          sku: product.sku,
          productName: product.name,
          itemId: publication.meli_item_id || "",
          installments: installmentLabel(publicationInstallments(publication)),
          promotionName: publication.meli_promo_name || "Promo vigente",
          margin,
          buyerPrice: Number(publication.meli_promo_price || 0) || null,
          meliAmount: Number(publication.meli_promo_meli_amount || 0),
          meliRate: Number(publication.meli_promo_meli_rate || 0),
        };
      })
      .filter((item): item is DashboardOpportunity => Boolean(item && item.margin !== null && item.margin < 5))
      .sort((a, b) => Number(a.margin || 0) - Number(b.margin || 0));

    const opportunityRows = opportunities
      .map((opportunity): DashboardOpportunity | null => {
        const publication = publicationsByItemId.get(opportunity.meli_item_id);
        if (!publication) return null;
        const product = activeProductsById.get(publication.product_id);
        if (!product) return null;
        const margin = marginForPublication(product, publication, Number(opportunity.promo_price || 0));
        const future = isFutureOpportunity(opportunity, currentIso);
        return {
          key: `${future ? "future" : "activate"}-${opportunity.offer_id || opportunity.promotion_id}-${opportunity.meli_item_id}`,
          kind: future ? "future" as const : "activate" as const,
          sku: product.sku,
          productName: product.name,
          itemId: opportunity.meli_item_id,
          installments: installmentLabel(publicationInstallments(publication)),
          promotionName: opportunity.promotion_name || opportunity.promotion_id,
          margin,
          buyerPrice: Number(opportunity.promo_price || 0) || null,
          meliAmount: Number(opportunity.meli_amount || 0),
          meliRate: Number(opportunity.meli_percentage || 0),
          startDate: opportunity.start_date || null,
        };
      })
      .filter((item): item is DashboardOpportunity => Boolean(item && item.margin !== null && item.margin >= 5));

    const futureOpportunities = opportunityRows
      .filter((item) => item.kind === "future")
      .sort((a, b) => b.meliAmount - a.meliAmount);
    const activationOpportunities = opportunityRows
      .filter((item) => item.kind === "activate")
      .sort((a, b) => Number(b.margin || 0) - Number(a.margin || 0));

    const skuInstallmentPromos = new Map<string, Set<number>>();
    activePromoPublications.forEach((publication) => {
      const product = activeProductsById.get(publication.product_id);
      if (!product) return;
      const count = publicationInstallments(publication) || 1;
      const current = skuInstallmentPromos.get(product.sku) || new Set<number>();
      current.add(count);
      skuInstallmentPromos.set(product.sku, current);
    });
    opportunities.filter(isActiveOpportunity).forEach((opportunity) => {
      const publication = publicationsByItemId.get(opportunity.meli_item_id);
      const product = publication ? activeProductsById.get(publication.product_id) : null;
      if (!publication || !product) return;
      const count = publicationInstallments(publication) || 1;
      const current = skuInstallmentPromos.get(product.sku) || new Set<number>();
      current.add(count);
      skuInstallmentPromos.set(product.sku, current);
    });

    const missingPromoSkus = activePublications.reduce((set, publication) => {
      const product = activeProductsById.get(publication.product_id);
      if (!product) return set;
      const count = publicationInstallments(publication) || 1;
      if (!skuInstallmentPromos.get(product.sku)?.has(count)) set.add(product.sku);
      return set;
    }, new Set<string>());

    return {
      activePublications,
      activePromoPublications,
      latestSync,
      lowMarginActive,
      futureOpportunities,
      activationOpportunities,
      missingPromoSkus,
      topMeliContributions: [...opportunityRows].sort((a, b) => b.meliAmount - a.meliAmount).slice(0, 6),
    };
  }, [activeProductsById, publications, opportunities, pricingOptions, categoryFees, taxes, marginSettings]);

  return (
    <main className="container wide dashboard-page">
      <PageHero
        title="Dashboard Ejecutivo"
        description="Resumen operativo de MercadoLibre, promociones y rentabilidad."
        onRefresh={loadData}
        refreshLabel={loading ? "Actualizando..." : "Actualizar"}
        refreshDisabled={loading}
      />

      {error && <div className="message error">{error}</div>}

      <section className="dashboard-kpi-grid">
        <article className="card dashboard-kpi">
          <span>Productos activos</span>
          <strong>{products.length}</strong>
          <small>SKUs disponibles para operar</small>
        </article>
        <article className="card dashboard-kpi">
          <span>Publicaciones ML</span>
          <strong>{dashboardData.activePublications.length}</strong>
          <small>Activas y sincronizadas</small>
        </article>
        <article className="card dashboard-kpi">
          <span>Promos vigentes</span>
          <strong>{dashboardData.activePromoPublications.length}</strong>
          <small>Con precio promo detectado</small>
        </article>
        <article className="card dashboard-kpi warning">
          <span>Revisar margen</span>
          <strong>{dashboardData.lowMarginActive.length}</strong>
          <small>Promos vigentes bajo 5%</small>
        </article>
        <article className="card dashboard-kpi success">
          <span>Para activar</span>
          <strong>{dashboardData.activationOpportunities.length}</strong>
          <small>Oportunidades sobre 5%</small>
        </article>
        <article className="card dashboard-kpi info">
          <span>Futuras</span>
          <strong>{dashboardData.futureOpportunities.length}</strong>
          <small>Empiezan mas adelante</small>
        </article>
        <article className="card dashboard-kpi">
          <span>SKUs sin promo</span>
          <strong>{dashboardData.missingPromoSkus.size}</strong>
          <small>Alguna cuota sin promo vigente</small>
        </article>
        <article className="card dashboard-kpi">
          <span>Ultima sincro</span>
          <strong>{formatDateTime(dashboardData.latestSync)}</strong>
          <small>Dato mas reciente ML</small>
        </article>
      </section>

      <section className="dashboard-main-grid">
        <article className="card dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <h2>Acciones recomendadas</h2>
              <p>Las mejores oportunidades detectadas con datos actuales.</p>
            </div>
            <Link className="button ghost" href="/promociones-meli">Ver promos</Link>
          </div>
          <div className="dashboard-action-list">
            {[...dashboardData.lowMarginActive.slice(0, 3), ...dashboardData.activationOpportunities.slice(0, 5), ...dashboardData.futureOpportunities.slice(0, 4)].slice(0, 10).map((item) => (
              <div className={`dashboard-action ${item.kind}`} key={item.key}>
                <div>
                  <strong>{item.sku}</strong>
                  <span>{item.productName}</span>
                  <small>{item.promotionName} | {item.installments} | {item.itemId}</small>
                </div>
                <div className="dashboard-action-metrics">
                  <span>{item.margin === null ? "-" : percent(item.margin)}</span>
                  <small>{moneyWithCents(item.buyerPrice)}</small>
                  {item.kind === "future" && <small>Desde {formatDate(item.startDate)}</small>}
                </div>
              </div>
            ))}
            {!dashboardData.lowMarginActive.length && !dashboardData.activationOpportunities.length && !dashboardData.futureOpportunities.length && (
              <div className="dashboard-empty">No hay acciones urgentes con la informacion sincronizada.</div>
            )}
          </div>
        </article>

        <aside className="dashboard-side">
          <article className="card dashboard-panel">
            <div className="dashboard-panel-head">
              <div>
                <h2>Top aporte ML</h2>
                <p>Promos con mayor aporte absoluto.</p>
              </div>
            </div>
            <div className="dashboard-mini-list">
              {dashboardData.topMeliContributions.map((item) => (
                <div className="dashboard-mini-row" key={item.key}>
                  <div>
                    <strong>{item.sku}</strong>
                    <small>{item.promotionName}</small>
                  </div>
                  <span>{moneyWithCents(item.meliAmount)} · {percent(item.meliRate)}</span>
                </div>
              ))}
              {!dashboardData.topMeliContributions.length && <div className="dashboard-empty">Sin aportes ML detectados.</div>}
            </div>
          </article>

          <article className="card dashboard-panel">
            <div className="dashboard-panel-head">
              <div>
                <h2>Accesos rapidos</h2>
                <p>Ir directo a operar.</p>
              </div>
            </div>
            <div className="dashboard-shortcuts">
              <Link className="button" href="/promociones-meli">Promociones Meli</Link>
              <Link className="button ghost" href="/asesoria-360">Asesoria 360</Link>
              <Link className="button ghost" href="/productos">Productos</Link>
              <Link className="button ghost" href="/configuracion/mercadolibre">Conexion ML</Link>
            </div>
          </article>
        </aside>
      </section>
    </main>
  );
}
