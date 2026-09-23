"use client";
import { usePricingLoad } from "@/lib/usePricingLoad";
import { PricingDataStatus } from "@/components/PricingDataStatus";
import { categoryOptions, normalizeFilter } from "@/lib/pricingData";

import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgePercent,
  ChevronUp,
  CircleDollarSign,
  Pencil,
  ReceiptText,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tags,
  Upload,
  X,
} from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { createClient } from "@/lib/supabase";
import {
  calculatePriceSummary,
  calculateB2bPriceSummary,
  defaultTaxSettings,
  mercadoLibreClassicOption,
  money,
  moneyWithCents,
  normalizeOption,
  percent,
  promoListPrice,
  toNumber,
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

type MarginMode = "margin" | "net";
type SyncMode = "none" | "margin" | "net";
type SortDirection = "asc" | "desc";
type PriceSortKey = "product" | "cost" | "price" | "margin" | "status";

type ModalState = {
  product: Product;
  mode: MarginMode;
  syncMode: SyncMode;
  margins: Record<string, number>;
  netProfits: Record<string, number | null>;
  priceOverrides: Record<string, number | null>;
  structureAmounts: Record<string, number>;
  manualShippingAmounts: Record<string, number>;
  salesCommissionRates: Record<string, number>;
  saleAppliesVat: Record<string, boolean>;
  costVatRates: Record<string, number>;
  promoDiscountRates: Record<string, number>;
  summaryChannelCode: string;
  taxOverrides: TaxSettings;
};

type B2BRecommendation = {
  quantity?: number | null;
  amount?: number | null;
  is_incoherent_quantity?: boolean | null;
  discount?: { amount?: number | null; percentage?: number | null } | null;
  shipping?: {
    original_cost?: number | null;
    cost?: number | null;
    discount?: { amount?: number | null; percentage?: number | null } | null;
  } | null;
};

type B2BPublication = {
  itemId: string;
  standardAmount?: number | null;
  salePriceAmount?: number | null;
  meliPromoContributionAmount?: number | null;
  currency?: string | null;
  recommendations?: B2BRecommendation[];
  existingRanges?: Array<{
    type?: string | null;
    amount?: number | null;
    percentage?: number | null;
    conditions?: { min_purchase_unit?: number | null; eligible?: boolean | null; context_restrictions?: string[] | null } | null;
  }>;
  error?: string;
};

export default function PricesPage() {
  const router = useRouter();
  const supabase = createClient();
  const dataLoad = usePricingLoad('precios', supabase);
  const [products, setProducts] = useState<Product[]>([]);
  const [installments, setInstallments] = useState<
    MercadoLibreInstallmentFee[]
  >([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>(
    [],
  );
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [shippingCosts, setShippingCosts] = useState<
    MercadoLibreShippingCost[]
  >([]);
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>(
    [],
  );
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState<PriceSortKey>("product");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [salePriceInputDrafts, setSalePriceInputDrafts] = useState<Record<string, string>>({});
  const [refreshingProductSku, setRefreshingProductSku] = useState<string | null>(null);
  const [productSyncMessage, setProductSyncMessage] = useState<string | null>(null);
  const [publishingPriceChannel, setPublishingPriceChannel] = useState<string | null>(null);
  const [refreshingAdaraSku, setRefreshingAdaraSku] = useState<string | null>(null);
  const [b2bPublications, setB2bPublications] = useState<B2BPublication[] | null>(null);
  const [loadingB2b, setLoadingB2b] = useState(false);
  const [b2bError, setB2bError] = useState<string | null>(null);
  const [expandedPricingTabs, setExpandedPricingTabs] = useState<Record<string, "compare" | "channels" | "real" | "wholesale">>({});
  const [expandedComparisonRows, setExpandedComparisonRows] = useState<Record<string, boolean>>({});
  const [b2bBySku, setB2bBySku] = useState<Record<string, B2BPublication[]>>({});
  const [b2bErrorBySku, setB2bErrorBySku] = useState<Record<string, string>>({});
  const [loadingB2bSku, setLoadingB2bSku] = useState<string | null>(null);
  const [selectedB2bRanges, setSelectedB2bRanges] = useState<Record<string, boolean>>({});
  const [savingB2bItem, setSavingB2bItem] = useState<string | null>(null);
  const productSyncRequestId = useRef(0);
  const [expandedProducts, setExpandedProducts] = useState<
    Record<string, boolean>
  >({});

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function authenticatedJsonHeaders() {
    let sessionResponse = await supabase.auth.getSession();
    if (/failed to get project config/i.test(sessionResponse.error?.message || "")) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
      sessionResponse = await supabase.auth.getSession();
    }
    // La página puede seguir abierta con un access token vencido. Intentamos
    // renovarlo antes de llamar a endpoints que modifican datos en ML.
    if (!sessionResponse.data.session) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.data.session) sessionResponse = refreshed;
    }
    return {
      "Content-Type": "application/json",
      ...(sessionResponse.data.session?.access_token ? { Authorization: `Bearer ${sessionResponse.data.session.access_token}` } : {}),
    };
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function loadData(options: {quiet?: boolean; initial?: boolean} = {}) {
    setLoading(true);
    try { await dataLoad.run({"installments":{"table":"mercadolibre_installment_fees","filters":[["eq","active",true]],"order":"code"},"categories":{"table":"mercadolibre_category_fees","filters":[["eq","active",true]]},"taxes":{"table":"tax_settings","filters":[["eq","key","default"]]},"products":{"table":"products","filters":[["neq","status","discontinued"]],"order":"name"},"publications":{"table":"mercadolibre_shipping_costs","filters":[["eq","active",true]]},"margins":{"table":"product_channel_margins"}}, data => { setProducts(data.products); setInstallments(data.installments.filter(item => item.code !== "MC")); setCategoryFees(data.categories); setTaxes(data.taxes[0] || defaultTaxSettings()); setShippingCosts(data.publications); setMarginSettings(data.margins); }, !options.initial); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    checkSession();
    loadData({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // El controlador de cuenta puede abrir directamente el SKU que necesita
    // atención; conservamos el filtro dentro de Precios para actuar sin buscar
    // el producto otra vez.
    const sku = new URLSearchParams(window.location.search).get("sku")?.trim();
    if (sku) setQuery(sku);
  }, []);

  const pricingOptions = useMemo<MercadoLibrePriceOption[]>(() => {
    const options = [
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

    return sortPricingOptions(options);
  }, [installments]);

  const categories = useMemo(() => categoryOptions(products.map(product => product.category)), [products]);

  const productStatuses = useMemo(() => {
    const values = products.map((product) => product.status || "").filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);

  const priceKpis = useMemo(() => {
    const pricedProducts = products.filter((product) => Boolean(calculateMcRawPriceForProduct(product)));
    const margins = products.map((product) => getMargin(product.id, "MC")).filter((value) => Number.isFinite(value));
    const averageMargin = margins.length ? margins.reduce((total, value) => total + value, 0) / margins.length : null;
    const withoutCost = products.filter((product) => !Number(product.cost_without_vat || 0)).length;
    return {
      total: products.length,
      priced: pricedProducts.length,
      averageMargin,
      withoutCost,
    };
  }, [products, categoryFees, taxes, shippingCosts, marginSettings]);

  function shippingsForProduct(product: Product) {
    return shippingCosts.filter(
      (item) => item.product_id === product.id || item.sku === product.sku,
    );
  }

  function productImage(shippings: MercadoLibreShippingCost[]) {
    return shippings.find((shipping) => Boolean(shipping.meli_thumbnail))?.meli_thumbnail || null;
  }

  function productInitial(product: Product) {
    const value = product.brand || product.name || product.sku || "P";
    return value.slice(0, 2).toUpperCase();
  }

  const filteredProducts = useMemo(() => {
    const q = query.toLowerCase().trim();
    const filtered = products.filter((product) => {
      const productShippings = shippingCosts.filter(
        (item) => item.product_id === product.id || item.sku === product.sku,
      );
      const publicationText = productShippings
        .map((item) => `${item.meli_item_id || ""} ${item.meli_title || ""}`)
        .join(" ");
      const text =
        `${product.sku} ${product.name} ${product.brand || ""} ${product.model || ""} ${product.category || ""} ${publicationText}`.toLowerCase();
      const matchesQuery = !q || text.includes(q);
      const matchesCategory =
        !categoryFilter || normalizeFilter(product.category) === normalizeFilter(categoryFilter);
      const matchesStatus = !statusFilter || product.status === statusFilter;
      return matchesQuery && matchesCategory && matchesStatus;
    });

    return [...filtered].sort((a, b) => {
      const multiplier = sortDirection === "asc" ? 1 : -1;
      if (sortKey === "product") {
        return `${a.name} ${a.sku}`.localeCompare(`${b.name} ${b.sku}`, "es") * multiplier;
      }
      if (sortKey === "status") {
        return String(a.status || "").localeCompare(String(b.status || ""), "es") * multiplier;
      }
      if (sortKey === "cost") {
        return (Number(a.cost_without_vat || 0) - Number(b.cost_without_vat || 0)) * multiplier;
      }
      if (sortKey === "margin") {
        return (getMargin(a.id, "MC") - getMargin(b.id, "MC")) * multiplier;
      }
      const priceA = Number(calculateMcRawPriceForProduct(a) || 0);
      const priceB = Number(calculateMcRawPriceForProduct(b) || 0);
      return (priceA - priceB) * multiplier;
    });
  }, [products, shippingCosts, query, categoryFilter, statusFilter, sortKey, sortDirection, marginSettings, categoryFees, taxes]);

  function getMargin(productId: string | undefined, channelCode: string) {
    const setting = marginSettings.find(
      (item) =>
        item.product_id === productId && item.channel_code === channelCode,
    );
    return Number(setting?.desired_margin_rate ?? 5);
  }

  function getNetProfit(productId: string | undefined, channelCode: string) {
    const setting = marginSettings.find(
      (item) =>
        item.product_id === productId && item.channel_code === channelCode,
    );
    return setting?.desired_net_profit ?? null;
  }

  function getChannelSetting(
    productId: string | undefined,
    channelCode: string,
  ) {
    return marginSettings.find(
      (item) =>
        item.product_id === productId && item.channel_code === channelCode,
    );
  }

  function formatInputNumber(value: number | null | undefined, decimals = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value)))
      return "";
    const fixed = Number(value).toFixed(decimals);
    return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function validSalePriceInput(value: string) {
    return /^\d+(?:[.,]\d{0,2})?$/.test(value.trim()) && Number(toNumber(value)) > 0;
  }

  function finishSalePriceInput(channelCode: string) {
    setSalePriceInputDrafts((current) => {
      const value = current[channelCode];
      if (value !== undefined && value.trim() !== "" && !validSalePriceInput(value)) return current;
      const next = { ...current };
      delete next[channelCode];
      return next;
    });
  }

  function allowsExtraSalesCommission(option?: MercadoLibrePriceOption | null) {
    if (!option) return false;
    return !normalizeOption(option).applies_marketplace_fee;
  }

  function publicationInstallmentCount(publication?: MercadoLibreShippingCost | null) {
    if (!publication) return null;
    const text = `${publication.meli_installments_text || ""} ${publication.notes || ""} ${publication.meli_listing_type_id || ""}`.toLowerCase();
    if (text.includes("sin cuotas") || text.includes("1 pago") || text.includes("clasica")) return 1;
    const match = text.match(/(\d{1,2})\s*(x|cuotas?|installments?)/i);
    if (match?.[1]) return Number(match[1]);
    if (text.includes("gold_pro") || text.includes("premium")) return 6;
    return null;
  }

  function optionMatchesPublication(option: MercadoLibrePriceOption, publication: MercadoLibreShippingCost) {
    const optionCount = Number(option.installment_count || 0) || 1;
    const publicationCount = publicationInstallmentCount(publication);
    if (!publicationCount) return false;
    return optionCount === publicationCount;
  }

  function shippingCostsForOption(product: Product, option: MercadoLibrePriceOption) {
    const normalizedOption = normalizeOption(option);
    const productCandidates = shippingCosts.filter(
      (item) => item.product_id === product.id || item.sku === product.sku,
    );
    const activeCandidates = productCandidates.filter((item) => item.active !== false && item.meli_status !== "closed");
    const candidates = activeCandidates.length ? activeCandidates : productCandidates;
    if (!candidates.length) return [];

    return [...candidates]
      .filter((item) => optionMatchesPublication(normalizedOption, item))
      .sort((a, b) => {
      const score = (item: MercadoLibreShippingCost) => {
        let value = 0;
        if (optionMatchesPublication(normalizedOption, item)) value += 1000;
        if (item.meli_status === "active") value += 100;
        if (item.active !== false) value += 50;
        if (item.product_id === product.id) value += 20;
        if (item.meli_last_sync_at) value += 10;
        if (Number(item.fixed_fee_amount || 0) > 0) value += 8;
        if (Number(item.shipping_cost_amount || 0) > 0) value += 4;
        if (item.meli_item_id) value += 2;
        return value;
      };
      const diff = score(b) - score(a);
      if (diff) return diff;
      return new Date(b.meli_last_sync_at || b.updated_at || 0).getTime() - new Date(a.meli_last_sync_at || a.updated_at || 0).getTime();
      });
  }

  function calculatePriceWithMatchedShipping(
    product: Product,
    option: MercadoLibrePriceOption,
    categoryFee: MercadoLibreCategoryFee | null | undefined,
    taxesForCalculation: TaxSettings,
    target: Parameters<typeof calculatePriceSummary>[5],
  ) {
    const normalizedOption = normalizeOption(option);
    const candidates = normalizedOption.applies_shipping
      ? shippingCostsForOption(product, normalizedOption)
      : [];
    const scenarios = (candidates.length ? candidates : [null]).map((shippingCost) => ({
      shippingCost,
      result: calculatePriceSummary(
        product,
        normalizedOption,
        normalizedOption.applies_marketplace_fee ? categoryFee : null,
        taxesForCalculation,
        shippingCost,
        target,
      ) as any,
    }));

    // Un mismo SKU puede tener publicaciones con y sin envío gratis. Elegimos el
    // escenario cuyo precio calculado se parece al precio real de su publicación,
    // en lugar de usar simplemente la última sincronización.
    return scenarios.sort((a, b) => {
      const score = (scenario: typeof scenarios[number]) => {
        if (!scenario.result?.valid) return Number.POSITIVE_INFINITY;
        if (!scenario.shippingCost?.meli_price) return Number.POSITIVE_INFINITY / 2;
        return Math.abs(Number(scenario.result.roundedPrice || 0) - Number(scenario.shippingCost.meli_price || 0));
      };
      return score(a) - score(b);
    })[0];
  }

  function isMercadoLibreChannel(option?: MercadoLibrePriceOption | null) {
    if (!option) return false;
    // La configuración heredada puede marcar otros canales como MercadoLibre.
    // Para publicar, solo son válidas la clásica y las condiciones Premium.
    return option.code === "MC" || option.code?.startsWith("MP");
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


  function getPromoDiscount(
    productId: string | undefined,
    channelCode: string,
  ) {
    const setting = getChannelSetting(productId, channelCode);
    return Number(setting?.promo_discount_rate || 0);
  }

  function openProductModal(product: Product) {
    setSalePriceInputDrafts({});
    const margins: Record<string, number> = {};
    const netProfits: Record<string, number | null> = {};
    const priceOverrides: Record<string, number | null> = {};
    const structureAmounts: Record<string, number> = {};
    const manualShippingAmounts: Record<string, number> = {};
    const salesCommissionRates: Record<string, number> = {};
    const saleAppliesVat: Record<string, boolean> = {};
    const costVatRates: Record<string, number> = {};
    const promoDiscountRates: Record<string, number> = {};
    pricingOptions.forEach((option) => {
      const setting = getChannelSetting(product.id, option.code);
      margins[option.code] = getMargin(product.id, option.code);
      netProfits[option.code] = getNetProfit(product.id, option.code);
      priceOverrides[option.code] = setting?.manual_sale_price ?? null;
      structureAmounts[option.code] = Number(setting?.structure_amount || 0);
      manualShippingAmounts[option.code] = Number(
        setting?.manual_shipping_amount || 0,
      );
      salesCommissionRates[option.code] = Number(
        setting?.sales_commission_rate || 0,
      );
      saleAppliesVat[option.code] =
        setting?.sale_applies_vat ??
        Boolean(normalizeOption(option).applies_vat);
      costVatRates[option.code] = Number(setting?.cost_vat_rate || 0);
      promoDiscountRates[option.code] = Number(
        setting?.promo_discount_rate || 0,
      );
    });
    setModal({
      product,
      mode: "margin",
      syncMode: "none",
      margins,
      netProfits,
      priceOverrides,
      structureAmounts,
      manualShippingAmounts,
      salesCommissionRates,
      saleAppliesVat,
      costVatRates,
      promoDiscountRates,
      summaryChannelCode: "MC",
      taxOverrides: { ...taxes },
    });
    setB2bPublications(null);
    setB2bError(null);
    refreshProductFromMercadoLibre(product);
  }

  async function loadB2bRecommendations() {
    if (!modal || loadingB2b) return;
    setLoadingB2b(true);
    setB2bError(null);
    try {
      const response = await fetch("/api/mercadolibre/b2b-pricing", {
        method: "POST",
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify({ sku: modal.product.sku, quantities: [2, 5, 10] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "No se pudieron consultar los precios mayoristas.");
      setB2bPublications((data?.publications || []) as B2BPublication[]);
    } catch (requestError) {
      setB2bError(requestError instanceof Error ? requestError.message : "No se pudieron consultar los precios mayoristas.");
    } finally {
      setLoadingB2b(false);
    }
  }

  async function loadB2bForProduct(product: Product) {
    const sku = product.sku;
    if (!sku || loadingB2bSku === sku) return;
    setLoadingB2bSku(sku);
    // Una consulta es sólo lectura: nunca debe conservar checks de una foto
    // anterior ni permitir que una acción vieja vuelva a activar rangos.
    setSelectedB2bRanges((current) => Object.fromEntries(
      Object.entries(current).filter(([rangeKey]) => !rangeKey.startsWith(`${sku}|`)),
    ));
    setB2bErrorBySku((current) => ({ ...current, [sku]: "" }));
    try {
      const response = await fetch("/api/mercadolibre/b2b-pricing", {
        method: "POST",
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify({ sku, quantities: [2, 5, 10] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "No se pudieron consultar los precios mayoristas.");
      setB2bBySku((current) => ({ ...current, [sku]: (data?.publications || []) as B2BPublication[] }));
    } catch (requestError) {
      setB2bErrorBySku((current) => ({
        ...current,
        [sku]: requestError instanceof Error ? requestError.message : "No se pudieron consultar los precios mayoristas.",
      }));
    } finally {
      setLoadingB2bSku(null);
    }
  }

  function b2bRangeKey(sku: string, itemId: string, quantity: number) {
    return `${sku}|${itemId}|${quantity}`;
  }

  async function activateB2bRanges(product: Product, itemId: string, rows: Array<{ quantity: number; price: number; targetMargin: number }>) {
    if (!rows.length || savingB2bItem) return;
    const confirmed = window.confirm(`¿Activar ${rows.length} rango(s) mayoristas en ${itemId}? MercadoLibre validará nuevamente los precios.`);
    if (!confirmed) return;
    setSavingB2bItem(itemId);
    setError(null);
    try {
      const response = await fetch("/api/mercadolibre/update-b2b-prices", {
        method: "POST",
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify({ sku: product.sku, itemId, ranges: rows }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "No se pudieron activar los precios mayoristas.");
      setMessage(`Precios mayoristas activados en ${itemId}.`);
      await loadB2bForProduct(product);
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "No se pudieron activar los precios mayoristas.");
    } finally {
      setSavingB2bItem(null);
    }
  }

  async function activateSelectedB2bRanges(
    product: Product,
    groups: Array<{ itemId: string; rows: Array<{ quantity: number; price: number; targetMargin: number }> }>,
  ) {
    const rangesCount = groups.reduce((total, group) => total + group.rows.length, 0);
    if (!rangesCount || savingB2bItem) return;
    const confirmed = window.confirm(`¿Activar ${rangesCount} rango(s) mayoristas en ${groups.length} publicación${groups.length === 1 ? "" : "es"}? MercadoLibre validará nuevamente los precios.`);
    if (!confirmed) return;

    setSavingB2bItem("all");
    setError(null);
    const errors: string[] = [];
    let activated = 0;
    try {
      // Cada MLA se guarda en su propia llamada, pero la persona confirma una
      // sola vez y no necesita recorrer botones repetidos.
      for (const group of groups) {
        try {
          const response = await fetch("/api/mercadolibre/update-b2b-prices", {
            method: "POST",
            headers: await authenticatedJsonHeaders(),
            body: JSON.stringify({ sku: product.sku, itemId: group.itemId, ranges: group.rows }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data?.error || "No se pudieron activar los precios mayoristas.");
          activated += group.rows.length;
        } catch (activationError) {
          errors.push(`${group.itemId}: ${activationError instanceof Error ? activationError.message : "no se pudo actualizar"}`);
        }
      }
      if (activated) {
        setMessage(`${activated} rango${activated === 1 ? "" : "s"} mayorista${activated === 1 ? "" : "s"} activado${activated === 1 ? "" : "s"} en ${groups.length} MLA.`);
        setSelectedB2bRanges((current) => Object.fromEntries(
          Object.entries(current).filter(([rangeKey]) => !rangeKey.startsWith(`${product.sku}|`)),
        ));
        await loadB2bForProduct(product);
      }
      if (errors.length) setError(`Algunas publicaciones no se pudieron activar: ${errors.join(" · ")}`);
    } finally {
      setSavingB2bItem(null);
    }
  }

  async function deactivateSelectedB2bRanges(
    product: Product,
    groups: Array<{ itemId: string; quantities: number[] }>,
  ) {
    const rangesCount = groups.reduce((total, group) => total + group.quantities.length, 0);
    if (!rangesCount || savingB2bItem) return;
    if (!window.confirm(`¿Desactivar ${rangesCount} rango(s) mayoristas seleccionados? Las publicaciones volverán a no ofrecer ese descuento por cantidad.`)) return;

    setSavingB2bItem("all");
    setError(null);
    const errors: string[] = [];
    let deactivated = 0;
    try {
      for (const group of groups) {
        try {
          const response = await fetch("/api/mercadolibre/update-b2b-prices", {
            method: "POST",
            headers: await authenticatedJsonHeaders(),
            body: JSON.stringify({ sku: product.sku, itemId: group.itemId, removeQuantities: group.quantities }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data?.error || "No se pudieron desactivar los precios mayoristas.");
          deactivated += group.quantities.length;
        } catch (deactivationError) {
          errors.push(`${group.itemId}: ${deactivationError instanceof Error ? deactivationError.message : "no se pudo actualizar"}`);
        }
      }
      if (deactivated) {
        setMessage(`${deactivated} rango${deactivated === 1 ? "" : "s"} mayorista${deactivated === 1 ? "" : "s"} desactivado${deactivated === 1 ? "" : "s"}.`);
        setSelectedB2bRanges((current) => Object.fromEntries(
          Object.entries(current).filter(([rangeKey]) => !rangeKey.startsWith(`${product.sku}|`)),
        ));
        await loadB2bForProduct(product);
      }
      if (errors.length) setError(`Algunas publicaciones no se pudieron desactivar: ${errors.join(" · ")}`);
    } finally {
      setSavingB2bItem(null);
    }
  }

  async function refreshProductFromMercadoLibre(product: Product) {
    const sku = product.sku?.trim();
    if (!sku || refreshingProductSku === sku) return;
    const requestId = productSyncRequestId.current + 1;
    productSyncRequestId.current = requestId;

    setRefreshingProductSku(sku);
    setProductSyncMessage("Actualizando datos de MercadoLibre para este SKU...");

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch("/api/mercadolibre/sync-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: [sku] }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (productSyncRequestId.current === requestId) {
          setProductSyncMessage(data?.error || "No se pudo actualizar MercadoLibre para este SKU.");
        }
        return;
      }

      await loadData({ quiet: true });
      if (productSyncRequestId.current !== requestId) return;

      const matched = Number(data?.matched || 0);
      const updated = Number(data?.updated || 0);
      const withoutCost = Number(data?.no_shipping_cost || 0);
      setProductSyncMessage(
        matched > 0
          ? `MercadoLibre actualizado: ${updated} publicacion(es) refrescada(s)${withoutCost ? `, ${withoutCost} sin costo devuelto` : ""}.`
          : "MercadoLibre no encontro publicaciones para este SKU.",
      );
    } catch (syncError) {
      if (productSyncRequestId.current === requestId) {
        setProductSyncMessage(
          syncError instanceof DOMException && syncError.name === "AbortError"
            ? "La actualizacion de MercadoLibre tardo demasiado. Se mantienen los datos guardados."
            : syncError instanceof Error ? syncError.message : "No se pudo actualizar MercadoLibre.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (productSyncRequestId.current === requestId) {
        setRefreshingProductSku(null);
      }
    }
  }

  async function publishPriceToMercadoLibre(
    product: Product,
    option: MercadoLibrePriceOption,
    salePrice: number | null | undefined,
    promoDiscountRate: number,
  ) {
    const normalizedOption = normalizeOption(option);
    const installmentCount = Number(normalizedOption.installment_count || 0) || 1;
    const parsedSalePrice = Number(salePrice || 0);
    const price = promoDiscountRate > 0
      ? promoListPrice(parsedSalePrice, promoDiscountRate)
      : parsedSalePrice;
    if (!Number.isFinite(price) || price <= 0) {
      setError("No hay un precio válido para cargar en Mercado Libre.");
      return;
    }

    const condition = installmentCount === 1 ? "Clásica / 1 pago" : `${installmentCount} cuotas`;
    const usePromoPrice = promoDiscountRate > 0;
    const confirmed = window.confirm(
      `Vas a cargar ${moneyWithCents(price)} en todas las publicaciones activas del SKU ${product.sku} para ${condition}.${usePromoPrice ? ` Es el precio de lista para sostener la promo de ${percent(promoDiscountRate)}.` : ""}\n\nLas publicaciones con automatización de precios activa se omitirán.`,
    );
    if (!confirmed) return;

    const actionKey = `${product.sku}-${normalizedOption.code}`;
    setPublishingPriceChannel(actionKey);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/mercadolibre/update-sku-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: product.sku, installmentCount, price }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "No se pudo cargar el precio en Mercado Libre.");

      const updated = Array.isArray(data?.updated) ? data.updated.length : 0;
      const skipped = Array.isArray(data?.skipped) ? data.skipped.length : 0;
      if (!updated) {
        throw new Error(skipped ? `Mercado Libre no actualizó publicaciones: ${data.skipped.map((item: { itemId?: string; reason?: string }) => `${item.itemId || "publicación"} (${item.reason || "sin detalle"})`).join(" · ")}` : "Mercado Libre no actualizó ninguna publicación.");
      }
      setMessage(
        `${updated} publicación${updated === 1 ? "" : "es"} actualizada${updated === 1 ? "" : "s"} en ${condition}${skipped ? ` · ${skipped} omitida${skipped === 1 ? "" : "s"} (ver automatización o detalle de ML)` : ""}.`,
      );
      await loadData({ quiet: true });
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "No se pudo cargar el precio en Mercado Libre.");
    } finally {
      setPublishingPriceChannel(null);
    }
  }

  async function publishAllPricesToMercadoLibre(
    product: Product,
    rows: ReturnType<typeof calculateRowsForProduct>,
  ) {
    const prices = rows
      .filter(({ option, result }) => isMercadoLibreChannel(option) && result.valid)
      .map(({ option, result, promoDiscountRate }) => ({
        option,
        installmentCount: Number(option.installment_count || 0) || 1,
        price: promoDiscountRate > 0
          ? promoListPrice(result.roundedPrice, promoDiscountRate)
          : result.roundedPrice,
      }))
      .filter(({ price }) => Number.isFinite(Number(price)) && Number(price) > 0);
    if (!prices.length) {
      setError("No hay precios válidos de Mercado Libre para cargar.");
      return;
    }

    const confirmed = window.confirm(
      `Vas a cargar los ${prices.length} precios de Mercado Libre para el SKU ${product.sku}: Clásica y cuotas Premium.\n\nNo se incluirán Efectivo, Tienda Nube ni Transferencia. Las publicaciones con automatización activa se omitirán.`,
    );
    if (!confirmed) return;

    const actionKey = `${product.sku}-all`;
    setPublishingPriceChannel(actionKey);
    setError(null);
    setMessage(null);
    try {
      // Las publicaciones pueden haberse creado hace instantes en ML. Sincronizamos
      // este SKU antes de resolver cada cuota para no trabajar con una foto vieja.
      const syncResponse = await fetch("/api/mercadolibre/sync-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: [product.sku] }),
      });
      const syncData = await syncResponse.json().catch(() => ({}));
      if (!syncResponse.ok) throw new Error(syncData?.error || "No se pudieron actualizar las publicaciones de Mercado Libre para este SKU.");

      const responses = await Promise.all(prices.map(async ({ installmentCount, price }) => {
        const response = await fetch("/api/mercadolibre/update-sku-price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku: product.sku, installmentCount, price }),
        });
        const data = await response.json().catch(() => ({}));
        return { response, data, installmentCount };
      }));
      const updated = responses.reduce((total, item) => total + (Array.isArray(item.data?.updated) ? item.data.updated.length : 0), 0);
      const skipped = responses.reduce((total, item) => total + (Array.isArray(item.data?.skipped) ? item.data.skipped.length : 0), 0);
      const failed = responses.filter((item) => !item.response.ok).map((item) => item.data?.error || `${item.installmentCount} cuotas`);
      if (!updated) throw new Error(failed.length ? `No se pudieron cargar los precios: ${failed.join(" · ")}` : "Mercado Libre no actualizó ninguna publicación.");

      setMessage(`${updated} publicación${updated === 1 ? "" : "es"} actualizada${updated === 1 ? "" : "s"} en Mercado Libre${skipped ? ` · ${skipped} omitida${skipped === 1 ? "" : "s"}` : ""}${failed.length ? ` · ${failed.length} cuota${failed.length === 1 ? "" : "s"} sin actualizar` : ""}.`);
      await loadData({ quiet: true });
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "No se pudieron cargar los precios en Mercado Libre.");
    } finally {
      setPublishingPriceChannel(null);
    }
  }

  async function refreshAdaraPromotion(product: Product, rows: ReturnType<typeof calculateRowsForProduct>) {
    const entries = rows
      .filter(({ option, result, promoDiscountRate, promoPrice }) => isMercadoLibreChannel(option) && result.valid && promoDiscountRate > 0 && Number(promoPrice || 0) > 0)
      .flatMap(({ option, result, promoPrice }) => shippingsForProduct(product)
        .filter((publication) => publication.meli_status === "active" && publication.meli_item_id && optionMatchesPublication(option, publication))
        .map((publication) => ({ itemId: publication.meli_item_id, listPrice: promoPrice, dealPrice: result.roundedPrice })));
    if (!entries.length) { setError("No hay cuotas de Mercado Libre con precio promo para activar en Adara."); return; }
    if (!window.confirm(`Vas a actualizar y activar Adara en ${entries.length} publicación${entries.length === 1 ? "" : "es"} de ${product.sku}. Solo se tocará la campaña propia Adara.`)) return;
    setRefreshingAdaraSku(product.sku);
    setError(null); setMessage(null);
    try {
      const response = await fetch("/api/mercadolibre/refresh-adara-promotion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo actualizar Adara.");
      setMessage(`Adara actualizada en ${data.updated.length} publicación${data.updated.length === 1 ? "" : "es"}${data.failed?.length ? ` · ${data.failed.length} con error` : ""}.`);
      await loadData({ quiet: true });
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo actualizar Adara."); }
    finally { setRefreshingAdaraSku(null); }
  }

  function effectiveMargin(channelCode: string) {
    if (!modal) return 5;
    if (modal.syncMode === "margin" && channelCode !== "MC")
      return Number(modal.margins.MC ?? 5);
    return Number(modal.margins[channelCode] ?? 5);
  }

  function effectiveNetProfit(channelCode: string) {
    if (!modal) return null;
    if (modal.syncMode === "net" && channelCode !== "MC")
      return modal.netProfits.MC ?? null;
    if (modal.syncMode === "margin") return null;
    return modal.netProfits[channelCode] ?? null;
  }

  async function saveMargins() {
    if (!modal || !modal.product.id) return false;
    if (Object.values(salePriceInputDrafts).some((value) => value.trim() !== "" && !validSalePriceInput(value))) {
      setError("El precio debe ser mayor a cero y tener como máximo dos decimales.");
      return false;
    }
    setSaving(true);
    setError(null);
    setMessage(null);

    const rows = modalRows().map(({ option, result }) => ({
      product_id: modal.product.id,
      sku: modal.product.sku,
      channel_code: option.code,
      desired_margin_rate: result.valid
        ? Number(result.marginOnNetSale || 0)
        : effectiveMargin(option.code),
      desired_net_profit: effectiveNetProfit(option.code),
      manual_sale_price: modal.priceOverrides[option.code] ?? null,
      structure_amount: Number(modal.structureAmounts[option.code] || 0),
      manual_shipping_amount: Number(
        modal.manualShippingAmounts[option.code] || 0,
      ),
      sales_commission_rate: allowsExtraSalesCommission(option)
        ? Number(modal.salesCommissionRates[option.code] || 0)
        : 0,
      sale_applies_vat: Boolean(modal.saleAppliesVat[option.code]),
      cost_vat_rate: Math.max(0, Math.min(Number(modal.product.vat_rate || 21), Number(modal.costVatRates[option.code] || 0))),
      promo_discount_rate: isMercadoLibreChannel(option)
        ? Number(modal.promoDiscountRates[option.code] || 0)
        : 0,
    }));

    const { data, error } = await supabase
      .from("product_channel_margins")
      .upsert(rows, { onConflict: "product_id,channel_code" })
      .select("*");
    setSaving(false);
    if (error) {
      setError(error.message);
      return false;
    }
    else {
      const savedRows = (data || []) as ProductChannelMargin[];
      setMarginSettings((current) => {
        const savedKeys = new Set(
          savedRows.map((item) => `${item.product_id || item.sku}-${item.channel_code}`),
        );
        const remaining = current.filter(
          (item) => !savedKeys.has(`${item.product_id || item.sku}-${item.channel_code}`),
        );
        return [...remaining, ...savedRows];
      });
      setMessage("Márgenes guardados correctamente.");
      await loadData();
      setSalePriceInputDrafts({});
      return true;
    }
  }

  function updateMargin(channelCode: string, value: string) {
    if (!modal) return;
    setSalePriceInputDrafts((current) => { const next = { ...current }; delete next[channelCode]; return next; });
    const margin = Number(toNumber(value) ?? 0);
    setModal({
      ...modal,
      mode: "margin",
      margins: { ...modal.margins, [channelCode]: margin },
      netProfits: { ...modal.netProfits, [channelCode]: null },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
    });
  }

  function updateNetProfit(channelCode: string, value: string) {
    if (!modal) return;
    setSalePriceInputDrafts((current) => { const next = { ...current }; delete next[channelCode]; return next; });
    const net = toNumber(value);

    if (net === null) {
      setModal({
        ...modal,
        mode: "margin",
        netProfits: { ...modal.netProfits, [channelCode]: null },
        priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
      });
      return;
    }

    const product = modal.product;
    const option = pricingOptions.find((item) => item.code === channelCode);
    if (!option) return;
    const normalizedOption = normalizeOption(option);
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    const { result } = calculatePriceWithMatchedShipping(
      product,
      normalizedOption,
      categoryFee,
      modal.taxOverrides,
      {
        desiredMarginRate: effectiveMargin(channelCode),
        desiredNetProfit: net,
        salePrice: null,
        structureAmount: modal.structureAmounts[channelCode] || 0,
        manualShippingAmount: modal.manualShippingAmounts[channelCode] || 0,
        salesCommissionRate: modal.salesCommissionRates[channelCode] || 0,
        saleAppliesVat:
          modal.saleAppliesVat[channelCode] ?? normalizedOption.applies_vat,
        costVatRate: modal.costVatRates[channelCode] || 0,
        roundTo: 100,
        roundingMode: "nearest",
      },
    );

    setModal({
      ...modal,
      mode: "net",
      margins: {
        ...modal.margins,
        [channelCode]: result.valid
          ? Number((result.marginOnNetSale || 0).toFixed(2))
          : Number(modal.margins[channelCode] || 0),
      },
      netProfits: { ...modal.netProfits, [channelCode]: net },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
    });
  }

  function updateSalePrice(channelCode: string, value: string) {
    if (!modal) return;
    setSalePriceInputDrafts((current) => ({ ...current, [channelCode]: value }));
    if (value.trim() !== "" && !/^\d+(?:[.,]\d{0,2})?$/.test(value.trim())) return;
    const salePrice = toNumber(value);
    if (salePrice === null) {
      setModal({
        ...modal,
        priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
      });
      return;
    }
    if (salePrice <= 0) return;

    const product = modal.product;
    const option = pricingOptions.find((item) => item.code === channelCode);
    if (!option) return;
    const normalizedOption = normalizeOption(option);
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    const { result } = calculatePriceWithMatchedShipping(
      product,
      normalizedOption,
      categoryFee,
      modal.taxOverrides,
      {
        salePrice,
        desiredMarginRate: effectiveMargin(channelCode),
        desiredNetProfit: null,
        structureAmount: modal.structureAmounts[channelCode] || 0,
        manualShippingAmount: modal.manualShippingAmounts[channelCode] || 0,
        salesCommissionRate: modal.salesCommissionRates[channelCode] || 0,
        saleAppliesVat:
          modal.saleAppliesVat[channelCode] ?? normalizedOption.applies_vat,
        costVatRate: modal.costVatRates[channelCode] || 0,
        roundTo: 100,
        roundingMode: "nearest",
      },
    );

    setModal({
      ...modal,
      mode: "margin",
      margins: {
        ...modal.margins,
        [channelCode]: result.valid
          ? Number((result.marginOnNetSale || 0).toFixed(2))
          : Number(modal.margins[channelCode] || 0),
      },
      netProfits: { ...modal.netProfits, [channelCode]: null },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: salePrice },
    });
  }

  function setSyncMode(syncMode: SyncMode) {
    if (!modal) return;
    setModal({ ...modal, syncMode });
  }

  function updateTaxOverride(
    field: keyof Pick<TaxSettings, "iibb_rate" | "idc_rate" | "iigg_rate">,
    value: string,
  ) {
    if (!modal) return;
    setModal({
      ...modal,
      taxOverrides: {
        ...modal.taxOverrides,
        [field]: Number(toNumber(value) ?? 0),
      },
    });
  }

  function resetTaxOverrides() {
    if (!modal) return;
    setModal({ ...modal, taxOverrides: { ...taxes } });
  }

  function updateChannelExtra(
    channelCode: string,
    field:
      | "structureAmounts"
      | "manualShippingAmounts"
      | "salesCommissionRates",
    value: string,
  ) {
    if (!modal) return;
    setModal({
      ...modal,
      [field]: {
        ...modal[field],
        [channelCode]: Number(toNumber(value) ?? 0),
      },
    });
  }

  function updateSaleAppliesVat(channelCode: string, checked: boolean) {
    if (!modal) return;
    setModal({
      ...modal,
      saleAppliesVat: {
        ...modal.saleAppliesVat,
        [channelCode]: checked,
      },
    });
  }

  function updateCostVatRate(channelCode: string, value: string) {
    if (!modal) return;
    const productVatRate = Number(modal.product.vat_rate || 21);
    const rate = Math.max(0, Math.min(productVatRate, Number(toNumber(value) ?? 0)));
    setModal({
      ...modal,
      costVatRates: {
        ...modal.costVatRates,
        [channelCode]: rate,
      },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
    });
  }

  function updatePromoDiscount(channelCode: string, value: string) {
    if (!modal) return;
    const discount = Math.max(0, Math.min(99.99, Number(toNumber(value) ?? 0)));
    setModal({
      ...modal,
      promoDiscountRates: {
        ...modal.promoDiscountRates,
        [channelCode]: discount,
      },
    });
  }

  function setSummaryChannel(channelCode: string) {
    if (!modal) return;
    setModal({ ...modal, summaryChannelCode: channelCode });
  }

  function modalRows() {
    if (!modal) return [];
    const product = modal.product;
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    return pricingOptions.map((option) => {
      const desiredNetProfit = effectiveNetProfit(option.code);
      const desiredMargin = effectiveMargin(option.code);
      const normalizedOption = normalizeOption(option);
      const feeForOption = normalizedOption.applies_marketplace_fee
        ? categoryFee
        : null;
      const salePriceOverride = modal.priceOverrides[option.code] ?? null;
      const scenario = calculatePriceWithMatchedShipping(
        product,
        normalizedOption,
        feeForOption,
        modal.taxOverrides,
        {
          desiredMarginRate: desiredMargin,
          desiredNetProfit,
          salePrice: salePriceOverride,
          structureAmount: modal.structureAmounts[option.code] || 0,
          manualShippingAmount: modal.manualShippingAmounts[option.code] || 0,
          salesCommissionRate: modal.salesCommissionRates[option.code] || 0,
          saleAppliesVat:
            modal.saleAppliesVat[option.code] ?? normalizedOption.applies_vat,
          costVatRate: modal.costVatRates[option.code] || 0,
          roundTo: 100,
          roundingMode: "nearest",
        },
      );
      const result = scenario.result;
      return {
        option: normalizedOption,
        categoryFee: feeForOption,
        shippingCost: scenario.shippingCost,
        result: result as any,
        desiredMargin,
        desiredNetProfit,
        displayDesiredMargin:
          desiredNetProfit !== null && (result as any).valid
            ? Number(((result as any).marginOnNetSale || 0).toFixed(2))
            : desiredMargin,
        displayDesiredNetProfit:
          desiredNetProfit !== null
            ? desiredNetProfit
            : (result as any).valid
              ? Number(((result as any).netProfit || 0).toFixed(2))
              : null,
        salePriceOverride,
      };
    });
  }

  function productKey(product: Product) {
    return product.id || product.sku;
  }

  function toggleProductExpanded(product: Product) {
    const key = productKey(product);
    const willExpand = !expandedProducts[key];
    setExpandedProducts((current) => ({ ...current, [key]: !current[key] }));

    // La tabla Comparar y actuar no debe quedar basada solamente en la foto
    // guardada. Al abrir un SKU refrescamos únicamente sus publicaciones ML;
    // así no se dispara una sincronización completa de todos los productos.
    if (willExpand) {
      void refreshProductFromMercadoLibre(product);
    }
  }

  function calculateRowsForProduct(product: Product) {
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    return pricingOptions.map((option) => {
      const normalizedOption = normalizeOption(option);
      const setting = getChannelSetting(product.id, normalizedOption.code);
      const feeForOption = normalizedOption.applies_marketplace_fee
        ? categoryFee
        : null;
      const scenario = calculatePriceWithMatchedShipping(
        product,
        normalizedOption,
        feeForOption,
        taxes,
        {
          desiredMarginRate: getMargin(product.id, normalizedOption.code),
          desiredNetProfit: getNetProfit(product.id, normalizedOption.code),
          salePrice: setting?.manual_sale_price ?? null,
          structureAmount: Number(setting?.structure_amount || 0),
          manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
          salesCommissionRate: allowsExtraSalesCommission(normalizedOption)
            ? Number(setting?.sales_commission_rate || 0)
            : 0,
          saleAppliesVat:
            setting?.sale_applies_vat ?? Boolean(normalizedOption.applies_vat),
          costVatRate: Number(setting?.cost_vat_rate || 0),
          roundTo: 100,
          roundingMode: "nearest",
        },
      );
      const result = scenario.result;
      const promoDiscountRate = isMercadoLibreChannel(normalizedOption)
        ? getPromoDiscount(product.id, normalizedOption.code)
        : 0;
      const promoPrice = result.valid
        ? promoListPrice(result.roundedPrice, promoDiscountRate)
        : null;
      return {
        option: normalizedOption,
        result,
        promoDiscountRate,
        promoPrice,
      };
    });
  }

  function meliContributionForPublication(publication: MercadoLibreShippingCost) {
    const explicitAmount = Number(publication.meli_promo_meli_amount || 0);
    if (explicitAmount > 0) return explicitAmount;
    const customerPrice = Number(publication.meli_promo_price || 0);
    const originalPrice = Number(publication.meli_original_price || publication.meli_price || 0);
    const meliRate = Number(publication.meli_promo_meli_rate || 0);
    const sellerRate = Number(publication.meli_promo_seller_rate || 0);
    const totalDiscount = Math.max(originalPrice - customerPrice, 0);
    return totalDiscount > 0 && meliRate > 0 && meliRate + sellerRate > 0
      ? (totalDiscount * meliRate) / (meliRate + sellerRate)
      : 0;
  }

  function activePublicationRowsForProduct(product: Product, configuredRows: any[]) {
    const categoryFee = categoryFees.find(
      (item) => item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    ) || null;
    return shippingsForProduct(product)
      .filter((publication) => publication.active !== false && publication.meli_status === "active" && publication.meli_item_id)
      .sort((a, b) => {
        const installments = Number(publicationInstallmentCount(a) || 99) - Number(publicationInstallmentCount(b) || 99);
        if (installments) return installments;
        return String(a.meli_item_id || "").localeCompare(String(b.meli_item_id || ""));
      })
      .map((publication) => {
        const option = configuredRows.find((row) => optionMatchesPublication(row.option, publication))?.option || mercadoLibreClassicOption();
        const setting = getChannelSetting(product.id, option.code);
        const promoActive = Number(publication.meli_promo_price || 0) > 0 && /started|active|vigente/.test(String(publication.meli_promo_status || "").toLowerCase());
        const customerPrice = Number((promoActive ? publication.meli_promo_price : publication.meli_price) || 0);
        const meliContribution = promoActive ? meliContributionForPublication(publication) : 0;
        const actualSale = customerPrice + meliContribution;
        const actualResult = actualSale > 0
          ? calculatePriceSummary(
            product,
            option,
            option.applies_marketplace_fee ? categoryFee : null,
            taxes,
            option.applies_shipping ? publication : null,
            {
              desiredMarginRate: 0,
              desiredNetProfit: null,
              structureAmount: Number(setting?.structure_amount || 0),
              manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
              salesCommissionRate: allowsExtraSalesCommission(option) ? Number(setting?.sales_commission_rate || 0) : 0,
              saleAppliesVat: setting?.sale_applies_vat ?? Boolean(option.applies_vat),
              costVatRate: Number(setting?.cost_vat_rate || 0),
              salePrice: actualSale,
              roundTo: 1,
              roundingMode: "nearest",
            },
          ) as any
          : null;
        const configured = configuredRows.find((row) => row.option.code === option.code);
        return {
          publication,
          option,
          configuredPrice: configured?.result?.valid ? Number(configured.result.roundedPrice || 0) : null,
          customerPrice,
          meliContribution,
          actualSale,
          actualMargin: actualResult?.valid ? Number(actualResult.marginOnNetSale || 0) : null,
        };
      });
  }

  function comparisonRowsForProduct(configuredRows: any[], liveRows: ReturnType<typeof activePublicationRowsForProduct>) {
    return configuredRows.map((configured) => {
      const publications = liveRows.filter((row) => row.option.code === configured.option.code);
      const configuredPrice = configured.result?.valid ? Number(configured.result.roundedPrice || 0) : null;
      const listPrices = publications.map((row) => Number(row.publication.meli_price || 0)).filter(Boolean);
      const customerPrices = publications.map((row) => Number(row.customerPrice || 0)).filter(Boolean);
      const margins = publications.map((row) => row.actualMargin).filter((value): value is number => value !== null);
      const promotionCount = publications.filter((row) => row.meliContribution > 0 || Number(row.publication.meli_promo_price || 0) > 0).length;
      const listMismatch = configuredPrice !== null && listPrices.some((price) => Math.abs(price - configuredPrice) > 1);
      return {
        ...configured,
        publications,
        configuredPrice,
        listPriceRange: listPrices.length ? { min: Math.min(...listPrices), max: Math.max(...listPrices) } : null,
        customerPriceRange: customerPrices.length ? { min: Math.min(...customerPrices), max: Math.max(...customerPrices) } : null,
        marginRange: margins.length ? { min: Math.min(...margins), max: Math.max(...margins) } : null,
        promotionCount,
        listMismatch,
      };
    });
  }

  function b2bRowsForProduct(product: Product, productRows: any[], publications: B2BPublication[]) {
    const mc = productRows.find((row) => row.option.code === "MC");
    if (!mc?.result?.valid) return [];
    const categoryFee = categoryFees.find(
      (item) => item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    ) || null;
    const setting = getChannelSetting(product.id, "MC");
    const targetBase = {
      desiredMarginRate: 0,
      desiredNetProfit: null,
      structureAmount: Number(setting?.structure_amount || 0),
      manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
      salesCommissionRate: 0,
      saleAppliesVat: setting?.sale_applies_vat ?? Boolean(mc.option.applies_vat),
      costVatRate: Number(setting?.cost_vat_rate || 0),
      roundTo: 1,
      roundingMode: "nearest" as const,
    };

    const rows = publications.flatMap((publication) => (publication.recommendations || []).map((recommendation) => {
      const quantity = Number(recommendation.quantity || 0);
      const totalShipping = Number(recommendation.shipping?.cost || 0);
      const shippingPerUnit = quantity > 0 ? totalShipping / quantity : 0;
      const sourcePublication = shippingCosts.find((item) => item.meli_item_id === publication.itemId)
        || shippingCostsForOption(product, mc.option)[0]
        || null;
      const b2bShipping = { ...(sourcePublication || {}), shipping_cost_amount: shippingPerUnit } as MercadoLibreShippingCost;
      const currentOnePay = calculatePriceSummary(
        product,
        mc.option,
        categoryFee,
        taxes,
        sourcePublication,
        {
          ...targetBase,
          salePrice: Number(publication.salePriceAmount || 0) + Number(publication.meliPromoContributionAmount || 0),
        },
      ) as any;
      const targetMargin = currentOnePay.valid
        ? Number(currentOnePay.marginOnNetSale || 0)
        : Number(mc.result.marginOnNetSale || 0);
      const target = { ...targetBase, desiredMarginRate: targetMargin, meliContributionAmount: Number(publication.meliPromoContributionAmount || 0) };
      const sameMarginResult = calculateB2bPriceSummary(product, mc.option, categoryFee, taxes, b2bShipping, target) as any;
      // El límite de ML y el precio final pertenecen a esta MLA. No se mezcla
      // con publicaciones espejo: pueden tener promo, aporte y márgenes propios.
      const maximumMeliPrice = Number(recommendation.amount || 0);
      const meliPromoContribution = Number(publication.meliPromoContributionAmount || 0);
      const recommendedResult = maximumMeliPrice > 0
        ? calculateB2bPriceSummary(product, mc.option, categoryFee, taxes, b2bShipping, {
          ...target,
          salePrice: maximumMeliPrice + meliPromoContribution,
        }) as any
        : null;
      // El precio que se carga en Negocios es el que ve el comprador. El aporte
      // compartido de ML se suma al cobro del vendedor, no al precio publicado.
      const requiredPrice = sameMarginResult.valid
        ? Math.max(Number(sameMarginResult.roundedPrice || 0) - meliPromoContribution, 0)
        : 0;
      const allowedAtSameMargin = Boolean(requiredPrice && maximumMeliPrice && requiredPrice <= maximumMeliPrice);
      const priceToActivate = allowedAtSameMargin ? requiredPrice : maximumMeliPrice;
      const marginAtCustomerPrice = (customerPrice: number) => {
        const result = calculateB2bPriceSummary(product, mc.option, categoryFee, taxes, b2bShipping, {
          ...target,
          salePrice: customerPrice + meliPromoContribution,
        }) as any;
        return result.valid ? Number(result.marginOnNetSale || 0) : null;
      };
      const existingRange = (publication.existingRanges || []).find(
        (range) => Number(range.conditions?.min_purchase_unit || 0) === quantity,
      );
      // Los rangos B2B de importe fijo son nodos "standard" y no incluyen
      // percentage. Leer sólo percentage hacía que la tabla dijera "Sin
      // activar" aun cuando Mercado Libre ya tenía el rango vigente.
      const activePrice = Number(existingRange?.amount || 0);
      const activePercentage = Number(existingRange?.percentage || 0);
      const isActive = activePrice > 0 || activePercentage > 0;
      const matchesSuggestedPrice = isActive && Math.abs(activePrice - priceToActivate) < 1;
      const hasFinalPromotion = Number(publication.salePriceAmount || 0) < Number(publication.standardAmount || 0) - 1;

      return {
        itemId: publication.itemId,
        quantity,
        totalShipping,
        shippingPerUnit,
        shippingSaving: Number(recommendation.shipping?.discount?.amount || 0),
        meliPromoContribution,
        maximumMeliPrice,
        requiredPrice,
        priceToActivate,
        targetMargin,
        marginAtPrice: allowedAtSameMargin
          ? Number(sameMarginResult.marginOnNetSale || 0)
          : recommendedResult?.valid ? Number(recommendedResult.marginOnNetSale || 0) : null,
        allowedAtSameMargin,
        isActive,
        activePrice,
        activePercentage,
        matchesSuggestedPrice,
        hasFinalPromotion,
        marginAtCustomerPrice,
        incoherent: Boolean(recommendation.is_incoherent_quantity),
      };
    }));

    // Cada MLA mantiene su propio resultado. El precio, la promoción, el
    // aporte y el envío pueden ser distintos aun dentro del mismo SKU.
    return rows;
  }

  function calculateMcPriceForProduct(product: Product) {
    const price = calculateMcRawPriceForProduct(product);
    return price ? moneyWithCents(price) : "-";
  }

  function calculateMcRawPriceForProduct(product: Product) {
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    const mcOption = mercadoLibreClassicOption();
    const { result } = calculatePriceWithMatchedShipping(
      product,
      mcOption,
      categoryFee,
      taxes,
      {
        desiredMarginRate: getMargin(product.id, "MC"),
        desiredNetProfit: getNetProfit(product.id, "MC"),
        salePrice: getChannelSetting(product.id, "MC")?.manual_sale_price ?? null,
        roundTo: 100,
        roundingMode: "nearest",
      },
    );
    return result.valid ? Number(result.roundedPrice || 0) : null;
  }

  const currentRows = modalRows();
  const mcRow = currentRows.find((row) => row.option.code === "MC");

  const b2bRows = (() => {
    if (!modal || !mcRow?.result?.valid || !b2bPublications) return [];
    const categoryFee = categoryFees.find(
      (item) => item.category?.toLowerCase() === (modal.product.category || "").toLowerCase(),
    ) || null;
    const targetBase = {
      desiredMarginRate: 0,
      desiredNetProfit: null,
      structureAmount: modal.structureAmounts.MC || 0,
      manualShippingAmount: modal.manualShippingAmounts.MC || 0,
      salesCommissionRate: 0,
      saleAppliesVat: modal.saleAppliesVat.MC ?? Boolean(mcRow.option.applies_vat),
      costVatRate: modal.costVatRates.MC || 0,
      roundTo: 1,
      roundingMode: "nearest" as const,
    };

    return b2bPublications.flatMap((publication) => (publication.recommendations || []).map((recommendation) => {
      const quantity = Number(recommendation.quantity || 0);
      const totalShipping = Number(recommendation.shipping?.cost || 0);
      const shippingPerUnit = quantity > 0 ? totalShipping / quantity : 0;
      const sourcePublication = shippingCosts.find((item) => item.meli_item_id === publication.itemId) || mcRow.shippingCost || null;
      const b2bShipping = {
        ...(sourcePublication || {}),
        shipping_cost_amount: shippingPerUnit,
      } as MercadoLibreShippingCost;
      const currentOnePay = calculatePriceSummary(
        modal.product,
        mcRow.option,
        categoryFee,
        modal.taxOverrides,
        sourcePublication,
        {
          ...targetBase,
          salePrice: Number(publication.salePriceAmount || 0) + Number(publication.meliPromoContributionAmount || 0),
        },
      ) as any;
      const target = {
        ...targetBase,
        meliContributionAmount: Number(publication.meliPromoContributionAmount || 0),
        desiredMarginRate: currentOnePay.valid
          ? Number(currentOnePay.marginOnNetSale || 0)
          : Number(mcRow.result.marginOnNetSale || 0),
      };
      const sameMargin = calculateB2bPriceSummary(
        modal.product,
        mcRow.option,
        categoryFee,
        modal.taxOverrides,
        b2bShipping,
        target,
      ) as any;
      const maximumMeliPrice = Number(recommendation.amount || 0);
      const meliPromoContribution = Number(publication.meliPromoContributionAmount || 0);
      const atMeliRecommendation = maximumMeliPrice > 0
        ? calculateB2bPriceSummary(
          modal.product,
          mcRow.option,
          categoryFee,
          modal.taxOverrides,
          b2bShipping,
          { ...target, salePrice: maximumMeliPrice + meliPromoContribution },
        ) as any
        : null;

      return {
        itemId: publication.itemId,
        quantity,
        totalShipping,
        shippingPerUnit,
        shippingOriginal: Number(recommendation.shipping?.original_cost || 0),
        shippingSaving: Number(recommendation.shipping?.discount?.amount || 0),
        meliPromoContribution,
        meliRecommendedPrice: maximumMeliPrice,
        requiredPrice: sameMargin.valid
          ? Math.max(Number(sameMargin.roundedPrice || 0) - meliPromoContribution, 0)
          : null,
        requiredMargin: sameMargin.valid ? Number(sameMargin.marginOnNetSale || 0) : null,
        recommendedMargin: atMeliRecommendation?.valid ? Number(atMeliRecommendation.marginOnNetSale || 0) : null,
        allowedAtSameMargin: sameMargin.valid && maximumMeliPrice > 0 && Math.max(Number(sameMargin.roundedPrice || 0) - meliPromoContribution, 0) <= maximumMeliPrice,
        incoherent: Boolean(recommendation.is_incoherent_quantity),
      };
    }));
  })();
  const selectedSummaryRow =
    currentRows.find(
      (row) => row.option.code === (modal?.summaryChannelCode || "MC"),
    ) || mcRow;
  const selectedChannelCode = selectedSummaryRow?.option.code || "MC";
  const selectedChannelName =
    selectedSummaryRow?.option.name || "MercadoLibre Clásica";
  const selectedMarginLocked = Boolean(
    modal && modal.syncMode === "margin" && selectedChannelCode !== "MC",
  );
  const selectedNetLocked = Boolean(
    modal && modal.syncMode === "net" && selectedChannelCode !== "MC",
  );
  const selectedPromoDiscount = modal
    ? Number(modal.promoDiscountRates[selectedChannelCode] || 0)
    : 0;
  const selectedPromoPrice = selectedSummaryRow?.result?.valid
    ? promoListPrice(
        selectedSummaryRow.result.roundedPrice,
        selectedPromoDiscount,
      )
    : null;
  const otherRows = currentRows.filter((row) => row.option.code !== "MC");

  function statusLabel(status?: string | null) {
    if (status === "active") return "Activo";
    if (status === "paused") return "Pausado";
    if (status === "discontinued") return "Discontinuado";
    return status || "-";
  }

  function marginClass(value: number) {
    if (value < 0) return "negative";
    return "positive";
  }

  function changeSort(key: PriceSortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "product" || key === "status" ? "asc" : "desc");
  }

  function SortIcon({ column }: { column: PriceSortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="idle-sort-icon" aria-hidden="true" />;
    return sortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />;
  }

  function SortButton({ column, children }: { column: PriceSortKey; children: ReactNode }) {
    return (
      <button className={`prices-sort-trigger ${sortKey === column ? "active" : ""}`} type="button" onClick={() => changeSort(column)}>
        {children}
        <SortIcon column={column} />
      </button>
    );
  }

  return (
    <main className="container wide prices-page">
      <PageHero
        title="Precios"
        description="Revisá costos, precios y rentabilidad de cada producto antes de actualizar tus canales de venta."
        icon={<Tags aria-hidden="true" />}
        onRefresh={loadData}
        onLogout={logout}
      />
      <PricingDataStatus state={dataLoad.state} publications={shippingCosts} onRefresh={() => loadData()} />

      {error && <div className="message error">{error}</div>}
      {message && <div className="message success">{message}</div>}

      <section className="prices-kpi-grid">
        <article className="kpi-card">
          <span className="kpi-label">Productos</span>
          <strong className="kpi-value">{dataLoad.initial ? "—" : priceKpis.total}</strong>
          <small className="kpi-meta">Cargados</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Con precio</span>
          <strong className="kpi-value">{dataLoad.initial ? "—" : priceKpis.priced}</strong>
          <small className="kpi-meta">Precio MC calculable</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Margen promedio</span>
          <strong className="kpi-value">{priceKpis.averageMargin !== null ? percent(priceKpis.averageMargin) : "-"}</strong>
          <small className="kpi-meta">Base MC</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Sin costo</span>
          <strong className="kpi-value">{dataLoad.initial ? "—" : priceKpis.withoutCost}</strong>
          <small className="kpi-meta">Requieren dato base</small>
        </article>
      </section>

      <section className="card filters-card prices-toolbar-card" style={{ marginBottom: 20 }}>
        <div className="prices-toolbar">
          <div className="field">
            <label>Buscar</label>
            <div className="search-control">
              <Search aria-hidden="true" />
              <input
                className="search-field"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar SKU, producto o MLA..."
              />
            </div>
          </div>
          <div className="field">
            <label>Categoría</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">Todas las categorías</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Estado</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Todos los estados</option>
              {productStatuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card products-table-card">
        <div className="prices-table-status">
          <div>
            <strong>{filteredProducts.length} de {products.length} productos</strong>
            {(query || categoryFilter || statusFilter) && <span> · filtros activos</span>}
          </div>
          {(query || categoryFilter || statusFilter) && (
            <button className="button ghost small-button" type="button" onClick={() => { setQuery(""); setCategoryFilter(""); setStatusFilter(""); }}>
              Limpiar filtros
            </button>
          )}
        </div>
        {dataLoad.initial ? (
          <p>Cargando productos...</p>
        ) : (
          <div className="table-wrap">
            <table className="products-list-table">
              <thead>
                <tr>
                  <th><SortButton column="product">Producto</SortButton></th>
                  <th className="numeric-header"><SortButton column="cost">Costo s/IVA</SortButton></th>
                  <th>IVA</th>
                  <th className="numeric-header"><SortButton column="margin">Margen base</SortButton></th>
                  <th className="numeric-header"><SortButton column="price">Precio MC</SortButton></th>
                  <th><SortButton column="status">Estado</SortButton></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const key = productKey(product);
                  const isExpanded = Boolean(expandedProducts[key]);
                  const productShippings = shippingsForProduct(product);
                  const thumbnail = productImage(productShippings);
                  const margin = getMargin(product.id, "MC");
                  const productRows = isExpanded
                    ? calculateRowsForProduct(product)
                    : [];
                  const livePublicationRows = isExpanded
                    ? activePublicationRowsForProduct(product, productRows)
                    : [];
                  const comparisonRows = isExpanded
                    ? comparisonRowsForProduct(productRows, livePublicationRows)
                    : [];
                  const activeExpandedTab = expandedPricingTabs[key] || "compare";
                  const wholesalePublications = b2bBySku[product.sku] || [];
                  const wholesaleRows = activeExpandedTab === "wholesale"
                    ? b2bRowsForProduct(product, productRows, wholesalePublications)
                    : [];
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td>
                          <div className="prices-product-cell">
                            <div className="product-thumb prices-product-thumb">
                              {thumbnail ? <img src={thumbnail} alt="" /> : productInitial(product)}
                            </div>
                            <div className="product-name-cell">
                              <strong>{product.name}</strong>
                              <span className="small">
                                {product.sku} · {product.category || "-"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="numeric-cell prices-cost-cell">{money(product.cost_without_vat)}</td>
                        <td>{product.vat_rate}%</td>
                        <td className={`numeric-cell prices-margin-cell ${marginClass(margin)}`}>{percent(margin)}</td>
                        <td className="numeric-cell prices-price-cell">
                          <strong>{calculateMcPriceForProduct(product)}</strong>
                        </td>
                        <td><span className={`badge prices-status-badge ${product.status}`}>{statusLabel(product.status)}</span></td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="button ghost small-button prices-expand-action"
                              onClick={() => toggleProductExpanded(product)}
                            >
                              {isExpanded ? <ChevronUp aria-hidden="true" /> : <SlidersHorizontal aria-hidden="true" />}
                              {isExpanded ? "Contraer" : "Ver canales"}
                            </button>
                            <button
                              className="button ghost small-button prices-edit-action"
                              onClick={() => openProductModal(product)}
                            >
                              <SlidersHorizontal aria-hidden="true" />
                              Editar precios
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${key}-channels`} className="expanded-row">
                          <td colSpan={7}>
                            <div className="channel-breakdown">
                              <SectionHeader
                                icon={<SlidersHorizontal aria-hidden="true" />}
                                title={activeExpandedTab === "wholesale" ? "Mercado Libre Negocios" : activeExpandedTab === "compare" ? "Comparar y actuar" : activeExpandedTab === "real" ? "Precio real en Mercado Libre" : "Configurar precios"}
                                description={activeExpandedTab === "wholesale" ? "Precios por cantidad, envío bonificado y rentabilidad neta por unidad." : activeExpandedTab === "compare" ? "Compará lo configurado contra cada cuota publicada y tomá acciones." : activeExpandedTab === "real" ? "Resultado vigente por publicación, promociones y aporte de Mercado Libre." : "Precios objetivo por canal para cargar en Mercado Libre."}
                                actions={
                                  activeExpandedTab === "channels" ? <>
                                    <button className="button small-button prices-publish-all-button" onClick={() => publishAllPricesToMercadoLibre(product, productRows)} disabled={publishingPriceChannel === `${product.sku}-all`}>
                                      <Upload aria-hidden="true" />
                                      {publishingPriceChannel === `${product.sku}-all` ? "Cargando precios..." : "Cargar todas en ML"}
                                    </button>
                                    <button className="button ghost small-button" onClick={() => refreshAdaraPromotion(product, productRows)} disabled={refreshingAdaraSku === product.sku}>
                                      <BadgePercent aria-hidden="true" />
                                      {refreshingAdaraSku === product.sku ? "Activando Adara..." : "Activar promo Adara"}
                                    </button>
                                  </> : activeExpandedTab === "wholesale" ? <button className="button small-button" onClick={() => loadB2bForProduct(product)} disabled={loadingB2bSku === product.sku}>
                                    <RefreshCw aria-hidden="true" />
                                    {loadingB2bSku === product.sku ? "Consultando ML..." : "Actualizar mayorista"}
                                  </button> : null
                                }
                              />
                              <div className="row-actions" style={{ marginBottom: 14 }}>
                                <button className={`button ghost small-button ${activeExpandedTab === "compare" ? "active" : ""}`} type="button" onClick={() => setExpandedPricingTabs((current) => ({ ...current, [key]: "compare" }))}>
                                  Comparar y actuar
                                </button>
                                <button className={`button ghost small-button ${activeExpandedTab === "channels" ? "active" : ""}`} type="button" onClick={() => setExpandedPricingTabs((current) => ({ ...current, [key]: "channels" }))}>
                                  Configurar precios
                                </button>
                                <button className={`button ghost small-button ${activeExpandedTab === "real" ? "active" : ""}`} type="button" onClick={() => setExpandedPricingTabs((current) => ({ ...current, [key]: "real" }))}>
                                  Precio real ML
                                </button>
                                <button className={`button ghost small-button ${activeExpandedTab === "wholesale" ? "active" : ""}`} type="button" onClick={() => { setExpandedPricingTabs((current) => ({ ...current, [key]: "wholesale" })); loadB2bForProduct(product); }}>
                                  Mayorista
                                </button>
                              </div>
                              {activeExpandedTab === "real" && (
                              <>
                              <div className="prices-live-publications">
                                <div className="prices-live-publications-head">
                                  <div>
                                    <strong>Publicaciones activas en Mercado Libre</strong>
                                    <span className="small">Resultado real por MLA. El precio configurado se mantiene separado del precio vigente y de los aportes de ML.</span>
                                  </div>
                                  <span className="small">{livePublicationRows.length} publicación{livePublicationRows.length === 1 ? "" : "es"}</span>
                                </div>
                                {livePublicationRows.length ? (
                                  <table className="nested-table prices-live-publications-table">
                                    <thead>
                                      <tr>
                                        <th>MLA / condición</th>
                                        <th>Precio configurado</th>
                                        <th>Precio lista ML</th>
                                        <th>Precio cliente</th>
                                        <th>Aporte ML</th>
                                        <th>Venta real</th>
                                        <th>Margen real</th>
                                        <th>Stock</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {livePublicationRows.map((row) => (
                                        <tr key={row.publication.meli_item_id}>
                                          <td>
                                            <strong>{row.publication.meli_item_id}</strong><br />
                                            <span className="small">{row.option.name}{row.publication.meli_logistic_type === "fulfillment" ? " · Full" : ""}</span>
                                          </td>
                                          <td>{row.configuredPrice ? moneyWithCents(row.configuredPrice) : "-"}</td>
                                          <td>{moneyWithCents(row.publication.meli_price || null)}</td>
                                          <td><strong>{row.customerPrice ? moneyWithCents(row.customerPrice) : "-"}</strong></td>
                                          <td className="positive">{row.meliContribution > 0 ? `+${moneyWithCents(row.meliContribution)}` : "-"}</td>
                                          <td><strong>{row.actualSale ? moneyWithCents(row.actualSale) : "-"}</strong></td>
                                          <td><span className={`prices-margin-pill ${row.actualMargin === null ? "" : marginClass(row.actualMargin)}`}>{row.actualMargin === null ? "-" : percent(row.actualMargin)}</span></td>
                                          <td>{Number(row.publication.meli_stock || 0)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : <p className="small">No hay publicaciones activas sincronizadas para este SKU.</p>}
                              </div>
                              </>
                              )}
                              {activeExpandedTab === "channels" && (
                              <>
                              <p className="prices-configured-prices-label">Precios configurados para cargar en Mercado Libre</p>
                              <table className="nested-table">
                                <thead>
                                  <tr>
                                    <th>Condición / canal</th>
                                    <th>Precio de venta</th>
                                    <th>Rentabilidad %</th>
                                    <th>Ganancia</th>
                                    <th>Desc. promo</th>
                                    <th>Precio promo</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {productRows.map(
                                    ({
                                      option,
                                      result,
                                      promoDiscountRate,
                                      promoPrice,
                                    }) => (
                                      <tr key={`${key}-${option.code}`}>
                                        <td>
                                          <strong>{option.code}</strong>
                                          <br />
                                          <span className="small">
                                            {option.name}
                                          </span>
                                        </td>
                                        <td>
                                          <strong>
                                            {result.valid
                                              ? moneyWithCents(
                                                  result.roundedPrice,
                                                )
                                              : "-"}
                                          </strong>
                                        </td>
                                        <td>
                                          <span className={`prices-margin-pill ${result.valid ? marginClass(result.marginOnNetSale) : ""}`}>
                                            {result.valid
                                              ? percent(result.marginOnNetSale)
                                              : "-"}
                                          </span>
                                        </td>
                                        <td>
                                          {result.valid
                                            ? moneyWithCents(result.netProfit)
                                            : "-"}
                                        </td>
                                        <td>
                                          {isMercadoLibreChannel(option)
                                            ? percent(promoDiscountRate)
                                            : "-"}
                                        </td>
                                        <td className="promo-price-cell">
                                          <strong>
                                            {isMercadoLibreChannel(option) &&
                                            promoPrice
                                              ? moneyWithCents(promoPrice)
                                              : "-"}
                                          </strong>
                                        </td>
                                        <td className="prices-publish-cell">
                                          {isMercadoLibreChannel(option) && result.valid ? (
                                            <button
                                              className="button ghost small-button prices-publish-button"
                                              onClick={() => publishPriceToMercadoLibre(product, option, result.roundedPrice, promoDiscountRate)}
                                              disabled={publishingPriceChannel === `${product.sku}-${option.code}`}
                                              title={promoDiscountRate > 0 ? "Carga el precio de lista necesario para conservar esta promoción." : "Carga este precio en las publicaciones de esta cuota."}
                                            >
                                              <Upload aria-hidden="true" />
                                              {publishingPriceChannel === `${product.sku}-${option.code}` ? "Cargando..." : "Cargar en ML"}
                                            </button>
                                          ) : "-"}
                                        </td>
                                      </tr>
                                    ),
                                  )}
                                </tbody>
                              </table>
                              </>
                              )}
                              {activeExpandedTab === "compare" && (
                                <div className="prices-comparison">
                                  <p className="small prices-comparison-intro">
                                    {refreshingProductSku === product.sku
                                      ? "Sincronizando las publicaciones activas de este SKU en Mercado Libre..."
                                      : "Una fila por cuota. Abrí el detalle sólo cuando necesitás revisar las MLA, promos, Full y stock."}
                                  </p>
                                  <table className="nested-table prices-comparison-table">
                                    <thead>
                                      <tr>
                                        <th>Cuota</th>
                                        <th>Configurado</th>
                                        <th>Precio cliente ML</th>
                                        <th>Margen real</th>
                                        <th>Estado</th>
                                        <th>Acciones</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {comparisonRows.map((row) => {
                                        const comparisonKey = `${key}-${row.option.code}`;
                                        const expandedComparison = Boolean(expandedComparisonRows[comparisonKey]);
                                        const priceRange = row.customerPriceRange;
                                        const marginRange = row.marginRange;
                                        return (
                                          <Fragment key={comparisonKey}>
                                            <tr>
                                              <td><strong>{row.option.code}</strong><br /><span className="small">{row.option.name}</span></td>
                                              <td><strong>{row.configuredPrice ? moneyWithCents(row.configuredPrice) : "-"}</strong></td>
                                              <td>
                                                {priceRange
                                                  ? priceRange.min === priceRange.max
                                                    ? moneyWithCents(priceRange.min)
                                                    : `${moneyWithCents(priceRange.min)} a ${moneyWithCents(priceRange.max)}`
                                                  : "-"}
                                              </td>
                                              <td>
                                                <span className={`prices-margin-pill ${marginRange ? marginClass(marginRange.min) : ""}`}>
                                                  {marginRange
                                                    ? marginRange.min === marginRange.max
                                                      ? percent(marginRange.min)
                                                      : `${percent(marginRange.min)} a ${percent(marginRange.max)}`
                                                    : "-"}
                                                </span>
                                              </td>
                                              <td>
                                                {!row.publications.length
                                                  ? refreshingProductSku === product.sku
                                                    ? <span className="small">Consultando Mercado Libre...</span>
                                                    : <span className="negative">Sin publicación activa</span>
                                                  : row.listMismatch
                                                    ? <span className="negative">Precio lista distinto · {row.publications.length} MLA</span>
                                                    : <span className="positive">En línea · {row.publications.length} MLA{row.promotionCount ? ` · ${row.promotionCount} con promo` : ""}</span>}
                                              </td>
                                              <td className="prices-comparison-actions">
                                                <button className="button ghost small-button" type="button" onClick={() => setExpandedComparisonRows((current) => ({ ...current, [comparisonKey]: !current[comparisonKey] }))}>
                                                  {expandedComparison ? "Ocultar" : "Ver MLA"}
                                                </button>
                                                <button className="button ghost small-button" type="button" onClick={() => setExpandedPricingTabs((current) => ({ ...current, [key]: "channels" }))}>
                                                  Configurar
                                                </button>
                                                {row.option.code === "MC" && (
                                                  <button className="button ghost small-button" type="button" onClick={() => { setExpandedPricingTabs((current) => ({ ...current, [key]: "wholesale" })); loadB2bForProduct(product); }}>
                                                    Mayorista
                                                  </button>
                                                )}
                                              </td>
                                            </tr>
                                            {expandedComparison && (
                                              <tr className="prices-comparison-detail-row">
                                                <td colSpan={6}>
                                                  {row.publications.length ? (
                                                    <table className="nested-table prices-comparison-detail-table">
                                                      <thead><tr><th>MLA</th><th>Lista ML</th><th>Cliente</th><th>Aporte ML</th><th>Venta real</th><th>Margen</th><th>Logística / stock</th></tr></thead>
                                                      <tbody>{row.publications.map((publicationRow) => (
                                                        <tr key={publicationRow.publication.meli_item_id}>
                                                          <td><strong>{publicationRow.publication.meli_item_id}</strong></td>
                                                          <td>{moneyWithCents(publicationRow.publication.meli_price || null)}</td>
                                                          <td>{moneyWithCents(publicationRow.customerPrice || null)}</td>
                                                          <td className="positive">{publicationRow.meliContribution ? `+${moneyWithCents(publicationRow.meliContribution)}` : "-"}</td>
                                                          <td><strong>{moneyWithCents(publicationRow.actualSale || null)}</strong></td>
                                                          <td>{publicationRow.actualMargin === null ? "-" : percent(publicationRow.actualMargin)}</td>
                                                          <td>{publicationRow.publication.meli_logistic_type === "fulfillment" ? "Full · " : ""}{Number(publicationRow.publication.meli_stock || 0)} u.</td>
                                                        </tr>
                                                      ))}</tbody>
                                                    </table>
                                                  ) : <span className="small">No hay MLA activa sincronizada para esta condición.</span>}
                                                </td>
                                              </tr>
                                            )}
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              {activeExpandedTab === "wholesale" && (
                                <>
                                  <p className="small" style={{ marginBottom: 12 }}>
                                    Margen objetivo sobre el precio final de 1 pago: <strong>{wholesaleRows.length ? percent(wholesaleRows[0].targetMargin) : "-"}</strong>. Cada precio propuesto vuelve a calcular comisión, IVA e impuestos; el envío se prorratea por unidad e incluye el aporte vigente de ML en promos compartidas.
                                  </p>
                                  {b2bErrorBySku[product.sku] && <span className="message error">{b2bErrorBySku[product.sku]}</span>}
                                  {!loadingB2bSku && !wholesalePublications.length && !b2bErrorBySku[product.sku] && <p className="small">Consultá Mercado Libre para ver los rangos mayoristas disponibles.</p>}
                                  {wholesaleRows.length > 0 && (
                                    <table className="nested-table">
                                      <thead>
                                        <tr>
                                          <th><input className="b2b-range-checkbox" type="checkbox" aria-label="Seleccionar todos los rangos" checked={wholesaleRows.filter((row) => !row.incoherent && row.priceToActivate > 0).length > 0 && wholesaleRows.filter((row) => !row.incoherent && row.priceToActivate > 0).every((row) => selectedB2bRanges[b2bRangeKey(product.sku, row.itemId, row.quantity)])} onChange={(event) => {
                                            const selectableKeys = wholesaleRows.filter((row) => !row.incoherent && row.priceToActivate > 0).map((row) => b2bRangeKey(product.sku, row.itemId, row.quantity));
                                            setSelectedB2bRanges((current) => ({ ...current, ...Object.fromEntries(selectableKeys.map((rangeKey) => [rangeKey, event.target.checked])) }));
                                          }} /></th><th>MLA</th><th>Cantidad</th><th>Precio por unidad</th><th>Aporte promo ML</th><th>Rentabilidad</th><th>Envío total</th><th>Bonif. envío ML</th><th>Envío / unidad</th><th>Estado B2B</th><th>Resultado</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {wholesaleRows.map((row) => {
                                          const rangeKey = b2bRangeKey(product.sku, row.itemId, row.quantity);
                                          return (
                                            <tr key={rangeKey}>
                                              <td><input className="b2b-range-checkbox" type="checkbox" checked={Boolean(selectedB2bRanges[rangeKey])} disabled={row.incoherent || !row.priceToActivate} onChange={(event) => setSelectedB2bRanges((current) => ({ ...current, [rangeKey]: event.target.checked }))} /></td>
                                              <td><strong>{row.itemId}</strong></td>
                                              <td>{row.quantity} u.</td>
                                              <td><strong>{moneyWithCents(row.priceToActivate)}</strong></td>
                                              <td className="positive"><strong>{row.meliPromoContribution > 0 ? `+${moneyWithCents(row.meliPromoContribution)}` : "-"}</strong></td>
                                              <td><span className={`prices-margin-pill ${marginClass(Number(row.marginAtPrice || 0))}`}>{row.marginAtPrice === null ? "-" : percent(row.marginAtPrice)}</span></td>
                                              <td>{moneyWithCents(row.totalShipping)}</td>
                                              <td className="positive"><strong>{row.shippingSaving > 0 ? `-${moneyWithCents(row.shippingSaving)}` : "-"}</strong></td>
                                              <td>{moneyWithCents(row.shippingPerUnit)}</td>
                                              <td><span className={`prices-margin-pill ${row.isActive ? "positive" : ""}`}>{row.isActive ? row.activePrice > 0 ? row.matchesSuggestedPrice ? "Activo" : `Activo · ${moneyWithCents(row.activePrice)}` : `Activo · ${row.activePercentage.toFixed(2)}%` : "Sin activar"}</span></td>
                                              <td>{row.incoherent ? "No permitido" : row.isActive && !row.hasFinalPromotion ? "Revisar: sin promo vigente" : row.allowedAtSameMargin ? "Mantiene margen" : `ML exige descuento · objetivo ${percent(row.targetMargin)}`}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  )}
                                  {wholesaleRows.length > 0 && (() => {
                                    const selectedRows = wholesaleRows.filter((row) => selectedB2bRanges[b2bRangeKey(product.sku, row.itemId, row.quantity)] && !row.incoherent && row.priceToActivate > 0);
                                    const activationGroups = [...new Set(selectedRows.map((row) => row.itemId))]
                                      .map((itemId) => ({
                                        itemId,
                                        rows: selectedRows
                                          .filter((row) => row.itemId === itemId)
                                          .map((row) => ({ quantity: row.quantity, price: row.priceToActivate, targetMargin: row.targetMargin })),
                                      }))
                                      .filter((group) => group.rows.length > 0);
                                    const deactivationGroups = [...new Set(selectedRows.filter((row) => row.isActive).map((row) => row.itemId))]
                                      .map((itemId) => ({ itemId, quantities: selectedRows.filter((row) => row.itemId === itemId && row.isActive).map((row) => row.quantity) }))
                                      .filter((group) => group.quantities.length > 0);
                                    const selectedCount = selectedRows.length;
                                    const activationCount = activationGroups.reduce((total, group) => total + group.rows.length, 0);
                                    const deactivationCount = deactivationGroups.reduce((total, group) => total + group.quantities.length, 0);
                                    return (
                                      <div className="prices-b2b-footer">
                                        <span className="small">{selectedCount ? `${selectedCount} rango${selectedCount === 1 ? "" : "s"} seleccionado${selectedCount === 1 ? "" : "s"} · ${deactivationCount} activos` : "Usá el check del encabezado para seleccionar todos los rangos."}</span>
                                        <button className="button ghost small-button" type="button" disabled={!deactivationCount || Boolean(savingB2bItem)} onClick={() => deactivateSelectedB2bRanges(product, deactivationGroups)}>
                                          {savingB2bItem ? "Actualizando..." : "Desactivar seleccionados"}
                                        </button>
                                        <button className="button small-button" type="button" disabled={!activationCount || Boolean(savingB2bItem)} onClick={() => activateSelectedB2bRanges(product, activationGroups)}>
                                          <BadgePercent aria-hidden="true" />
                                          {savingB2bItem ? "Aplicando..." : "Aplicar / actualizar seleccionados"}
                                        </button>
                                      </div>
                                    );
                                  })()}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={7}>No se encontraron productos.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <div className="modal-backdrop pricing-backdrop">
          <div className="modal-card pricing-modal-v2">
            <div className="pricing-modal-header">
              <div>
                <h2>{modal.product.name}</h2>
                <p className="pricing-modal-meta">
                  SKU {modal.product.sku} <span>·</span> Categoría {modal.product.category || "sin categoría"} <span>·</span> Costo {money(modal.product.cost_without_vat)} <span>·</span> IVA {modal.product.vat_rate}%
                </p>
                <p className="pricing-modal-help">
                  Ajustá margen, precio de venta, comisiones, envío manual y estructura para analizar rentabilidad.
                </p>
                <div className={`meli-product-sync ${refreshingProductSku === modal.product.sku ? "loading" : ""}`}>
                  <RefreshCw aria-hidden="true" />
                  <span>{productSyncMessage || "Al abrir este producto se actualizan precio, envio, comisiones y promociones desde MercadoLibre."}</span>
                </div>
              </div>
              <button className="modal-close-button" onClick={() => setModal(null)} aria-label="Cerrar">
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="pricing-modal-body">
              <div className="pricing-top-grid">
                <section className="pricing-card pricing-card-blue">
                <div className="pricing-card-title">
                  <span className="section-icon blue"><SlidersHorizontal aria-hidden="true" /></span>
                  <h3>Condición seleccionada</h3>
                </div>

                <div className="field">
                  <label>Canal</label>
                  <select
                    value={modal.summaryChannelCode}
                    onChange={(e) => setSummaryChannel(e.target.value)}
                  >
                    {currentRows.map((row) => (
                      <option key={row.option.code} value={row.option.code}>
                        {row.option.code} - {row.option.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="linked-fields">
                  <div className="field">
                    <label>Margen deseado %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(selectedSummaryRow?.displayDesiredMargin ?? effectiveMargin(selectedChannelCode))}
                      onChange={(e) => updateMargin(selectedChannelCode, e.target.value)}
                      disabled={modal.syncMode === "net" || selectedMarginLocked}
                      className={modal.syncMode === "net" || selectedMarginLocked ? "input-disabled" : ""}
                    />
                  </div>
                  <span className="link-pill" title="Precio y margen vinculados">↔</span>
                  <div className="field">
                    <label>Ganancia neta objetivo</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(selectedSummaryRow?.displayDesiredNetProfit ?? effectiveNetProfit(selectedChannelCode))}
                      placeholder="Opcional"
                      onChange={(e) => updateNetProfit(selectedChannelCode, e.target.value)}
                      disabled={modal.syncMode === "margin" || selectedNetLocked}
                      className={modal.syncMode === "margin" || selectedNetLocked ? "input-disabled" : ""}
                    />
                  </div>
                </div>

                <div className="sync-hint">
                  <RefreshCw aria-hidden="true" />
                  <span><strong>Valores vinculados</strong> Margen, ganancia objetivo y precio se recalculan entre sí.</span>
                </div>

                <div className="sync-options polished-sync-options">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={modal.syncMode === "margin"}
                      onChange={(e) => setSyncMode(e.target.checked ? "margin" : "none")}
                    />
                    <span>Aplicar % a todos</span>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={modal.syncMode === "net"}
                      onChange={(e) => setSyncMode(e.target.checked ? "net" : "none")}
                    />
                    <span>Aplicar margen a todos</span>
                  </label>
                </div>
                <p className="small">
                  Si elegís otro canal en el resumen, estos campos modifican ese canal. Si activás aplicar a todos, las demás condiciones toman el valor de MC y quedan bloqueadas.
                </p>
                </section>

                <section className="pricing-card pricing-card-green">
                <div className="pricing-card-title">
                  <span className="section-icon green"><ReceiptText aria-hidden="true" /></span>
                  <h3>Impuestos para esta prueba</h3>
                </div>
                <p className="small">Estos valores modifican solo este cálculo. No cambian la solapa Impuestos.</p>
                <div className="even-input-grid">
                  <div className="field">
                    <label>IIBB %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(modal.taxOverrides.iibb_rate)}
                      onChange={(e) => updateTaxOverride("iibb_rate", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>IDC %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(modal.taxOverrides.idc_rate)}
                      onChange={(e) => updateTaxOverride("idc_rate", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>IIGG %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(modal.taxOverrides.iigg_rate)}
                      onChange={(e) => updateTaxOverride("iigg_rate", e.target.value)}
                    />
                  </div>
                </div>
                <button className="button ghost tax-reset-button accent-green" type="button" onClick={resetTaxOverrides}>
                  Restablecer impuestos globales
                </button>
                </section>

                <section className="pricing-card pricing-card-purple">
                <div className="pricing-card-title">
                  <span className="section-icon purple"><BadgePercent aria-hidden="true" /></span>
                  <h3>Costos extra del canal elegido</h3>
                </div>
                <p className="small">Estos valores aplican solo al canal seleccionado en el resumen.</p>

                {selectedSummaryRow?.result?.valid ? (
                  <div className="even-input-grid">
                    {!isMercadoLibreChannel(selectedSummaryRow.option) && (
                      <div className="field">
                        <label>IVA atribuido al costo %</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatInputNumber(modal.costVatRates[selectedSummaryRow.option.code] || 0)}
                          onChange={(e) => updateCostVatRate(selectedSummaryRow.option.code, e.target.value)}
                        />
                        <span className="small">Máximo: {percent(modal.product.vat_rate)}</span>
                      </div>
                    )}
                    {isMercadoLibreChannel(selectedSummaryRow.option) && (
                      <>
                        <div className="field">
                          <label>Descuento promo %</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={formatInputNumber(modal.promoDiscountRates[selectedSummaryRow.option.code] || 0)}
                            onChange={(e) => updatePromoDiscount(selectedSummaryRow.option.code, e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label>Precio promo publicado</label>
                          <input
                            type="text"
                            value={selectedPromoPrice ? formatInputNumber(selectedPromoPrice, 0) : ""}
                            readOnly
                            className="input-disabled"
                          />
                        </div>
                      </>
                    )}
                    {allowsExtraSalesCommission(selectedSummaryRow.option) && (
                      <div className="field">
                        <label>Comisión venta %</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatInputNumber(modal.salesCommissionRates[selectedSummaryRow.option.code] || 0)}
                          onChange={(e) => updateChannelExtra(selectedSummaryRow.option.code, "salesCommissionRates", e.target.value)}
                        />
                      </div>
                    )}
                    {!selectedSummaryRow.option.applies_shipping && (
                      <div className="field">
                        <label>Envío manual $</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatInputNumber(modal.manualShippingAmounts[selectedSummaryRow.option.code] || 0, 0)}
                          onChange={(e) => updateChannelExtra(selectedSummaryRow.option.code, "manualShippingAmounts", e.target.value)}
                        />
                      </div>
                    )}
                    <div className="field">
                      <label>Estructura $</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={formatInputNumber(modal.structureAmounts[selectedSummaryRow.option.code] || 0, 0)}
                        onChange={(e) => updateChannelExtra(selectedSummaryRow.option.code, "structureAmounts", e.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <span className="message error">No se pudo calcular el canal seleccionado.</span>
                )}
                </section>

                <aside className="pricing-card summary-panel-v2">
                <div className="pricing-card-title summary-title-row">
                  <span className="section-icon neutral"><CircleDollarSign aria-hidden="true" /></span>
                  <h3>Resumen</h3>
                </div>
                <div className="field">
                  <select
                    value={modal.summaryChannelCode}
                    onChange={(e) => setSummaryChannel(e.target.value)}
                  >
                    {currentRows.map((row) => (
                      <option key={row.option.code} value={row.option.code}>
                        {row.option.code} - {row.option.name}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedSummaryRow?.result?.valid ? (
                  <div className="summary-content-v2">
                    <div className="summary-kpi-grid">
                      <div className="field summary-price-field summary-kpi-card full">
                        <label>Precio de venta</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={salePriceInputDrafts[selectedSummaryRow.option.code] ?? formatInputNumber(
                            modal.priceOverrides[selectedSummaryRow.option.code] ?? selectedSummaryRow.result.roundedPrice,
                            2,
                          )}
                          onChange={(e) => updateSalePrice(selectedSummaryRow.option.code, e.target.value)}
                          onBlur={() => finishSalePriceInput(selectedSummaryRow.option.code)}
                        />
                      </div>
                      <div className={`summary-kpi-card result ${marginClass(selectedSummaryRow.result.marginOnNetSale)}`}>
                        <span>Ganancia</span>
                        <strong>{moneyWithCents(selectedSummaryRow.result.netProfit)}</strong>
                      </div>
                      <div className={`summary-kpi-card result ${marginClass(selectedSummaryRow.result.marginOnNetSale)}`}>
                        <span>Margen real</span>
                        <strong>{percent(selectedSummaryRow.result.marginOnNetSale)}</strong>
                      </div>
                    </div>
                    <span className="sync-hint compact-hint"><RefreshCw aria-hidden="true" /> Vinculado con el margen deseado %</span>
                    {isMercadoLibreChannel(selectedSummaryRow.option) && (
                      <>
                        <div className="summary-line"><span>Descuento promo</span><strong>{percent(selectedPromoDiscount)}</strong></div>
                        <div className="summary-line"><span>Precio promo publicado</span><strong>{selectedPromoPrice ? moneyWithCents(selectedPromoPrice) : "-"}</strong></div>
                      </>
                    )}
                    <div className="summary-line debit"><span>IVA venta</span><strong>-{moneyWithCents(selectedSummaryRow.result.vatAmount)}</strong></div>
                    <div className="summary-line"><span>Precio sin IVA</span><strong>{moneyWithCents(selectedSummaryRow.result.netSalePrice)}</strong></div>
                    <div className="summary-line debit"><span>Comisión canal</span><strong>-{moneyWithCents(selectedSummaryRow.result.marketplaceFeeAmount)}</strong></div>
                    {allowsExtraSalesCommission(selectedSummaryRow.option) && (
                      <div className="summary-line debit"><span>Comisión venta extra</span><strong>-{moneyWithCents(selectedSummaryRow.result.salesCommissionAmount)}</strong></div>
                    )}
                    <div className="summary-line debit"><span>Ingresos brutos</span><strong>-{moneyWithCents(selectedSummaryRow.result.iibbAmount)}</strong></div>
                    <div className="summary-divider" />
                    <div className="summary-line debit"><span>Envío s/IVA</span><strong>-{moneyWithCents(selectedSummaryRow.result.shippingCostAmount)}</strong></div>
                    <div className="summary-line debit"><span>Fijo ML s/IVA</span><strong>-{moneyWithCents(selectedSummaryRow.result.fixedFeeAmount || 0)}</strong></div>
                    <div className="summary-line debit"><span>Gasto de estructura</span><strong>-{moneyWithCents(selectedSummaryRow.result.structureAmount)}</strong></div>
                    <div className="summary-line debit"><span>IVA atribuido al costo</span><strong>-{moneyWithCents(selectedSummaryRow.result.costVatAmount || 0)}</strong></div>
                    <div className="summary-line debit"><span>Costo usado</span><strong>-{moneyWithCents(selectedSummaryRow.result.costForProfit)}</strong></div>
                    <div className="summary-divider" />
                    <div className="summary-line"><span>Margen bruto</span><strong>{moneyWithCents(selectedSummaryRow.result.grossProfit)}</strong></div>
                    <div className="summary-line debit"><span>Imp. Ganancias</span><strong>-{moneyWithCents(selectedSummaryRow.result.incomeTaxAmount)}</strong></div>
                  </div>
                ) : (
                  <span className="message error">
                    {selectedSummaryRow?.result?.error || "No se pudo calcular el resumen."}
                  </span>
                )}
                </aside>
              </div>

              <section className="pricing-conditions-card">
                <div className="pricing-conditions-header">
                  <div>
                    <h3>Mercado Libre Negocios · precios por cantidad</h3>
                    <p className="small">
                      Usa la bonificación real de envío que informa ML y el aporte vigente de ML cuando la promoción es compartida. Comisión, IVA e impuestos se recalculan sobre cada precio mayorista.
                    </p>
                  </div>
                  <button className="button ghost small-button" type="button" onClick={loadB2bRecommendations} disabled={loadingB2b}>
                    <RefreshCw aria-hidden="true" />
                    {loadingB2b ? "Calculando Negocios..." : "Calcular Negocios"}
                  </button>
                </div>
                <p className="small">
                  Margen objetivo 1 pago: <strong>{mcRow?.result?.valid ? percent(mcRow.result.marginOnNetSale) : "-"}</strong>. El precio recomendado por ML es el máximo permitido para cada rango; si no alcanza para el margen objetivo, se informa el margen real posible.
                </p>
                {b2bError && <span className="message error">{b2bError}</span>}
                {b2bPublications && !b2bRows.length && (
                  <p className="small">Mercado Libre no devolvió rangos B2B para esta publicación.</p>
                )}
                {b2bRows.length > 0 && (
                  <div className="table-wrap polished-table-wrap">
                    <table className="pricing-conditions-table">
                      <thead>
                        <tr>
                          <th>Publicación</th>
                          <th>Cantidad</th>
                          <th>Envío B2B total</th>
                          <th>Envío por unidad</th>
                          <th>Ahorro envío</th>
                          <th>Aporte promo ML</th>
                          <th>Máx. precio ML</th>
                          <th>Precio p/ mismo margen</th>
                          <th>Margen con precio ML</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b2bRows.map((row) => (
                          <tr key={`${row.itemId}-${row.quantity}`}>
                            <td><strong>{row.itemId}</strong></td>
                            <td>{row.quantity} u.</td>
                            <td>{moneyWithCents(row.totalShipping)}</td>
                            <td>{moneyWithCents(row.shippingPerUnit)}</td>
                            <td className="positive">{moneyWithCents(row.shippingSaving)}</td>
                            <td className="positive">{row.meliPromoContribution > 0 ? `+${moneyWithCents(row.meliPromoContribution)}` : "-"}</td>
                            <td><strong>{moneyWithCents(row.meliRecommendedPrice)}</strong></td>
                            <td>{row.requiredPrice ? moneyWithCents(row.requiredPrice) : "-"}</td>
                            <td className={marginClass(row.recommendedMargin || 0)}>{row.recommendedMargin === null ? "-" : percent(row.recommendedMargin)}</td>
                            <td>
                              {row.incoherent
                                ? <span className="message error">Rango incoherente</span>
                                : row.allowedAtSameMargin
                                  ? <span className="prices-margin-pill positive">Mantiene margen</span>
                                  : <span className="prices-margin-pill negative">ML exige más descuento</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="pricing-conditions-card">
              <div className="pricing-conditions-header">
                <div>
                  <h3>Condiciones de venta</h3>
                  <p className="small">Editá margen, precio, promo, IVA costo y extras por canal.</p>
                </div>
              </div>
              <div className="table-wrap polished-table-wrap">
                <table className="pricing-conditions-table">
                  <thead>
                    <tr>
                      <th>Condición / canal</th>
                      <th>Margen deseado %</th>
                      <th>Ganancia neta objetivo</th>
                      <th>Precio de venta</th>
                      <th>Descuento promo</th>
                      <th>Precio promo</th>
                      <th>IVA costo</th>
                      <th>Comisión venta</th>
                      <th>Envío manual</th>
                      <th>Estructura</th>
                      <th>Ganancia</th>
                      <th>Margen real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRows.map(({ option, result, displayDesiredMargin, displayDesiredNetProfit }) => {
                      const lockMargin = modal.syncMode === "margin" && option.code !== "MC";
                      const lockNet = modal.syncMode === "net" && option.code !== "MC";
                      const rowSelected = option.code === selectedChannelCode;

                      return (
                        <tr key={option.code} className={rowSelected ? "selected-channel-row" : ""}>
                          <td>
                            <div className="channel-name-cell">
                              <span className={`channel-badge channel-badge-${option.code.toLowerCase()}`}>{option.code}</span>
                              <div>
                                <strong>{option.code}</strong>
                                <span>{option.name}</span>
                              </div>
                            </div>
                          </td>
                          <td style={{ minWidth: 130 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatInputNumber(displayDesiredMargin)}
                              onChange={(e) => updateMargin(option.code, e.target.value)}
                              disabled={lockMargin || lockNet}
                              className={lockMargin || lockNet ? "input-disabled" : ""}
                            />
                          </td>
                          <td style={{ minWidth: 150 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatInputNumber(displayDesiredNetProfit)}
                              placeholder="Opcional"
                              onChange={(e) => updateNetProfit(option.code, e.target.value)}
                              disabled={lockMargin || lockNet}
                              className={lockMargin || lockNet ? "input-disabled" : ""}
                            />
                          </td>
                          <td className="price-input-cell" style={{ minWidth: 150 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={salePriceInputDrafts[option.code] ?? formatInputNumber(
                                modal.priceOverrides[option.code] ?? (result.valid ? result.roundedPrice : null),
                                2,
                              )}
                              onChange={(e) => updateSalePrice(option.code, e.target.value)}
                              onBlur={() => finishSalePriceInput(option.code)}
                              disabled={lockMargin || lockNet}
                              className={lockMargin || lockNet ? "input-disabled" : ""}
                            />
                          </td>
                          <td style={{ minWidth: 120 }}>
                            {isMercadoLibreChannel(option) ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatInputNumber(modal.promoDiscountRates[option.code] || 0)}
                                onChange={(e) => updatePromoDiscount(option.code, e.target.value)}
                              />
                            ) : (
                              <span className="not-applicable">—</span>
                            )}
                          </td>
                          <td style={{ minWidth: 130 }}>
                            {isMercadoLibreChannel(option) && result.valid
                              ? moneyWithCents(promoListPrice(result.roundedPrice, modal.promoDiscountRates[option.code] || 0))
                              : "-"}
                          </td>
                          <td style={{ minWidth: 110 }}>
                            {!isMercadoLibreChannel(option) ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatInputNumber(modal.costVatRates[option.code] || 0)}
                                onChange={(e) => updateCostVatRate(option.code, e.target.value)}
                              />
                            ) : (
                              <span className="not-applicable">—</span>
                            )}
                          </td>
                          <td style={{ minWidth: 120 }}>
                            {allowsExtraSalesCommission(option) ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatInputNumber(modal.salesCommissionRates[option.code] || 0)}
                                onChange={(e) => updateChannelExtra(option.code, "salesCommissionRates", e.target.value)}
                              />
                            ) : (
                              <span className="not-applicable">—</span>
                            )}
                          </td>
                          <td style={{ minWidth: 120 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatInputNumber(modal.manualShippingAmounts[option.code] || 0, 0)}
                              onChange={(e) => updateChannelExtra(option.code, "manualShippingAmounts", e.target.value)}
                              disabled={Boolean(option.applies_shipping)}
                              className={option.applies_shipping ? "input-disabled" : ""}
                            />
                          </td>
                          <td style={{ minWidth: 120 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatInputNumber(modal.structureAmounts[option.code] || 0, 0)}
                              onChange={(e) => updateChannelExtra(option.code, "structureAmounts", e.target.value)}
                            />
                          </td>
                          <td className="numeric-cell">{result.valid ? moneyWithCents(result.netProfit) : "-"}</td>
                          <td className="numeric-cell">
                            {result.valid ? (
                              <span className={`prices-margin-pill ${marginClass(result.marginOnNetSale)}`}>
                                {percent(result.marginOnNetSale)}
                              </span>
                            ) : result.error}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </section>
            </div>

            <div className="pricing-modal-footer">
              <button className="button ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <div className="actions">
                <button className="button ghost" disabled={saving} onClick={saveMargins}>
                  {saving ? "Guardando..." : "Guardar como borrador"}
                </button>
                <button
                  className="button"
                  disabled={saving}
                  onClick={async () => {
                    if (await saveMargins()) setModal(null);
                  }}
                >
                  {saving ? "Guardando..." : "Guardar y cerrar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
