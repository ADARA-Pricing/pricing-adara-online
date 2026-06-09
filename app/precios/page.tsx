"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { createClient } from "@/lib/supabase";
import { calculatePriceSummary, defaultTaxSettings, mercadoLibreClassicOption, money, moneyWithCents, normalizeOption, percent, toNumber } from "@/lib/pricing";
import type { MercadoLibreCategoryFee, MercadoLibreInstallmentFee, MercadoLibrePriceOption, MercadoLibreShippingCost, Product, ProductChannelMargin, TaxSettings } from "@/lib/types";

type MarginMode = "margin" | "net";
type SyncMode = "none" | "margin" | "net";

type ModalState = {
  product: Product;
  mode: MarginMode;
  syncMode: SyncMode;
  margins: Record<string, number>;
  netProfits: Record<string, number | null>;
  priceOverrides: Record<string, number | null>;
  taxOverrides: TaxSettings;
};

export default function PricesPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [shippingCosts, setShippingCosts] = useState<MercadoLibreShippingCost[]>([]);
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);

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
    const [productsResponse, installmentsResponse, categoryFeesResponse, taxesResponse, shippingResponse, marginsResponse] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active").order("name", { ascending: true }),
      supabase.from("mercadolibre_installment_fees").select("*").eq("active", true).order("code", { ascending: true }),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").single(),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true),
      supabase.from("product_channel_margins").select("*")
    ]);
    setLoading(false);

    if (productsResponse.error) setError(productsResponse.error.message); else setProducts((productsResponse.data || []) as Product[]);
    if (installmentsResponse.error) setError(installmentsResponse.error.message); else setInstallments(((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]).filter((item) => item.code !== "MC"));
    if (categoryFeesResponse.error) setError(categoryFeesResponse.error.message); else setCategoryFees((categoryFeesResponse.data || []) as MercadoLibreCategoryFee[]);
    if (taxesResponse.error) setError(taxesResponse.error.message); else setTaxes((taxesResponse.data || defaultTaxSettings()) as TaxSettings);
    if (shippingResponse.error) setError(shippingResponse.error.message); else setShippingCosts((shippingResponse.data || []) as MercadoLibreShippingCost[]);
    if (marginsResponse.error) setError(marginsResponse.error.message); else setMarginSettings((marginsResponse.data || []) as ProductChannelMargin[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pricingOptions = useMemo<MercadoLibrePriceOption[]>(() => {
    return [mercadoLibreClassicOption(), ...installments.map((item) => normalizeOption({
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
      active: item.active
    }))];
  }, [installments]);

  const categories = useMemo(() => {
    const values = products
      .map((product) => product.category || "")
      .filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = query.toLowerCase();
    return products.filter((product) => {
      const text = `${product.sku} ${product.name} ${product.brand || ""} ${product.model || ""} ${product.category || ""}`.toLowerCase();
      const matchesQuery = !q || text.includes(q);
      const matchesCategory = !categoryFilter || (product.category || "") === categoryFilter;
      return matchesQuery && matchesCategory;
    });
  }, [products, query, categoryFilter]);

  function getMargin(productId: string | undefined, channelCode: string) {
    const setting = marginSettings.find((item) => item.product_id === productId && item.channel_code === channelCode);
    return Number(setting?.desired_margin_rate ?? 5);
  }

  function getNetProfit(productId: string | undefined, channelCode: string) {
    const setting = marginSettings.find((item) => item.product_id === productId && item.channel_code === channelCode);
    return setting?.desired_net_profit ?? null;
  }

  function formatInputNumber(value: number | null | undefined, decimals = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
    const fixed = Number(value).toFixed(decimals);
    return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function openProductModal(product: Product) {
    const margins: Record<string, number> = {};
    const netProfits: Record<string, number | null> = {};
    const priceOverrides: Record<string, number | null> = {};
    pricingOptions.forEach((option) => {
      margins[option.code] = getMargin(product.id, option.code);
      netProfits[option.code] = getNetProfit(product.id, option.code);
      priceOverrides[option.code] = null;
    });
    setModal({ product, mode: "margin", syncMode: "none", margins, netProfits, priceOverrides, taxOverrides: { ...taxes } });
  }

  function effectiveMargin(channelCode: string) {
    if (!modal) return 5;
    if (modal.syncMode === "margin" && channelCode !== "MC") return Number(modal.margins.MC ?? 5);
    return Number(modal.margins[channelCode] ?? 5);
  }

  function effectiveNetProfit(channelCode: string) {
    if (!modal) return null;
    if (modal.syncMode === "net" && channelCode !== "MC") return modal.netProfits.MC ?? null;
    if (modal.syncMode === "margin") return null;
    return modal.netProfits[channelCode] ?? null;
  }

  async function saveMargins() {
    if (!modal || !modal.product.id) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const rows = modalRows().map(({ option, result }) => ({
      product_id: modal.product.id,
      sku: modal.product.sku,
      channel_code: option.code,
      desired_margin_rate: result.valid ? Number(result.marginOnNetSale || 0) : effectiveMargin(option.code),
      desired_net_profit: effectiveNetProfit(option.code)
    }));

    const { error } = await supabase.from("product_channel_margins").upsert(rows, { onConflict: "product_id,channel_code" });
    setSaving(false);
    if (error) setError(error.message);
    else {
      setMessage("Márgenes guardados correctamente.");
      await loadData();
    }
  }

  function updateMargin(channelCode: string, value: string) {
    if (!modal) return;
    const margin = Number(toNumber(value) ?? 0);
    setModal({
      ...modal,
      mode: "margin",
      margins: { ...modal.margins, [channelCode]: margin },
      netProfits: { ...modal.netProfits, [channelCode]: null },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: null }
    });
  }

  function updateNetProfit(channelCode: string, value: string) {
    if (!modal) return;
    const net = toNumber(value);
    setModal({
      ...modal,
      mode: "net",
      netProfits: { ...modal.netProfits, [channelCode]: net },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: null }
    });
  }

  function updateSalePrice(channelCode: string, value: string) {
    if (!modal) return;
    const salePrice = toNumber(value);
    if (salePrice === null) {
      setModal({
        ...modal,
        priceOverrides: { ...modal.priceOverrides, [channelCode]: null }
      });
      return;
    }

    const product = modal.product;
    const option = pricingOptions.find((item) => item.code === channelCode);
    if (!option) return;
    const normalizedOption = normalizeOption(option);
    const categoryFee = categoryFees.find((item) => item.category?.toLowerCase() === (product.category || "").toLowerCase());
    const shippingCost = shippingCosts.find((item) => item.product_id === product.id || item.sku === product.sku);
    const result = calculatePriceSummary(
      product,
      normalizedOption,
      normalizedOption.applies_marketplace_fee ? categoryFee : null,
      modal.taxOverrides,
      normalizedOption.applies_shipping ? shippingCost : null,
      {
        salePrice,
        desiredMarginRate: effectiveMargin(channelCode),
        desiredNetProfit: null,
        roundTo: 100,
        roundingMode: "nearest"
      }
    ) as any;

    setModal({
      ...modal,
      mode: "margin",
      margins: { ...modal.margins, [channelCode]: result.valid ? Number((result.marginOnNetSale || 0).toFixed(2)) : Number(modal.margins[channelCode] || 0) },
      netProfits: { ...modal.netProfits, [channelCode]: null },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: salePrice }
    });
  }

  function setSyncMode(syncMode: SyncMode) {
    if (!modal) return;
    setModal({ ...modal, syncMode });
  }

  function updateTaxOverride(field: keyof Pick<TaxSettings, "iibb_rate" | "idc_rate" | "iigg_rate" | "structure_rate">, value: string) {
    if (!modal) return;
    setModal({
      ...modal,
      taxOverrides: {
        ...modal.taxOverrides,
        [field]: Number(toNumber(value) ?? 0)
      }
    });
  }

  function resetTaxOverrides() {
    if (!modal) return;
    setModal({ ...modal, taxOverrides: { ...taxes } });
  }

  function modalRows() {
    if (!modal) return [];
    const product = modal.product;
    const categoryFee = categoryFees.find((item) => item.category?.toLowerCase() === (product.category || "").toLowerCase());
    const shippingCost = shippingCosts.find((item) => item.product_id === product.id || item.sku === product.sku);
    return pricingOptions.map((option) => {
      const desiredNetProfit = effectiveNetProfit(option.code);
      const desiredMargin = effectiveMargin(option.code);
      const normalizedOption = normalizeOption(option);
      const feeForOption = normalizedOption.applies_marketplace_fee ? categoryFee : null;
      const shippingForOption = normalizedOption.applies_shipping ? shippingCost : null;
      const salePriceOverride = modal.priceOverrides[option.code] ?? null;
      const result = calculatePriceSummary(product, normalizedOption, feeForOption, modal.taxOverrides, shippingForOption, {
        desiredMarginRate: desiredMargin,
        desiredNetProfit,
        salePrice: salePriceOverride,
        roundTo: 100,
        roundingMode: "nearest"
      });
      return { option: normalizedOption, categoryFee: feeForOption, shippingCost: shippingForOption, result: result as any, desiredMargin, desiredNetProfit, salePriceOverride };
    });
  }

  function calculateMcPriceForProduct(product: Product) {
    const categoryFee = categoryFees.find((item) => item.category?.toLowerCase() === (product.category || "").toLowerCase());
    const shippingCost = shippingCosts.find((item) => item.product_id === product.id || item.sku === product.sku);
    const result = calculatePriceSummary(product, mercadoLibreClassicOption(), categoryFee, taxes, shippingCost, {
      desiredMarginRate: getMargin(product.id, "MC"),
      desiredNetProfit: getNetProfit(product.id, "MC"),
      roundTo: 100,
      roundingMode: "nearest"
    }) as any;
    return result.valid ? moneyWithCents(result.roundedPrice) : "-";
  }

  const currentRows = modalRows();
  const mcRow = currentRows.find((row) => row.option.code === "MC");
  const otherRows = currentRows.filter((row) => row.option.code !== "MC");

  return (
    <main className="container wide">
      <header className="header">
        <div className="brand">
          <h1>Precios</h1>
          <p>Buscá un producto, abrí el resumen y definí el margen deseado o la ganancia neta por canal.</p>
        </div>
        <div className="nav">
          <button className="button ghost" onClick={loadData}>Actualizar</button>
          <AppNav onLogout={logout} />
        </div>
      </header>

      {error && <div className="message error">{error}</div>}
      {message && <div className="message success">{message}</div>}

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="grid two">
          <div className="field">
            <label>Buscar producto</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por SKU, nombre, marca o modelo" />
          </div>
          <div className="field">
            <label>Categoría</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Todas las categorías</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        {loading ? <p>Cargando productos...</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Costo s/IVA</th>
                  <th>IVA</th>
                  <th>Margen base</th>
                  <th>Precio MC</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id || product.sku}>
                    <td>{product.sku}</td>
                    <td><strong>{product.name}</strong><br /><span className="small">{product.brand || ""} {product.model || ""}</span></td>
                    <td>{product.category || "-"}</td>
                    <td>{money(product.cost_without_vat)}</td>
                    <td>{product.vat_rate}%</td>
                    <td>{percent(getMargin(product.id, "MC"))}</td>
                    <td><strong>{calculateMcPriceForProduct(product)}</strong></td>
                    <td><button className="button ghost" onClick={() => openProductModal(product)}>Calcular / editar</button></td>
                  </tr>
                ))}
                {filteredProducts.length === 0 && <tr><td colSpan={8}>No se encontraron productos.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="header" style={{ marginBottom: 12 }}>
              <div className="brand">
                <h2>{modal.product.name}</h2>
                <p>SKU {modal.product.sku} · Categoría {modal.product.category || "sin categoría"} · Costo {money(modal.product.cost_without_vat)} + IVA {modal.product.vat_rate}%</p>
              </div>
              <button className="button ghost" onClick={() => setModal(null)}>Cerrar</button>
            </div>

            <p className="small">El resumen completo se muestra sobre MercadoLibre Clásica. Las demás condiciones/canales se listan debajo con su precio, ganancia y margen.</p>

            <div className="card soft pricing-modal-card" style={{ marginBottom: 16 }}>
              <div className="pricing-modal-grid">
                <div className="pricing-panel">
                  <h3>Condición base: MC</h3>
                  <p className="small">MercadoLibre Clásica</p>

                  <div className="grid two compact-input-grid">
                    <div className="field">
                      <label>Margen deseado %</label>
                      <input type="text" inputMode="decimal" value={formatInputNumber(modal.margins.MC ?? 5)} onChange={(e) => updateMargin("MC", e.target.value)} disabled={modal.syncMode === "net"} className={modal.syncMode === "net" ? "input-disabled" : ""} />
                    </div>
                    <div className="field">
                      <label>Ganancia neta objetivo</label>
                      <input type="text" inputMode="decimal" value={formatInputNumber(modal.netProfits.MC)} placeholder="Opcional" onChange={(e) => updateNetProfit("MC", e.target.value)} disabled={modal.syncMode === "margin"} className={modal.syncMode === "margin" ? "input-disabled" : ""} />
                    </div>
                  </div>

                  <div className="sync-options">
                    <label className="checkbox-row">
                      <input type="checkbox" checked={modal.syncMode === "margin"} onChange={(e) => setSyncMode(e.target.checked ? "margin" : "none")} />
                      <span>Aplicar % a todos</span>
                    </label>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={modal.syncMode === "net"} onChange={(e) => setSyncMode(e.target.checked ? "net" : "none")} />
                      <span>Aplicar margen a todos</span>
                    </label>
                  </div>
                  <p className="small">Solo puede estar activa una opción. Cuando está activa, las demás condiciones toman el valor de MC y quedan bloqueadas.</p>

                  <h4>Datos de cálculo</h4>
                  <div className="calc-summary compact">
                    <div>Categoría: {modal.product.category || "-"}</div>
                    <div>Comisión: {mcRow?.result?.valid ? percent(mcRow.result.marketplaceFeeRate) : "-"}</div>
                    <div>Envío c/IVA: {mcRow?.result?.valid ? moneyWithCents(mcRow.result.shippingCostAmountGross) : "-"}</div>
                    <div>Envío s/IVA: {mcRow?.result?.valid ? moneyWithCents(mcRow.result.shippingCostAmount) : "-"}</div>
                    <div>IVA: {percent(modal.product.vat_rate)}</div>
                  </div>
                </div>

                <div className="pricing-panel">
                  <h4>Impuestos para esta prueba</h4>
                  <p className="small">Estos valores modifican solo este cálculo. No cambian la solapa Impuestos.</p>
                  <div className="grid two compact-input-grid">
                    <div className="field">
                      <label>IIBB %</label>
                      <input type="text" inputMode="decimal" value={formatInputNumber(modal.taxOverrides.iibb_rate)} onChange={(e) => updateTaxOverride("iibb_rate", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>IDC %</label>
                      <input type="text" inputMode="decimal" value={formatInputNumber(modal.taxOverrides.idc_rate)} onChange={(e) => updateTaxOverride("idc_rate", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>IIGG %</label>
                      <input type="text" inputMode="decimal" value={formatInputNumber(modal.taxOverrides.iigg_rate)} onChange={(e) => updateTaxOverride("iigg_rate", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Estructura %</label>
                      <input type="text" inputMode="decimal" value={formatInputNumber(modal.taxOverrides.structure_rate)} onChange={(e) => updateTaxOverride("structure_rate", e.target.value)} />
                    </div>
                  </div>
                  <button className="button ghost tax-reset-button" type="button" onClick={resetTaxOverrides}>Restablecer impuestos globales</button>
                </div>

                <div className="pricing-panel summary-panel">
                  <h4>Resumen MC</h4>
                  {mcRow?.result?.valid ? (
                    <div className="calc-summary">
                      <div className="field inline-price-field"><label>Precio de venta</label><input type="text" inputMode="decimal" value={formatInputNumber(modal.priceOverrides.MC ?? mcRow.result.roundedPrice, 0)} onChange={(e) => updateSalePrice("MC", e.target.value)} /></div>
                      <div>IVA venta: -{moneyWithCents(mcRow.result.vatAmount)}</div>
                      <div>Precio sin IVA: {moneyWithCents(mcRow.result.netSalePrice)}</div>
                      <div>Comisión x venta: -{moneyWithCents(mcRow.result.marketplaceFeeAmount)}</div>
                      <div>Ingresos brutos: -{moneyWithCents(mcRow.result.iibbAmount)}</div>
                      <br />
                      <div>Envío s/IVA: -{moneyWithCents(mcRow.result.shippingCostAmount)}</div>
                      <div>Gasto de estructura: -{moneyWithCents(mcRow.result.structureAmount)}</div>
                      <div>Costo: -{moneyWithCents(modal.product.cost_without_vat)}</div>
                      <br />
                      <div>Margen bruto: {moneyWithCents(mcRow.result.grossProfit)}</div>
                      <div>Imp. Ganancias: -{moneyWithCents(mcRow.result.incomeTaxAmount)}</div>
                      <br />
                      <div><strong>Ganancia:</strong> {moneyWithCents(mcRow.result.netProfit)}</div>
                      <div><strong>Margen real:</strong> {percent(mcRow.result.marginOnNetSale)}</div>
                    </div>
                  ) : <span className="message error">{mcRow?.result?.error || "No se pudo calcular MC."}</span>}
                </div>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Condición / canal</th>
                    <th>Margen deseado %</th>
                    <th>Ganancia neta objetivo</th>
                    <th>Precio de venta</th>
                    <th>Ganancia</th>
                    <th>Margen real</th>
                  </tr>
                </thead>
                <tbody>
                  {otherRows.map(({ option, result, desiredMargin, desiredNetProfit }) => {
                    const lockMargin = modal.syncMode === "margin";
                    const lockNet = modal.syncMode === "net";
                    
                    return (
                      <tr key={option.code}>
                        <td><strong>{option.code}</strong><br /><span className="small">{option.name}</span></td>
                        <td style={{ minWidth: 130 }}>
                          <input type="text" inputMode="decimal" value={formatInputNumber(desiredMargin)} onChange={(e) => updateMargin(option.code, e.target.value)} disabled={lockMargin || lockNet} className={(lockMargin || lockNet) ? "input-disabled" : ""} />
                        </td>
                        <td style={{ minWidth: 150 }}>
                          <input type="text" inputMode="decimal" value={formatInputNumber(desiredNetProfit)} placeholder="Opcional" onChange={(e) => updateNetProfit(option.code, e.target.value)} disabled={lockMargin || lockNet} className={(lockMargin || lockNet) ? "input-disabled" : ""} />
                        </td>
                        <td className="price-input-cell" style={{ minWidth: 150 }}><input type="text" inputMode="decimal" value={formatInputNumber(modal.priceOverrides[option.code] ?? (result.valid ? result.roundedPrice : null), 0)} onChange={(e) => updateSalePrice(option.code, e.target.value)} disabled={lockMargin || lockNet} className={(lockMargin || lockNet) ? "input-disabled" : ""} /></td>
                        <td>{result.valid ? moneyWithCents(result.netProfit) : "-"}</td>
                        <td>{result.valid ? percent(result.marginOnNetSale) : result.error}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="button ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="button" disabled={saving} onClick={saveMargins}>{saving ? "Guardando..." : "Guardar márgenes"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
