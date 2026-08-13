"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  SearchX,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import {
  calculatePriceSummary,
  defaultTaxSettings,
  mercadoLibreClassicOption,
  moneyWithCents,
  percent,
  toNumber,
} from "@/lib/pricing";
import type {
  MercadoLibreCategoryFee,
  MercadoLibreInstallmentFee,
  MercadoLibrePriceOption,
  MercadoLibreShippingCost,
  Product,
  TaxSettings,
} from "@/lib/types";

type VatCondition = "sin_factura" | "iva_21" | "iva_105";
type LastEdited = "margin" | "price";

type SimulationForm = {
  productName: string;
  provider: string;
  category: string;
  publicationUrl: string;
  costWithoutVat: string;
  desiredMarginRate: string;
  salePrice: string;
  vatCondition: VatCondition;
  shippingGross: string;
};

type SavedSimulation = {
  id: string;
  name: string;
  provider?: string | null;
  category: string | null;
  cost_without_vat: number;
  desired_margin_rate: number;
  sale_price: number;
  vat_condition: VatCondition;
  shipping_gross: number;
  publication_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const initialForm: SimulationForm = {
  productName: 'Smart TV Enova 43" Google TV',
  provider: "",
  category: "TV",
  publicationUrl: "",
  costWithoutVat: "241332",
  desiredMarginRate: "12",
  salePrice: "317000",
  vatCondition: "iva_21",
  shippingGross: "0",
};

const channelOrder = ["MC", "MP3", "MP6", "MP9", "MP12", "EF"];
type SimulationDateFilter = "all" | "today" | "7d" | "30d" | "older";
type SimulationSortKey =
  | "updated_desc"
  | "updated_asc"
  | "name_asc"
  | "name_desc"
  | "provider_asc"
  | "category_asc"
  | "cost_desc"
  | "cost_asc"
  | "price_desc"
  | "price_asc";

function orderChannels<T extends { code: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const ai = channelOrder.indexOf(a.code);
    const bi = channelOrder.indexOf(b.code);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.code.localeCompare(b.code);
  });
}

function vatRateFromCondition(condition: VatCondition): 21 | 10.5 {
  return condition === "iva_105" ? 10.5 : 21;
}

function saleAppliesVat(condition: VatCondition) {
  return condition !== "sin_factura";
}

function statusLabel(margin?: number | null) {
  const value = Number(margin || 0);
  if (value < 0) return { label: "Negativo", className: "negative" };
  if (value < 3) return { label: "Límite", className: "warning" };
  return { label: "Rentable", className: "positive" };
}

function formatPercentInput(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return Number(value).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function vatConditionFromProduct(product: Product): VatCondition {
  return Number(product.vat_rate || 21) === 10.5 ? "iva_105" : "iva_21";
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

function normalizeSearch(value?: string | number | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function dateFilterMatches(value: string | null | undefined, filter: SimulationDateFilter) {
  if (filter === "all") return true;
  if (!value) return filter === "older";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return filter === "older";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();
  const ageMs = now.getTime() - time;
  const dayMs = 24 * 60 * 60 * 1000;

  if (filter === "today") return time >= startOfToday;
  if (filter === "7d") return ageMs <= 7 * dayMs;
  if (filter === "30d") return ageMs <= 30 * dayMs;
  return ageMs > 30 * dayMs;
}

function compareText(a?: string | null, b?: string | null) {
  return String(a || "").localeCompare(String(b || ""), "es", { sensitivity: "base" });
}

function isCurrentShippingCost(shipping: MercadoLibreShippingCost) {
  return shipping.active !== false && shipping.meli_status !== "closed";
}

export default function SimulatorPage() {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState<SimulationForm>(initialForm);
  const [lastEdited, setLastEdited] = useState<LastEdited>("price");
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categories, setCategories] = useState<MercadoLibreCategoryFee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [shippingCosts, setShippingCosts] = useState<MercadoLibreShippingCost[]>([]);
  const [savedSimulations, setSavedSimulations] = useState<SavedSimulation[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [loading, setLoading] = useState(true);
  const [savingSimulation, setSavingSimulation] = useState(false);
  const [simulationLibraryOpen, setSimulationLibraryOpen] = useState(false);
  const [baseDetailsOpen, setBaseDetailsOpen] = useState(false);
  const [loadedSimulation, setLoadedSimulation] = useState<SavedSimulation | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryProviderFilter, setLibraryProviderFilter] = useState("");
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState("");
  const [libraryDateFilter, setLibraryDateFilter] = useState<SimulationDateFilter>("all");
  const [librarySort, setLibrarySort] = useState<SimulationSortKey>("updated_desc");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function loadData() {
    setLoading(true);
    setError(null);

    const [channelsResponse, categoriesResponse, taxesResponse, productsResponse, shippingResponse, savedResponse] = await Promise.all([
      supabase
        .from("mercadolibre_installment_fees")
        .select("*")
        .eq("active", true),
      supabase
        .from("mercadolibre_category_fees")
        .select("*")
        .eq("active", true)
        .order("category", { ascending: true }),
      supabase
        .from("tax_settings")
        .select("*")
        .eq("key", "default")
        .maybeSingle(),
      supabase
        .from("products")
        .select("*")
        .eq("status", "active"),
      supabase
        .from("mercadolibre_shipping_costs")
        .select("*")
        .eq("active", true),
      supabase
        .from("simulator_saved_simulations")
        .select("*")
        .order("updated_at", { ascending: false }),
    ]);

    setLoading(false);

    if (channelsResponse.error) setError(channelsResponse.error.message);
    else setInstallments((channelsResponse.data || []) as MercadoLibreInstallmentFee[]);

    if (categoriesResponse.error) setError(categoriesResponse.error.message);
    else setCategories((categoriesResponse.data || []) as MercadoLibreCategoryFee[]);

    if (taxesResponse.error) setError(taxesResponse.error.message);
    else if (taxesResponse.data) setTaxes(taxesResponse.data as TaxSettings);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);

    if (shippingResponse.error) setError(shippingResponse.error.message);
    else setShippingCosts((shippingResponse.data || []) as MercadoLibreShippingCost[]);

    if (savedResponse.error) setError(savedResponse.error.message);
    else setSavedSimulations((savedResponse.data || []) as SavedSimulation[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof SimulationForm>(key: K, value: SimulationForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function averageShippingForCategory(category: string) {
    const normalizedCategory = category.trim().toLowerCase();
    if (!normalizedCategory) return null;

    const productIds = new Set(
      products
        .filter((product) => (product.category || "").trim().toLowerCase() === normalizedCategory)
        .map((product) => product.id)
        .filter(Boolean),
    );

    const productSkus = new Set(
      products
        .filter((product) => (product.category || "").trim().toLowerCase() === normalizedCategory)
        .map((product) => product.sku)
        .filter(Boolean),
    );

    const values = shippingCosts
      .filter(isCurrentShippingCost)
      .filter((shipping) => {
        const matchesId = shipping.product_id && productIds.has(shipping.product_id);
        const matchesSku = shipping.sku && productSkus.has(shipping.sku);
        return matchesId || matchesSku;
      })
      .map((shipping) => Number(shipping.fixed_fee_amount || 0) + Number(shipping.shipping_cost_amount || 0))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function updateCategory(category: string) {
    const averageShipping = averageShippingForCategory(category);
    setForm((current) => ({
      ...current,
      category,
      shippingGross:
        averageShipping !== null
          ? String(Math.round(averageShipping))
          : current.shippingGross,
    }));
  }

  function shippingForProduct(product: Product) {
    const values = shippingCosts
      .filter(isCurrentShippingCost)
      .filter((shipping) => {
        const matchesId = product.id && shipping.product_id === product.id;
        const matchesSku = product.sku && shipping.sku === product.sku;
        return matchesId || matchesSku;
      })
      .map((shipping) => Number(shipping.fixed_fee_amount || 0) + Number(shipping.shipping_cost_amount || 0))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function loadProductBase(productId: string) {
    if (!productId) return;
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    const productShipping = shippingForProduct(product);
    const categoryShipping = averageShippingForCategory(product.category || "");
    const shippingGross = productShipping ?? categoryShipping ?? Number(toNumber(form.shippingGross) || 0);

    setForm((current) => ({
      ...current,
      productName: product.name || current.productName,
      provider: product.supplier || "",
      category: product.category || current.category,
      costWithoutVat: String(Math.round(Number(product.cost_without_vat || 0))),
      vatCondition: vatConditionFromProduct(product),
      shippingGross: String(Math.round(shippingGross)),
    }));
    setLoadedSimulation(null);
    setLastEdited("price");
    setMessage(`Base cargada desde ${product.sku} - ${product.name}.`);
    setError(null);
  }

  function updateSalePrice(value: string) {
    setLastEdited("price");
    update("salePrice", value);
  }

  function updateDesiredMargin(value: string) {
    setLastEdited("margin");
    update("desiredMarginRate", value);
  }

  function clear() {
    setForm({
      productName: "",
      provider: "",
      category: categories[0]?.category || "",
      publicationUrl: "",
      costWithoutVat: "",
      desiredMarginRate: "5",
      salePrice: "",
      vatCondition: "iva_21",
      shippingGross: "0",
    });
    setLastEdited("price");
    setLoadedSimulation(null);
    setError(null);
    setMessage(null);
  }

  async function saveSimulation() {
    const name = form.productName.trim();

    if (!name) {
      setError("Poné un nombre de producto para guardar la simulación.");
      return;
    }

    setSavingSimulation(true);
    setError(null);
    setMessage(null);

    const payload = {
      name,
      provider: form.provider.trim() || null,
      category: form.category || null,
      publication_url: form.publicationUrl.trim() || null,
      cost_without_vat: Number(toNumber(form.costWithoutVat) || 0),
      desired_margin_rate: Number(simulation.linkedMargin || 0),
      sale_price: Number(simulation.grossSalePrice || 0),
      vat_condition: form.vatCondition,
      shipping_gross: Number(toNumber(form.shippingGross) || 0),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("simulator_saved_simulations").insert(payload);

    setSavingSimulation(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(`Simulación guardada: ${name}.`);
    setLoadedSimulation(null);
    await loadData();
  }

  function loadSimulation(item: SavedSimulation) {
    setForm({
      productName: item.name || "",
      provider: item.provider || "",
      category: item.category || "",
      publicationUrl: item.publication_url || "",
      costWithoutVat: String(Math.round(Number(item.cost_without_vat || 0))),
      desiredMarginRate: formatPercentInput(Number(item.desired_margin_rate || 0)),
      salePrice: String(Math.round(Number(item.sale_price || 0))),
      vatCondition: item.vat_condition || "iva_21",
      shippingGross: String(Math.round(Number(item.shipping_gross || 0))),
    });
    setLastEdited("price");
    setLoadedSimulation(item);
    setSimulationLibraryOpen(false);
    setMessage(`Simulación cargada: ${item.name}.`);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteSimulation(item: SavedSimulation) {
    const confirmed = window.confirm(`¿Eliminar la simulación "${item.name}"?`);
    if (!confirmed) return;

    setError(null);
    setMessage(null);

    const { error } = await supabase
      .from("simulator_saved_simulations")
      .delete()
      .eq("id", item.id);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(`Simulación eliminada: ${item.name}.`);
    if (loadedSimulation?.id === item.id) setLoadedSimulation(null);
    await loadData();
  }

  const categoryNames = useMemo(() => {
    const names = new Set(categories.map((item) => item.category).filter(Boolean));
    if (form.category) names.add(form.category);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [categories, form.category]);

  const savedProviderOptions = useMemo(() => {
    const providers = new Set(savedSimulations.map((item) => item.provider?.trim() || "Sin proveedor"));
    return [...providers].sort((a, b) => compareText(a === "Sin proveedor" ? "" : a, b === "Sin proveedor" ? "" : b));
  }, [savedSimulations]);

  const savedCategoryOptions = useMemo(() => {
    const names = new Set(savedSimulations.map((item) => item.category?.trim()).filter(Boolean) as string[]);
    return [...names].sort((a, b) => compareText(a, b));
  }, [savedSimulations]);

  const libraryActiveFilterCount = [
    libraryQuery.trim(),
    libraryProviderFilter,
    libraryCategoryFilter,
    libraryDateFilter !== "all" ? libraryDateFilter : "",
  ].filter(Boolean).length;

  const filteredSavedSimulations = useMemo(() => {
    const query = normalizeSearch(libraryQuery);

    return savedSimulations
      .filter((item) => {
        const provider = item.provider?.trim() || "Sin proveedor";
        if (libraryProviderFilter && provider !== libraryProviderFilter) return false;
        if (libraryCategoryFilter && (item.category || "") !== libraryCategoryFilter) return false;
        if (!dateFilterMatches(item.updated_at || item.created_at, libraryDateFilter)) return false;
        if (!query) return true;

        const product = products.find((candidate) => normalizeSearch(candidate.name) === normalizeSearch(item.name));
        const haystack = [
          item.name,
          product?.name,
          product?.sku,
          item.provider,
          item.category,
          item.publication_url,
        ].map(normalizeSearch).join(" ");

        return haystack.includes(query);
      })
      .sort((a, b) => {
        if (librarySort === "name_asc") return compareText(a.name, b.name);
        if (librarySort === "name_desc") return compareText(b.name, a.name);
        if (librarySort === "provider_asc") return compareText(a.provider || "Sin proveedor", b.provider || "Sin proveedor");
        if (librarySort === "category_asc") return compareText(a.category, b.category);
        if (librarySort === "cost_desc") return Number(b.cost_without_vat || 0) - Number(a.cost_without_vat || 0);
        if (librarySort === "cost_asc") return Number(a.cost_without_vat || 0) - Number(b.cost_without_vat || 0);
        if (librarySort === "price_desc") return Number(b.sale_price || 0) - Number(a.sale_price || 0);
        if (librarySort === "price_asc") return Number(a.sale_price || 0) - Number(b.sale_price || 0);
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        return librarySort === "updated_asc" ? aTime - bTime : bTime - aTime;
      });
  }, [savedSimulations, libraryQuery, libraryProviderFilter, libraryCategoryFilter, libraryDateFilter, librarySort, products]);

  function clearLibraryFilters() {
    setLibraryQuery("");
    setLibraryProviderFilter("");
    setLibraryCategoryFilter("");
    setLibraryDateFilter("all");
  }

  const options: MercadoLibrePriceOption[] = useMemo(() => {
    const custom = installments.map((item) => ({
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
    }));

    const hasMc = custom.some((item) => item.code === "MC");
    return orderChannels(hasMc ? custom : [mercadoLibreClassicOption(), ...custom]);
  }, [installments]);

  const simulation = useMemo(() => {
    const costWithoutVat = Number(toNumber(form.costWithoutVat) || 0);
    const inputSalePrice = Number(toNumber(form.salePrice) || 0);
    const desiredMarginRate = Number(toNumber(form.desiredMarginRate) || 0);
    const productVatRate = vatRateFromCondition(form.vatCondition);
    const appliesVat = saleAppliesVat(form.vatCondition);
    const shippingGross = Number(toNumber(form.shippingGross) || 0);
    const shippingNet = shippingGross / 1.21;

    const product: Product = {
      sku: "SIM",
      name: form.productName || "Producto simulado",
      category: form.category || null,
      cost_without_vat: costWithoutVat,
      vat_rate: productVatRate,
      status: "active",
    };

    const categoryFee =
      categories.find(
        (item) =>
          item.category.trim().toLowerCase() ===
          (form.category || "").trim().toLowerCase(),
      ) || null;

    const commonTarget = {
      saleAppliesVat: appliesVat,
      costVatRate: 0,
      manualShippingAmount: shippingNet,
      roundTo: 100,
      roundingMode: "nearest" as const,
    };

    const shippingCost = {
      product_id: "SIM",
      sku: "SIM",
      fixed_fee_amount: 0,
      shipping_cost_amount: shippingGross,
      free_shipping: true,
      shipping_method: "manual",
      active: true,
    };

    const baseOption = options[0] || mercadoLibreClassicOption();

    const marginBasedSummary = calculatePriceSummary(
      product,
      baseOption,
      categoryFee,
      taxes,
      shippingCost,
      {
        ...commonTarget,
        desiredMarginRate,
      },
    );

    const grossSalePrice =
      lastEdited === "margin" && marginBasedSummary.valid
        ? Number(marginBasedSummary.roundedPrice || 0)
        : inputSalePrice;

    const rows = options.map((option) => {
      const result = calculatePriceSummary(
        product,
        option,
        categoryFee,
        taxes,
        shippingCost,
        {
          ...commonTarget,
          salePrice: grossSalePrice,
        },
      );

      const zeroResult = calculatePriceSummary(
        product,
        option,
        categoryFee,
        taxes,
        shippingCost,
        {
          ...commonTarget,
          desiredNetProfit: 0,
        },
      );

      return {
        option,
        result,
        zeroResult,
        status: statusLabel(result.valid ? result.marginOnNetSale : 0),
      };
    });

    const summary = rows[0]?.result || null;
    const linkedMargin =
      lastEdited === "price"
        ? summary?.valid
          ? Number(summary.marginOnNetSale || 0)
          : desiredMarginRate
        : desiredMarginRate;

    const linkedSalePrice =
      lastEdited === "margin" && marginBasedSummary.valid
        ? Number(marginBasedSummary.roundedPrice || 0)
        : grossSalePrice;

    const categoryCommissionAmount =
      summary?.valid && summary.marketplaceFeeAmount !== null
        ? Number(summary.marketplaceFeeAmount || 0)
        : 0;

    const taxesAppliedRate =
      Number(taxes.iibb_rate || 0) +
      Number(taxes.idc_rate || 0) +
      Number(taxes.iigg_rate || 0);

    const taxesAppliedAmount =
      Number(summary?.iibbAmount || 0) +
      Number(summary?.idcAmount || 0) +
      Number(summary?.incomeTaxAmount || 0);

    const averageShippingForSelectedCategory = averageShippingForCategory(form.category);

    return {
      costWithoutVat,
      grossSalePrice: linkedSalePrice,
      appliesVat,
      productVatRate,
      shippingGross,
      shippingNet,
      averageShippingForSelectedCategory,
      categoryFee,
      categoryCommissionAmount,
      taxesAppliedRate,
      taxesAppliedAmount,
      linkedMargin,
      rows,
      summary,
    };
  }, [form, categories, options, taxes, lastEdited, products, shippingCosts]);

  const summaryStatus = statusLabel(simulation.summary?.valid ? simulation.summary.marginOnNetSale : 0);

  return (
    <main className="container wide simulator-page">
      <PageHero
        title="Simulador"
        description="Calculá precio, margen y rentabilidad por canal antes de publicar o modificar un producto."
        icon={<Calculator aria-hidden="true" />}
        onRefresh={loadData}
        onLogout={logout}
      />

      {error && <div className="message error">{error}</div>}
      {message && <div className="message success">{message}</div>}

      <section className="simulator-layout-grid">
        <div className="card simulator-input-card">
          <div className="simulator-section-title">
            <span className="simulator-title-icon"><SlidersHorizontal aria-hidden="true" /></span>
            <div>
              <h2>Datos de simulación</h2>
              <p className="small">Cargá la base comercial y ajustá precio o margen sin cambiar la lógica de cálculo.</p>
            </div>
          </div>

          {loadedSimulation && (
            <div className="simulator-loaded-note">
              <FolderOpen aria-hidden="true" />
              <span>Simulación cargada: <strong>{loadedSimulation.name}</strong></span>
              <button type="button" onClick={() => setLoadedSimulation(null)}>Desvincular</button>
            </div>
          )}

          <div className="field simulator-product-base-field">
            <label>Usar producto como base</label>
            <select defaultValue="" onChange={(event) => loadProductBase(event.target.value)}>
              <option value="">Elegir producto guardado...</option>
              {products
                .slice()
                .sort((a, b) => `${a.category || ""} ${a.name}`.localeCompare(`${b.category || ""} ${b.name}`, "es"))
                .map((product) => (
                  <option key={product.id || product.sku} value={product.id}>
                    {product.sku} - {product.name} · {product.category || "Sin categoría"} · Costo {moneyWithCents(product.cost_without_vat || 0)}
                  </option>
                ))}
            </select>
            <span className="small">
              Carga automáticamente categoría, proveedor, costo, IVA y envío cuando esos datos estén disponibles.
            </span>
          </div>

          <div className="simulator-form-grid simulator-form-grid-three">
            <div className="field simulator-wide-field">
              <label>Producto</label>
              <input
                value={form.productName}
                onChange={(event) => update("productName", event.target.value)}
                placeholder='Ej: Smart TV Enova 43" Google TV'
              />
            </div>

            <div className="field simulator-wide-field">
              <label>Link publicacion</label>
              <input
                type="url"
                value={form.publicationUrl}
                onChange={(event) => update("publicationUrl", event.target.value)}
                placeholder="https://articulo.mercadolibre.com.ar/..."
              />
              <span className="small">
                Guardalo para revisar despues la publicacion junto al precio calculado.
              </span>
            </div>

            <div className="field">
              <label>Proveedor</label>
              <input
                value={form.provider}
                onChange={(event) => update("provider", event.target.value)}
                placeholder="Ej: Mirgor"
              />
            </div>

            <div className="field">
              <label>Categoria</label>
              <select
                value={form.category}
                onChange={(event) => updateCategory(event.target.value)}
              >
                <option value="">Seleccionar categoría</option>
                {categoryNames.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Costo sin IVA</label>
              <input
                type="text"
                inputMode="decimal"
                value={form.costWithoutVat}
                onChange={(event) => update("costWithoutVat", event.target.value)}
                placeholder="241332"
              />
            </div>

            <div className="field">
              <label>Condición IVA</label>
              <select
                value={form.vatCondition}
                onChange={(event) => update("vatCondition", event.target.value as VatCondition)}
              >
                <option value="sin_factura">Sin IVA</option>
                <option value="iva_21">Con IVA 21%</option>
                <option value="iva_105">Con IVA 10,5%</option>
              </select>
            </div>

            <div className="field">
              <label>Margen deseado</label>
              <div className="input-suffix">
                <input
                  type="text"
                  inputMode="decimal"
                  value={
                    lastEdited === "price"
                      ? formatPercentInput(simulation.linkedMargin)
                      : form.desiredMarginRate
                  }
                  onChange={(event) => updateDesiredMargin(event.target.value)}
                />
                <span>%</span>
              </div>
            </div>

            <div className="field">
              <label>Precio de venta</label>
              <input
                type="text"
                inputMode="decimal"
                value={
                  lastEdited === "margin"
                    ? String(Math.round(simulation.grossSalePrice || 0))
                    : form.salePrice
                }
                onChange={(event) => updateSalePrice(event.target.value)}
                placeholder="317000"
              />
            </div>

            <div className="field simulator-wide-field">
              <label>Envío c/IVA</label>
              <input
                type="text"
                inputMode="decimal"
                value={form.shippingGross}
                onChange={(event) => update("shippingGross", event.target.value)}
                placeholder="0"
              />
              <span className="small">
                Se completa con el promedio de envío de la categoría, pero podés modificarlo.
              </span>
            </div>
          </div>

          <div className="simulator-linked-note">
            <RefreshCw aria-hidden="true" />
            <div>
              <strong>Valores vinculados</strong>
              <span>Modificar Precio recalcula Margen y modificar Margen recalcula Precio.</span>
            </div>
          </div>

          <div className="simulator-actions">
            <button className="button primary" type="button" onClick={saveSimulation} disabled={savingSimulation}>
              <Save aria-hidden="true" />
              {savingSimulation ? "Guardando..." : "Guardar simulación"}
            </button>
            <button className="button secondary" type="button" onClick={() => setSimulationLibraryOpen(true)}>
              <FolderOpen aria-hidden="true" />
              Cargar simulación
            </button>
            <button className="button ghost" type="button" onClick={clear}>
              <RotateCcw aria-hidden="true" />
              Limpiar
            </button>
          </div>
        </div>

        <div className="card simulator-summary-card">
          <div className="simulator-section-title">
            <span className="simulator-title-icon"><CircleDollarSign aria-hidden="true" /></span>
            <div>
              <h2>Resultado</h2>
              <p className="small">Impacto inmediato del precio y los costos cargados.</p>
            </div>
          </div>

          <div className="simulator-summary-list">
            <div className="simulator-result-metric">
              <span>Precio de venta</span>
              <strong>{moneyWithCents(simulation.grossSalePrice)}</strong>
            </div>
            <div className="simulator-result-metric">
              <span>Ganancia</span>
              <strong>{moneyWithCents(simulation.summary?.valid ? simulation.summary.netProfit : 0)}</strong>
            </div>
            <div className={`simulator-result-metric main ${summaryStatus.className}`}>
              <span>Rentabilidad real</span>
              <strong>{simulation.summary?.valid ? percent(simulation.summary.marginOnNetSale) : "-"}</strong>
              <em className={`badge simulator-status-badge ${summaryStatus.className}`}>{summaryStatus.label}</em>
            </div>
            <div>
              <span>Precio sin IVA</span>
              <strong>{moneyWithCents(simulation.summary?.valid ? simulation.summary.netSalePrice : 0)}</strong>
            </div>
            <div>
              <span>Costo usado</span>
              <strong>{moneyWithCents(simulation.summary?.valid ? simulation.summary.costForProfit : simulation.costWithoutVat)}</strong>
            </div>
            <div>
              <span>Comisión categoría</span>
              <strong>
                {percent(simulation.categoryFee?.marketplace_fee_rate || 0)}{" "}
                <small>({moneyWithCents(simulation.categoryCommissionAmount)})</small>
              </strong>
            </div>
            <div>
              <span>Impuestos aplicados</span>
              <strong>
                {percent(simulation.taxesAppliedRate)}{" "}
                <small>({moneyWithCents(simulation.taxesAppliedAmount)})</small>
              </strong>
            </div>
            <div>
              <span>Envío c/IVA</span>
              <strong>{moneyWithCents(simulation.shippingGross)}</strong>
            </div>
            <div>
              <span>Margen bruto</span>
              <strong>{moneyWithCents(simulation.summary?.valid ? simulation.summary.grossProfit : 0)}</strong>
            </div>
            <div>
              <span>Proveedor</span>
              <strong>{form.provider || "Sin proveedor"}</strong>
            </div>
          </div>

          <div className="simulator-base-inline">
          <button className="simulator-base-toggle" type="button" onClick={() => setBaseDetailsOpen((current) => !current)} aria-expanded={baseDetailsOpen}>
            <Settings2 aria-hidden="true" />
            Ver base de cálculo
            {baseDetailsOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </button>

          {baseDetailsOpen && <div className="simulator-base-list">
            <div><span>Proveedor</span><strong>{form.provider || "Sin proveedor"}</strong></div>
            <div><span>Categoría</span><strong>{form.category || "-"}</strong></div>
            <div><span>Comisión categoría</span><strong>{percent(simulation.categoryFee?.marketplace_fee_rate || 0)}</strong></div>
            <div><span>Envío promedio categoría</span><strong>{simulation.averageShippingForSelectedCategory ? moneyWithCents(simulation.averageShippingForSelectedCategory) : "-"}</strong></div>
            <div><span>IIBB</span><strong>{percent(taxes.iibb_rate || 0)}</strong></div>
            <div><span>IDC</span><strong>{percent(taxes.idc_rate || 0)}</strong></div>
            <div><span>IIGG</span><strong>{percent(taxes.iigg_rate || 0)}</strong></div>
            <div><span>Estructura</span><strong>{moneyWithCents(0)}</strong></div>
            <div><span>Observaciones</span><strong>Simulación automática</strong></div>
          </div>}
          </div>
        </div>
      </section>

      <section className="card simulator-results-card">
        <div className="simulator-section-title">
          <span className="simulator-title-icon"><ChartColumn aria-hidden="true" /></span>
          <div>
            <h2>Rentabilidad por canal</h2>
            <p className="small">Compará la rentabilidad estimada según el canal de venta.</p>
          </div>
        </div>

        {loading ? (
          <p>Cargando canales...</p>
        ) : (
          <div className="table-wrap">
            <table className="simulator-table">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Precio de venta</th>
                  <th>Rentabilidad</th>
                  <th>Ganancia</th>
                  <th title="Precio de venta necesario para obtener rentabilidad 0%">Precio equilibrio</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {simulation.rows.map(({ option, result, zeroResult, status }) => (
                  <tr key={option.code}>
                    <td>
                      <strong>{option.code}</strong>
                      <br />
                      <span className="small">{option.name}</span>
                    </td>
                    <td className="numeric">{moneyWithCents(simulation.grossSalePrice)}</td>
                    <td className="numeric">
                      <span
                        className={`rentability-pill ${
                          result.valid && Number(result.marginOnNetSale || 0) < 0
                            ? "negative"
                            : "positive"
                        }`}
                      >
                        {result.valid ? percent(result.marginOnNetSale) : "-"}
                      </span>
                    </td>
                    <td className={`numeric ${result.valid && Number(result.netProfit || 0) < 0 ? "negative-money" : "positive-money"}`}>
                      {result.valid ? moneyWithCents(result.netProfit) : "-"}
                    </td>
                    <td className="numeric">{zeroResult.valid ? moneyWithCents(zeroResult.roundedPrice) : "-"}</td>
                    <td>
                      <span className={`badge simulator-status-badge ${status.className}`}>{status.label}</span>
                    </td>
                  </tr>
                ))}
                {simulation.rows.length === 0 && (
                  <tr>
                    <td colSpan={6}>No hay canales activos cargados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {simulationLibraryOpen && (
        <div className="modal-backdrop simulator-library-backdrop" onClick={() => setSimulationLibraryOpen(false)}>
          <section className="modal-card simulator-library-modal" onClick={(event) => event.stopPropagation()}>
            <div className="simulator-library-header">
              <div>
                <h2>Cargar simulación</h2>
                <p>Buscá y seleccioná una simulación guardada.</p>
              </div>
              <button className="modal-close-button" type="button" onClick={() => setSimulationLibraryOpen(false)} aria-label="Cerrar">
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="simulator-library-toolbar">
              <label className="search-control simulator-library-search">
                <Search aria-hidden="true" />
                <input
                  className="search-field"
                  value={libraryQuery}
                  onChange={(event) => setLibraryQuery(event.target.value)}
                  placeholder="Buscar simulación, producto o proveedor..."
                />
              </label>
              <select value={libraryProviderFilter} onChange={(event) => setLibraryProviderFilter(event.target.value)}>
                <option value="">Todos los proveedores</option>
                {savedProviderOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
              </select>
              <select value={libraryCategoryFilter} onChange={(event) => setLibraryCategoryFilter(event.target.value)}>
                <option value="">Todas las categorías</option>
                {savedCategoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <select value={libraryDateFilter} onChange={(event) => setLibraryDateFilter(event.target.value as SimulationDateFilter)}>
                <option value="all">Todas las fechas</option>
                <option value="today">Hoy</option>
                <option value="7d">Últimos 7 días</option>
                <option value="30d">Últimos 30 días</option>
                <option value="older">Más antiguas</option>
              </select>
              <select value={librarySort} onChange={(event) => setLibrarySort(event.target.value as SimulationSortKey)}>
                <option value="updated_desc">Más reciente</option>
                <option value="updated_asc">Más antigua</option>
                <option value="name_asc">Nombre A-Z</option>
                <option value="name_desc">Nombre Z-A</option>
                <option value="provider_asc">Proveedor</option>
                <option value="category_asc">Categoría</option>
                <option value="cost_desc">Mayor costo</option>
                <option value="cost_asc">Menor costo</option>
                <option value="price_desc">Mayor precio</option>
                <option value="price_asc">Menor precio</option>
              </select>
            </div>

            <div className="simulator-library-count">
              <span>
                {libraryActiveFilterCount
                  ? `${filteredSavedSimulations.length} de ${savedSimulations.length} simulaciones · ${libraryActiveFilterCount} filtros activos`
                  : `${savedSimulations.length} simulaciones`}
              </span>
              {libraryActiveFilterCount > 0 && (
                <button className="button ghost small-button" type="button" onClick={clearLibraryFilters}>Limpiar filtros</button>
              )}
            </div>

            <div className="simulator-library-body">
              {savedSimulations.length === 0 ? (
                <div className="simulator-library-empty">
                  <FolderOpen aria-hidden="true" />
                  <strong>No hay simulaciones guardadas</strong>
                  <span>Guardá una simulación para poder recuperarla más adelante.</span>
                </div>
              ) : filteredSavedSimulations.length === 0 ? (
                <div className="simulator-library-empty">
                  <SearchX aria-hidden="true" />
                  <strong>No encontramos simulaciones</strong>
                  <span>Probá cambiando los filtros o la búsqueda.</span>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="simulator-table simulator-library-table">
                    <thead>
                      <tr>
                        <th>Nombre / Producto</th>
                        <th>Proveedor</th>
                        <th>Categoría</th>
                        <th>Costo</th>
                        <th>Precio</th>
                        <th>Margen</th>
                        <th>Rentabilidad</th>
                        <th>Modificada</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSavedSimulations.map((item) => {
                        const product = products.find((candidate) => normalizeSearch(candidate.name) === normalizeSearch(item.name));
                        return (
                          <tr key={item.id} className="simulator-library-row" onClick={() => loadSimulation(item)}>
                            <td>
                              <strong>{item.name}</strong>
                              <span>{product?.sku ? `${product.sku} · ` : ""}{item.publication_url ? "Con link" : "Sin link"}</span>
                            </td>
                            <td>{item.provider || "Sin proveedor"}</td>
                            <td>{item.category || "-"}</td>
                            <td className="numeric">{moneyWithCents(item.cost_without_vat || 0)}</td>
                            <td className="numeric">{moneyWithCents(item.sale_price || 0)}</td>
                            <td><span className="rentability-pill positive">{percent(item.desired_margin_rate || 0)}</span></td>
                            <td>{statusLabel(item.desired_margin_rate).label}</td>
                            <td>{formatDateTime(item.updated_at || item.created_at)}</td>
                            <td>
                              <div className="saved-simulation-actions" onClick={(event) => event.stopPropagation()}>
                                {item.publication_url && (
                                  <a className="item-action icon-only" href={item.publication_url} target="_blank" rel="noreferrer" title="Ver publicación" aria-label="Ver publicación">
                                    <ExternalLink aria-hidden="true" />
                                  </a>
                                )}
                                <button className="item-action" type="button" onClick={(event) => {
                                  event.stopPropagation();
                                  loadSimulation(item);
                                }}>
                                  Cargar <ChevronRight aria-hidden="true" />
                                </button>
                                <button className="button danger ghost small-button" type="button" onClick={() => deleteSimulation(item)} title="Eliminar simulación">
                                  <Trash2 aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

    </main>
  );
}
