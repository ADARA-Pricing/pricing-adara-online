"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import {
  calculatePriceSummary,
  defaultTaxSettings,
  mercadoLibreClassicOption,
  money,
  moneyWithCents,
  normalizeOption,
  percent,
} from "@/lib/pricing";
import type {
  MercadoLibreCategoryFee,
  MercadoLibreInstallmentFee,
  MercadoLibrePriceOption,
  MercadoLibreShippingCost,
  Product,
  ProductChannelMargin,
  TaxSettings,
} from "@/lib/types";

type ProfitStatus = "ok" | "warning" | "danger" | "missing";

type ProfitRow = {
  key: string;
  product: Product;
  shipping: MercadoLibreShippingCost;
  option: MercadoLibrePriceOption;
  listPrice: number | null;
  buyerPrice: number | null;
  sellerEffectivePrice: number | null;
  sellerDiscountAmount: number | null;
  promoName: string | null;
  suggestedPrice: number | null;
  differenceAmount: number | null;
  differenceRate: number | null;
  currentMargin: number | null;
  targetMargin: number;
  netProfit: number | null;
  suggestedNetProfit: number | null;
  status: ProfitStatus;
  action: string;
  issue: string | null;
};

type ProfitGroup = {
  key: string;
  product: Product;
  rows: ProfitRow[];
  status: ProfitStatus;
  action: string;
  bestMargin: number | null;
  worstMargin: number | null;
  totalNetProfit: number;
  totalPotential: number;
  promoCount: number;
};

function rawInstallmentLabel(shipping?: MercadoLibreShippingCost | null) {
  if (!shipping) return "Sin dato ML";
  if (shipping.meli_installments_text) return shipping.meli_installments_text;

  const saleTerms = Array.isArray(shipping.meli_sale_terms) ? shipping.meli_sale_terms : [];
  const searchable = [
    shipping.meli_listing_type_id,
    shipping.meli_listing_type_name,
    ...(Array.isArray(shipping.meli_tags) ? shipping.meli_tags : []),
    ...saleTerms.flatMap((term) => {
      const value = term as { id?: string; name?: string; value_name?: string; value_id?: string };
      return [value?.id, value?.name, value?.value_name, value?.value_id];
    }),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const match = searchable.match(/(\d{1,2})\s*(x|cuotas?|installments?)/i);
  if (match?.[1]) return `${match[1]} cuotas`;
  if (searchable.includes("gold_pro") || searchable.includes("premium")) return "Premium / cuotas";
  if (searchable.includes("gold_special") || searchable.includes("clasica")) return "Clasica / 1 pago";
  return "Sin dato ML";
}

function installmentNumberFromLabel(label: string) {
  const normalized = label.toLowerCase();
  const match = normalized.match(/(\d{1,2})\s*cuotas?/i);
  if (match?.[1]) return Number(match[1]);
  if (normalized.includes("1 pago") || normalized.includes("clasica")) return 1;
  return null;
}

function sortedDistinctPrices(shippings: MercadoLibreShippingCost[]) {
  return Array.from(
    new Set(
      shippings
        .map((item) => Math.round(Number(item.meli_price || 0)))
        .filter((price) => price > 0),
    ),
  ).sort((a, b) => a - b);
}

function inferredInstallmentNumber(
  shipping: MercadoLibreShippingCost,
  shippings: MercadoLibreShippingCost[],
) {
  const explicit = installmentNumberFromLabel(rawInstallmentLabel(shipping));
  if (explicit) return explicit;

  const price = Math.round(Number(shipping.meli_price || 0));
  if (!price) return null;

  const prices = sortedDistinctPrices(shippings);
  const index = prices.findIndex((item) => item === price);
  const inferredByOrder = [1, 3, 6, 9, 12];
  return index >= 0 ? inferredByOrder[index] || null : null;
}

function installmentLabel(shipping: MercadoLibreShippingCost, shippings: MercadoLibreShippingCost[]) {
  const rawLabel = rawInstallmentLabel(shipping);
  if (rawLabel !== "Premium / cuotas" && rawLabel !== "Sin dato ML") return rawLabel;

  const inferred = inferredInstallmentNumber(shipping, shippings);
  if (inferred) return inferred === 1 ? "Clasica / 1 pago" : `${inferred} cuotas`;

  return rawLabel;
}

function sortPricingOptions(options: MercadoLibrePriceOption[]) {
  const fixedOrder: Record<string, number> = {
    MC: 1,
    MP3: 2,
    MP6: 3,
    MP9: 4,
    MP12: 5,
  };

  return [...options].sort((a, b) => {
    const orderA = fixedOrder[a.code] ?? 1000;
    const orderB = fixedOrder[b.code] ?? 1000;
    if (orderA !== orderB) return orderA - orderB;
    return a.code.localeCompare(b.code, "es");
  });
}

function findOptionForPublication(
  shipping: MercadoLibreShippingCost,
  productShippings: MercadoLibreShippingCost[],
  options: MercadoLibrePriceOption[],
) {
  const installments = inferredInstallmentNumber(shipping, productShippings);
  if (!installments || installments === 1) {
    return options.find((option) => option.code === "MC") || mercadoLibreClassicOption();
  }

  return (
    options.find((option) => Number(option.installment_count || 0) === installments) ||
    options.find((option) => option.code === `MP${installments}`) ||
    options.find((option) => option.code === "MC") ||
    mercadoLibreClassicOption()
  );
}

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

function statusLabel(status: ProfitStatus) {
  if (status === "ok") return "OK";
  if (status === "warning") return "Revisar";
  if (status === "danger") return "Perdida";
  return "Datos faltantes";
}

function meliStatusLabel(status?: string | null) {
  if (!status) return "-";
  const labels: Record<string, string> = {
    active: "Activa",
    paused: "Pausada",
    closed: "Cerrada",
    under_review: "En revision",
  };
  return labels[status] || status;
}

function effectiveMeliSalePrice(shipping: MercadoLibreShippingCost) {
  const buyerPrice = Number(shipping.meli_promo_price || shipping.meli_price || 0) || null;
  const listPrice = Number(shipping.meli_original_price || shipping.meli_price || 0) || null;
  if (!buyerPrice) return null;
  if (!shipping.meli_promo_price || !listPrice || buyerPrice >= listPrice) return buyerPrice;

  const meliFundedAmount = Number(shipping.meli_promo_meli_amount || 0);
  if (meliFundedAmount > 0) return buyerPrice + meliFundedAmount;

  const meliFundedRate = Number(shipping.meli_promo_meli_rate || 0);
  if (meliFundedRate > 0) return buyerPrice + (listPrice * meliFundedRate) / 100;

  return buyerPrice;
}

export default function RentabilidadMeliPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [shippingCosts, setShippingCosts] = useState<MercadoLibreShippingCost[]>([]);
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [expandedSkus, setExpandedSkus] = useState<Record<string, boolean>>({});
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
      installmentsResponse,
      categoryFeesResponse,
      taxesResponse,
      shippingResponse,
      marginsResponse,
    ] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active").order("name", { ascending: true }),
      supabase.from("mercadolibre_installment_fees").select("*").eq("active", true).order("code", { ascending: true }),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").single(),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true).order("updated_at", { ascending: false }),
      supabase.from("product_channel_margins").select("*"),
    ]);

    setLoading(false);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);

    if (installmentsResponse.error) setError(installmentsResponse.error.message);
    else setInstallments(((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]).filter((item) => item.code !== "MC"));

    if (categoryFeesResponse.error) setError(categoryFeesResponse.error.message);
    else setCategoryFees((categoryFeesResponse.data || []) as MercadoLibreCategoryFee[]);

    if (taxesResponse.error) setError(taxesResponse.error.message);
    else setTaxes((taxesResponse.data || defaultTaxSettings()) as TaxSettings);

    if (shippingResponse.error) setError(shippingResponse.error.message);
    else setShippingCosts((shippingResponse.data || []) as MercadoLibreShippingCost[]);

    if (marginsResponse.error) setError(marginsResponse.error.message);
    else setMarginSettings((marginsResponse.data || []) as ProductChannelMargin[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const rows = useMemo<ProfitRow[]>(() => {
    const productsById = new Map(products.map((product) => [product.id, product]));
    const productsBySku = new Map(products.map((product) => [product.sku, product]));

    return shippingCosts
      .filter((shipping) => Boolean(shipping.meli_item_id))
      .map((shipping) => {
        const product =
          productsById.get(shipping.product_id) ||
          (shipping.sku ? productsBySku.get(shipping.sku) : undefined);
        if (!product) return null;

        const productShippings = shippingCosts.filter(
          (item) => item.product_id === product.id || item.sku === product.sku,
        );
        const option = normalizeOption(findOptionForPublication(shipping, productShippings, pricingOptions));
        const setting = marginSettings.find(
          (item) => item.product_id === product.id && item.channel_code === option.code,
        );
        const categoryFee = categoryFees.find(
          (item) => item.category?.toLowerCase() === (product.category || "").toLowerCase(),
        );
        const targetMargin = Number(setting?.desired_margin_rate ?? 5);
        const listPrice = Number(shipping.meli_original_price || shipping.meli_price || 0) > 0
          ? Number(shipping.meli_original_price || shipping.meli_price)
          : null;
        const buyerPrice = Number(shipping.meli_promo_price || shipping.meli_price || 0) > 0
          ? Number(shipping.meli_promo_price || shipping.meli_price)
          : null;
        const sellerEffectivePrice = effectiveMeliSalePrice(shipping);
        const sellerDiscountAmount =
          Number(shipping.meli_promo_seller_amount || 0) ||
          (listPrice && buyerPrice && buyerPrice < listPrice
            ? Math.max(listPrice - (sellerEffectivePrice || buyerPrice), 0)
            : null);

        const commonTarget = {
          structureAmount: Number(setting?.structure_amount || 0),
          manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
          salesCommissionRate: Number(setting?.sales_commission_rate || 0),
          saleAppliesVat: setting?.sale_applies_vat ?? option.applies_vat,
          costVatRate: Number(setting?.cost_vat_rate || 0),
          roundTo: 100,
          roundingMode: "nearest" as const,
        };

        const suggested = calculatePriceSummary(
          product,
          option,
          option.applies_marketplace_fee ? categoryFee : null,
          taxes,
          option.applies_shipping ? shipping : null,
          {
            ...commonTarget,
            desiredMarginRate: targetMargin,
            desiredNetProfit: setting?.desired_net_profit ?? null,
          },
        );

        const current = sellerEffectivePrice
          ? calculatePriceSummary(
              product,
              option,
              option.applies_marketplace_fee ? categoryFee : null,
              taxes,
              option.applies_shipping ? shipping : null,
              {
                ...commonTarget,
                salePrice: sellerEffectivePrice,
                desiredMarginRate: targetMargin,
                desiredNetProfit: null,
              },
            )
          : null;

        const suggestedPrice = suggested.valid ? Number(suggested.roundedPrice || 0) : null;
        const currentMargin = current?.valid ? Number(current.marginOnNetSale || 0) : null;
        const netProfit = current?.valid ? Number(current.netProfit || 0) : null;
        const suggestedNetProfit = suggested.valid ? Number(suggested.netProfit || 0) : null;
        const differenceAmount =
          suggestedPrice !== null && sellerEffectivePrice !== null ? suggestedPrice - sellerEffectivePrice : null;
        const differenceRate =
          differenceAmount !== null && sellerEffectivePrice ? (differenceAmount / sellerEffectivePrice) * 100 : null;

        let status: ProfitStatus = "ok";
        let action = "Mantener";
        let issue: string | null = null;

        if (!sellerEffectivePrice) {
          status = "missing";
          action = "Completar precio ML";
          issue = "La publicacion no tiene precio sincronizado.";
        } else if (!suggested.valid || !current?.valid) {
          status = "missing";
          action = "Revisar datos";
          issue = suggested.error || current?.error || "No se pudo calcular la rentabilidad.";
        } else if (!categoryFee && option.applies_marketplace_fee) {
          status = "missing";
          action = "Completar comision";
          issue = "Falta comision de MercadoLibre para la categoria.";
        } else if (Number(shipping.shipping_cost_amount || 0) <= 0 && option.applies_shipping) {
          status = "missing";
          action = "Completar envio";
          issue = "Falta costo de envio para esta publicacion.";
        } else if ((netProfit ?? 0) < 0 || (currentMargin ?? 0) < 0) {
          status = "danger";
          action = "Pausar o subir precio";
        } else if ((currentMargin ?? 0) + 0.5 < targetMargin) {
          status = "warning";
          action = "Subir precio";
        } else if (differenceRate !== null && differenceRate < -8) {
          status = "warning";
          action = "Validar competitividad";
        }

        return {
          key: `${shipping.id || shipping.meli_item_id}-${product.id || product.sku}`,
          product,
          shipping,
          option,
          listPrice,
          buyerPrice,
          sellerEffectivePrice,
          sellerDiscountAmount,
          promoName: shipping.meli_promo_name || null,
          suggestedPrice,
          differenceAmount,
          differenceRate,
          currentMargin,
          targetMargin,
          netProfit,
          suggestedNetProfit,
          status,
          action,
          issue,
        };
      })
      .filter(Boolean) as ProfitRow[];
  }, [products, shippingCosts, pricingOptions, marginSettings, categoryFees, taxes]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      const searchable = [
        row.product.sku,
        row.product.name,
        row.product.brand,
        row.product.model,
        row.product.category,
        row.shipping.meli_item_id,
        row.shipping.meli_title,
        row.promoName,
        row.option.code,
        row.action,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        (!normalized || searchable.includes(normalized)) &&
        (!statusFilter || row.status === statusFilter) &&
        (!actionFilter || row.action === actionFilter)
      );
    });
  }, [rows, query, statusFilter, actionFilter]);

  const groupedRows = useMemo<ProfitGroup[]>(() => {
    const order: Record<ProfitStatus, number> = { danger: 4, missing: 3, warning: 2, ok: 1 };
    const map = new Map<string, ProfitGroup>();

    filteredRows.forEach((row) => {
      const key = row.product.sku || row.product.id || row.key;
      const current = map.get(key);
      if (!current) {
        map.set(key, {
          key,
          product: row.product,
          rows: [row],
          status: row.status,
          action: row.action,
          bestMargin: row.currentMargin,
          worstMargin: row.currentMargin,
          totalNetProfit: row.netProfit || 0,
          totalPotential: row.differenceAmount && row.differenceAmount > 0 ? row.differenceAmount : 0,
          promoCount: row.shipping.meli_promo_price ? 1 : 0,
        });
        return;
      }

      current.rows.push(row);
      if (order[row.status] > order[current.status]) {
        current.status = row.status;
        current.action = row.action;
      }
      if (row.currentMargin !== null) {
        current.bestMargin = current.bestMargin === null ? row.currentMargin : Math.max(current.bestMargin, row.currentMargin);
        current.worstMargin = current.worstMargin === null ? row.currentMargin : Math.min(current.worstMargin, row.currentMargin);
      }
      current.totalNetProfit += row.netProfit || 0;
      current.totalPotential += row.differenceAmount && row.differenceAmount > 0 ? row.differenceAmount : 0;
      current.promoCount += row.shipping.meli_promo_price ? 1 : 0;
    });

    return Array.from(map.values()).sort((a, b) => {
      const byStatus = order[b.status] - order[a.status];
      if (byStatus) return byStatus;
      return a.product.sku.localeCompare(b.product.sku, "es");
    });
  }, [filteredRows]);

  const metrics = useMemo(() => {
      const total = rows.length;
      const danger = rows.filter((row) => row.status === "danger").length;
      const warning = rows.filter((row) => row.status === "warning").length;
      const missing = rows.filter((row) => row.status === "missing").length;
      const ok = rows.filter((row) => row.status === "ok").length;
      const promos = rows.filter((row) => Boolean(row.shipping.meli_promo_price)).length;
      const potential = rows.reduce((sum, row) => {
      if (row.differenceAmount === null || row.differenceAmount <= 0) return sum;
      return sum + row.differenceAmount;
    }, 0);
    return { total, danger, warning, missing, ok, promos, potential };
  }, [rows]);

  const actions = useMemo(() => Array.from(new Set(rows.map((row) => row.action))).sort(), [rows]);

  function toggleSku(key: string) {
    setExpandedSkus((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <main className="container wide rentabilidad-meli-page">
      <PageHero
        title="Rentabilidad Meli"
        description="Comparacion entre precio publicado en MercadoLibre, precio sugerido y margen real por publicacion."
        onRefresh={loadData}
        icon="$"
      />

      {error && <div className="message error">{error}</div>}

      <section className="rentabilidad-kpi-grid">
        <div className="card rentabilidad-kpi-card">
          <span>Total publicaciones</span>
          <strong>{metrics.total}</strong>
          <small>Con item ID de MercadoLibre</small>
        </div>
        <div className="card rentabilidad-kpi-card promo">
          <span>Con promocion</span>
          <strong>{metrics.promos}</strong>
          <small>Precio final o aporte ML detectado</small>
        </div>
        <div className="card rentabilidad-kpi-card danger">
          <span>Con perdida</span>
          <strong>{metrics.danger}</strong>
          <small>Ganancia o margen negativo</small>
        </div>
        <div className="card rentabilidad-kpi-card warning">
          <span>Para revisar</span>
          <strong>{metrics.warning}</strong>
          <small>Margen bajo o precio alto</small>
        </div>
        <div className="card rentabilidad-kpi-card missing">
          <span>Datos faltantes</span>
          <strong>{metrics.missing}</strong>
          <small>Precio, envio o comision</small>
        </div>
        <div className="card rentabilidad-kpi-card">
          <span>Oportunidad bruta</span>
          <strong>{money(metrics.potential)}</strong>
          <small>Suma de brechas positivas</small>
        </div>
      </section>

      <section className="card rentabilidad-filters-card">
        <div className="rentabilidad-filter-grid">
          <div className="field">
            <label>Buscar</label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="SKU, producto, item ID, canal o accion"
            />
          </div>
          <div className="field">
            <label>Estado</label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos</option>
              <option value="danger">Perdida</option>
              <option value="warning">Revisar</option>
              <option value="missing">Datos faltantes</option>
              <option value="ok">OK</option>
            </select>
          </div>
          <div className="field">
            <label>Accion</label>
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
              <option value="">Todas</option>
              {actions.map((action) => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card rentabilidad-table-card">
        <div className="rentabilidad-table-header">
          <div>
            <h2>Revision de publicaciones</h2>
            <p className="small">Mostrando {groupedRows.length} SKUs y {filteredRows.length} publicaciones sincronizadas.</p>
          </div>
          <span className="badge">{metrics.ok} OK</span>
        </div>

        {loading ? (
          <p>Cargando rentabilidad...</p>
        ) : (
          <div className="table-wrap">
            <table className="rentabilidad-table">
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>SKU / producto</th>
                  <th>Publicaciones</th>
                  <th>Promos</th>
                  <th>Margen real</th>
                  <th>Ganancia real</th>
                  <th>Oportunidad</th>
                  <th>Accion</th>
                  <th>Sync</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((group) => {
                  const expanded = Boolean(expandedSkus[group.key]);
                  const latestSync = group.rows
                    .map((row) => row.shipping.meli_last_sync_at || row.shipping.updated_at)
                    .filter(Boolean)
                    .sort()
                    .reverse()[0];

                  return (
                    <Fragment key={group.key}>
                      <tr className={expanded ? "rentabilidad-group-row expanded" : "rentabilidad-group-row"}>
                        <td>
                          <span className={`rentabilidad-status rentabilidad-status-${group.status}`}>
                            {statusLabel(group.status)}
                          </span>
                        </td>
                        <td className="rentabilidad-product-cell">
                          <strong>{group.product.name}</strong>
                          <span>{group.product.sku} - {group.product.category || "Sin categoria"}</span>
                        </td>
                        <td><strong>{group.rows.length}</strong></td>
                        <td>
                          <strong>{group.promoCount}</strong>
                          <br />
                          <span className="small">detectadas</span>
                        </td>
                        <td>
                          <strong>{group.worstMargin !== null ? percent(group.worstMargin) : "-"}</strong>
                          <br />
                          <span className="small">Mejor {group.bestMargin !== null ? percent(group.bestMargin) : "-"}</span>
                        </td>
                        <td>{moneyWithCents(group.totalNetProfit)}</td>
                        <td>{moneyWithCents(group.totalPotential)}</td>
                        <td><span className="badge">{group.action}</span></td>
                        <td><span className="small">{formatDateTime(latestSync)}</span></td>
                        <td>
                          <button className="button ghost small-button" type="button" onClick={() => toggleSku(group.key)}>
                            {expanded ? "Ocultar" : "Ver publicaciones"}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="rentabilidad-detail-row">
                          <td colSpan={10}>
                            <div className="rentabilidad-detail-panel">
                              <table className="rentabilidad-detail-table">
                                <thead>
                                  <tr>
                                    <th>Publicacion</th>
                                    <th>Canal</th>
                                    <th>Precio ML / promo</th>
                                    <th>Precio sugerido</th>
                                    <th>Diferencia</th>
                                    <th>Base calculo ML</th>
                                    <th>Margen</th>
                                    <th>Ganancia</th>
                                    <th>Accion</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.rows.map((row) => (
                                    <tr key={row.key}>
                                      <td className="rentabilidad-product-cell">
                                        <strong>{row.shipping.meli_title || row.product.name}</strong>
                                        <span>
                                          {row.shipping.meli_item_id || "-"} - {meliStatusLabel(row.shipping.meli_status)}
                                          {row.shipping.meli_permalink ? (
                                            <>
                                              {" - "}
                                              <a href={row.shipping.meli_permalink} target="_blank" rel="noreferrer">Abrir ML</a>
                                            </>
                                          ) : null}
                                        </span>
                                        {row.issue && <em>{row.issue}</em>}
                                      </td>
                                      <td>
                                        <strong>{row.option.code}</strong>
                                        <br />
                                        <span className="small">{installmentLabel(row.shipping, shippingCosts)}</span>
                                      </td>
                                      <td className="rentabilidad-price-cell">
                                        <strong>{row.sellerEffectivePrice ? moneyWithCents(row.sellerEffectivePrice) : "-"}</strong>
                                        <span>Lista {row.listPrice ? moneyWithCents(row.listPrice) : "-"}</span>
                                        {row.buyerPrice && row.buyerPrice !== row.listPrice ? (
                                          <span>Comprador {moneyWithCents(row.buyerPrice)}</span>
                                        ) : null}
                                      </td>
                                      <td>{row.suggestedPrice ? moneyWithCents(row.suggestedPrice) : "-"}</td>
                                      <td>
                                        {row.differenceAmount !== null ? (
                                          <span className={row.differenceAmount > 0 ? "rentabilidad-gap-up" : "rentabilidad-gap-down"}>
                                            {moneyWithCents(row.differenceAmount)}
                                            <br />
                                            <small>{percent(row.differenceRate)}</small>
                                          </span>
                                        ) : "-"}
                                      </td>
                                      <td className="rentabilidad-promo-cell">
                                        {row.promoName || row.shipping.meli_promo_price ? (
                                          <>
                                            <strong>{row.promoName || "Promocion activa"}</strong>
                                            <span>Precio publico {row.buyerPrice ? moneyWithCents(row.buyerPrice) : "-"}</span>
                                            {Number(row.shipping.meli_promo_meli_amount || 0) > 0 ? (
                                              <span>Aporte ML {moneyWithCents(Number(row.shipping.meli_promo_meli_amount || 0))}</span>
                                            ) : null}
                                            <span>Base comision {row.sellerEffectivePrice ? moneyWithCents(row.sellerEffectivePrice) : "-"}</span>
                                            <span>Descuento total {row.sellerDiscountAmount ? moneyWithCents(row.sellerDiscountAmount) : "-"}</span>
                                          </>
                                        ) : (
                                          <span className="small">Sin promo detectada</span>
                                        )}
                                      </td>
                                      <td>
                                        <strong>{row.currentMargin !== null ? percent(row.currentMargin) : "-"}</strong>
                                        <br />
                                        <span className="small">Objetivo {percent(row.targetMargin)}</span>
                                      </td>
                                      <td>
                                        {row.netProfit !== null ? moneyWithCents(row.netProfit) : "-"}
                                        {row.suggestedNetProfit !== null ? (
                                          <>
                                            <br />
                                            <span className="small">Sug. {moneyWithCents(row.suggestedNetProfit)}</span>
                                          </>
                                        ) : null}
                                      </td>
                                      <td><span className="badge">{row.action}</span></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}                {groupedRows.length === 0 && (
                  <tr>
                    <td colSpan={10}>No hay publicaciones para mostrar con esos filtros.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
