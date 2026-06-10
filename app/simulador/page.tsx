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
  Product,
  TaxSettings,
} from "@/lib/types";

type VatCondition = "sin_factura" | "iva_21" | "iva_105";

type SimulationForm = {
  productName: string;
  category: string;
  costWithoutVat: string;
  salePrice: string;
  vatCondition: VatCondition;
  priceIncludesVat: boolean;
};

const initialForm: SimulationForm = {
  productName: 'Smart TV Enova 43" Google TV',
  category: "TV",
  costWithoutVat: "241332",
  salePrice: "317000",
  vatCondition: "iva_21",
  priceIncludesVat: true,
};

const channelOrder = ["MC", "MP3", "MP6", "MP9", "MP12"];

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

function costVatRateFromCondition(condition: VatCondition) {
  if (condition === "sin_factura") return 0;
  if (condition === "iva_105") return 10.5;
  return 21;
}

function statusLabel(margin?: number | null) {
  const value = Number(margin || 0);
  if (value < 0) return { label: "Negativo", className: "negative" };
  if (value < 3) return { label: "Al límite", className: "warning" };
  return { label: "Rentable", className: "positive" };
}

export default function SimulatorPage() {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState<SimulationForm>(initialForm);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categories, setCategories] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    const [channelsResponse, categoriesResponse, taxesResponse] = await Promise.all([
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
    ]);

    setLoading(false);

    if (channelsResponse.error) setError(channelsResponse.error.message);
    else setInstallments((channelsResponse.data || []) as MercadoLibreInstallmentFee[]);

    if (categoriesResponse.error) setError(categoriesResponse.error.message);
    else setCategories((categoriesResponse.data || []) as MercadoLibreCategoryFee[]);

    if (taxesResponse.error) setError(taxesResponse.error.message);
    else if (taxesResponse.data) setTaxes(taxesResponse.data as TaxSettings);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof SimulationForm>(key: K, value: SimulationForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function calculate() {
    setMessage("Simulación actualizada.");
  }

  function clear() {
    setForm({
      productName: "",
      category: categories[0]?.category || "",
      costWithoutVat: "",
      salePrice: "",
      vatCondition: "iva_21",
      priceIncludesVat: true,
    });
    setMessage(null);
    setError(null);
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
    const productVatRate = vatRateFromCondition(form.vatCondition);
    const appliesVat = saleAppliesVat(form.vatCondition);
    const grossSalePrice =
      appliesVat && !form.priceIncludesVat
        ? inputSalePrice * (1 + productVatRate / 100)
        : inputSalePrice;

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
      costVatRate: costVatRateFromCondition(form.vatCondition),
      roundTo: 100,
      roundingMode: "nearest" as const,
    };

    const rows = options.map((option) => {
      const result = calculatePriceSummary(
        product,
        option,
        categoryFee,
        taxes,
        null,
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
        null,
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

    return {
      costWithoutVat,
      inputSalePrice,
      grossSalePrice,
      appliesVat,
      productVatRate,
      product,
      rows,
      summary,
    };
  }, [form, categories, options, taxes]);

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

      <section className="card simulator-main-card">
        <div className="simulator-form-card">
          <div className="simulator-section-title">
            <span className="simulator-title-icon">⚡</span>
            <div>
              <h2>Simulación rápida</h2>
              <p className="small">Cargá los datos mínimos para analizar todos los canales.</p>
            </div>
          </div>

          <div className="simulator-form-grid">
            <div className="field">
              <label>Producto *</label>
              <input
                value={form.productName}
                onChange={(event) => update("productName", event.target.value)}
                placeholder='Ej: Smart TV Enova 43" Google TV'
              />
            </div>

            <div className="field">
              <label>Categoría *</label>
              <select
                value={form.category}
                onChange={(event) => update("category", event.target.value)}
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
              <label>Costo sin IVA *</label>
              <input
                type="text"
                inputMode="decimal"
                value={form.costWithoutVat}
                onChange={(event) => update("costWithoutVat", event.target.value)}
                placeholder="241332"
              />
              <span className="small">Costo del producto sin impuestos.</span>
            </div>

            <div className="field">
              <label>Precio de venta *</label>
              <input
                type="text"
                inputMode="decimal"
                value={form.salePrice}
                onChange={(event) => update("salePrice", event.target.value)}
                placeholder="317000"
              />
              <span className="small">Precio que querés analizar para vender.</span>
            </div>

            <div className="field">
              <label>Condición de IVA *</label>
              <select
                value={form.vatCondition}
                onChange={(event) => update("vatCondition", event.target.value as VatCondition)}
              >
                <option value="sin_factura">Sin factura / sin IVA</option>
                <option value="iva_21">Con IVA 21%</option>
                <option value="iva_105">Con IVA 10,5%</option>
              </select>
              <span className="small">Define IVA de venta y el IVA atribuido al costo.</span>
            </div>

            <div className="field">
              <label>¿El precio ingresado incluye IVA?</label>
              <div className="segmented-control">
                <button
                  type="button"
                  className={form.priceIncludesVat ? "active" : ""}
                  onClick={() => update("priceIncludesVat", true)}
                >
                  Sí, incluye IVA
                </button>
                <button
                  type="button"
                  className={!form.priceIncludesVat ? "active" : ""}
                  onClick={() => update("priceIncludesVat", false)}
                >
                  No, es sin IVA
                </button>
              </div>
            </div>
          </div>

          <div className="simulator-actions">
            <button className="button" type="button" onClick={calculate}>
              Calcular simulación
            </button>
            <button className="button ghost" type="button" onClick={clear}>
              Limpiar
            </button>
          </div>
        </div>

        <div className="simulator-summary-card">
          <div className="simulator-section-title">
            <span className="simulator-title-icon">▮</span>
            <div>
              <h2>Resumen rápido</h2>
              <p className="small">Referencia calculada sobre el primer canal.</p>
            </div>
          </div>

          <div className="simulator-summary-list">
            <div>
              <span>Precio de venta {simulation.appliesVat ? "(con IVA)" : ""}</span>
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
              <span>Margen bruto</span>
              <strong>{moneyWithCents(simulation.summary?.valid ? simulation.summary.grossProfit : 0)}</strong>
            </div>
            <div>
              <span>Ganancia</span>
              <strong>{moneyWithCents(simulation.summary?.valid ? simulation.summary.netProfit : 0)}</strong>
            </div>
            <div className="highlight">
              <span>Rentabilidad real</span>
              <strong>{simulation.summary?.valid ? percent(simulation.summary.marginOnNetSale) : "-"}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="card simulator-results-card">
        <div className="simulator-section-title">
          <span className="simulator-title-icon">◎</span>
          <div>
            <h2>Rentabilidad por canal</h2>
            <p className="small">
              Resultados calculados con la configuración actual de costos, impuestos y comisiones por canal.
            </p>
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
                  <th>Precio de venta ingresado</th>
                  <th>Rentabilidad %</th>
                  <th>Ganancia</th>
                  <th>Rentabilidad 0</th>
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
    </main>
  );
}
