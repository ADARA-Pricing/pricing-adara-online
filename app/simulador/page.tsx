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
  category: string;
  costWithoutVat: string;
  desiredMarginRate: string;
  salePrice: string;
  vatCondition: VatCondition;
  shippingGross: string;
};

type SavedSimulation = {
  id: string;
  name: string;
  category: string | null;
  cost_without_vat: number;
  desired_margin_rate: number;
  sale_price: number;
  vat_condition: VatCondition;
  shipping_gross: number;
  created_at?: string | null;
  updated_at?: string | null;
};

const initialForm: SimulationForm = {
  productName: 'Smart TV Enova 43" Google TV',
  category: "TV",
  costWithoutVat: "241332",
  desiredMarginRate: "12",
  salePrice: "317000",
  vatCondition: "iva_21",
  shippingGross: "0",
};

const channelOrder = ["MC", "MP3", "MP6", "MP9", "MP12", "EF"];

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
      category: product.category || current.category,
      costWithoutVat: String(Math.round(Number(product.cost_without_vat || 0))),
      vatCondition: vatConditionFromProduct(product),
      shippingGross: String(Math.round(shippingGross)),
    }));
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
      category: categories[0]?.category || "",
      costWithoutVat: "",
      desiredMarginRate: "5",
      salePrice: "",
      vatCondition: "iva_21",
      shippingGross: "0",
    });
    setLastEdited("price");
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
      category: form.category || null,
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
    await loadData();
  }

  function loadSimulation(item: SavedSimulation) {
    setForm({
      productName: item.name || "",
      category: item.category || "",
      costWithoutVat: String(Math.round(Number(item.cost_without_vat || 0))),
      desiredMarginRate: formatPercentInput(Number(item.desired_margin_rate || 0)),
      salePrice: String(Math.round(Number(item.sale_price || 0))),
      vatCondition: item.vat_condition || "iva_21",
      shippingGross: String(Math.round(Number(item.shipping_gross || 0))),
    });
    setLastEdited("price");
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
    await loadData();
  }

  const categoryNames = useMemo(() => {
    const names = new Set(categories.map((item) => item.category).filter(Boolean));
    if (form.category) names.add(form.category);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [categories, form.category]);

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

  return (
    <main className="container wide simulator-page">
      <PageHero
        title="Simulador"
        description="Simulá rápido un producto, su costo, IVA y precio de venta para ver la rentabilidad por canal."
        onRefresh={loadData}
        onLogout={logout}
      />

      {error && <div className="message error">{error}</div>}
      {message && <div className="message success">{message}</div>}

      <section className="simulator-layout-grid">
        <div className="card simulator-input-card">
          <div className="simulator-section-title">
            <span className="simulator-title-icon">⚡</span>
            <div>
              <h2>Simulación rápida</h2>
              <p className="small">Cargá los datos mínimos para obtener resultados automáticos.</p>
            </div>
          </div>

          <div className="field simulator-product-base-field">
            <label>Usar producto guardado como base</label>
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
              Completa categoría, costo sin IVA, condición de IVA y envío. Después podés ajustar cualquier campo a mano.
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

            <div className="field">
              <label>Categoría</label>
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
              <label>% Margen deseado</label>
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

            <div className="field">
              <label>Condición de IVA</label>
              <select
                value={form.vatCondition}
                onChange={(event) => update("vatCondition", event.target.value as VatCondition)}
              >
                <option value="sin_factura">Sin IVA</option>
                <option value="iva_21">Con IVA 21%</option>
                <option value="iva_105">Con IVA 10,5%</option>
              </select>
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
            Si cambiás el precio de venta o el % margen deseado, el otro valor se recalcula automáticamente.
          </div>

          <div className="simulator-actions simulator-actions-right">
            <button className="button" type="button" onClick={saveSimulation} disabled={savingSimulation}>
              {savingSimulation ? "Guardando..." : "Guardar simulación"}
            </button>
            <button className="button ghost" type="button" onClick={clear}>
              Limpiar
            </button>
          </div>
        </div>

        <div className="card simulator-summary-card">
          <div className="simulator-section-title">
            <span className="simulator-title-icon">▮</span>
            <div>
              <h2>Resumen rápido</h2>
              <p className="small">Resumen de resultados con los parámetros actuales.</p>
            </div>
          </div>

          <div className="simulator-summary-list">
            <div>
              <span>Precio de venta</span>
              <strong>{moneyWithCents(simulation.grossSalePrice)}</strong>
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
            <div className="highlight">
              <span>Ganancia</span>
              <strong>{moneyWithCents(simulation.summary?.valid ? simulation.summary.netProfit : 0)}</strong>
            </div>
            <div className="highlight stronger">
              <span>Rentabilidad real</span>
              <strong>{simulation.summary?.valid ? percent(simulation.summary.marginOnNetSale) : "-"}</strong>
            </div>
          </div>
        </div>

        <div className="card simulator-base-card">
          <div className="simulator-section-title">
            <span className="simulator-title-icon">⚙</span>
            <div>
              <h2>Base de cálculo</h2>
              <p className="small">Parámetros aplicados en esta simulación.</p>
            </div>
          </div>

          <div className="simulator-base-list">
            <div><span>Categoría</span><strong>{form.category || "-"}</strong></div>
            <div><span>Comisión categoría</span><strong>{percent(simulation.categoryFee?.marketplace_fee_rate || 0)}</strong></div>
            <div><span>Envío promedio categoría</span><strong>{simulation.averageShippingForSelectedCategory ? moneyWithCents(simulation.averageShippingForSelectedCategory) : "-"}</strong></div>
            <div><span>IIBB</span><strong>{percent(taxes.iibb_rate || 0)}</strong></div>
            <div><span>IDC</span><strong>{percent(taxes.idc_rate || 0)}</strong></div>
            <div><span>IIGG</span><strong>{percent(taxes.iigg_rate || 0)}</strong></div>
            <div><span>Estructura</span><strong>{moneyWithCents(0)}</strong></div>
            <div><span>Observaciones</span><strong>Simulación automática</strong></div>
          </div>
        </div>
      </section>

      <section className="card simulator-results-card">
        <div className="simulator-section-title">
          <span className="simulator-title-icon">◎</span>
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
                  <th>% Rentabilidad</th>
                  <th>Ganancia</th>
                  <th>Precio para rentabilidad 0</th>
                  <th>Observación</th>
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
                    <td>{moneyWithCents(simulation.grossSalePrice)}</td>
                    <td>
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
                    <td className={result.valid && Number(result.netProfit || 0) < 0 ? "negative-money" : "positive-money"}>
                      {result.valid ? moneyWithCents(result.netProfit) : "-"}
                    </td>
                    <td>{zeroResult.valid ? moneyWithCents(zeroResult.roundedPrice) : "-"}</td>
                    <td>
                      <span className={`status-dot ${status.className}`} />
                      {status.label}
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

      <section className="card simulator-results-card saved-simulations-card">
        <div className="simulator-section-title">
          <span className="simulator-title-icon">▣</span>
          <div>
            <h2>Simulaciones guardadas</h2>
            <p className="small">
              Guardá escenarios para volver a cargarlos, editarlos o eliminarlos.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="simulator-table saved-simulations-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Costo sin IVA</th>
                <th>Precio de venta</th>
                <th>Margen</th>
                <th>Envío c/IVA</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {savedSimulations.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>{item.category || "-"}</td>
                  <td>{moneyWithCents(item.cost_without_vat || 0)}</td>
                  <td>{moneyWithCents(item.sale_price || 0)}</td>
                  <td>
                    <span className="rentability-pill positive">
                      {percent(item.desired_margin_rate || 0)}
                    </span>
                  </td>
                  <td>{moneyWithCents(item.shipping_gross || 0)}</td>
                  <td>
                    <div className="saved-simulation-actions">
                      <button className="button ghost" type="button" onClick={() => loadSimulation(item)}>
                        Cargar
                      </button>
                      <button className="button danger ghost" type="button" onClick={() => deleteSimulation(item)}>
                        Borrar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {savedSimulations.length === 0 && (
                <tr>
                  <td colSpan={7}>Todavía no hay simulaciones guardadas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </main>
  );
}
