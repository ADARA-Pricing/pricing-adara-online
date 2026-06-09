"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { createClient } from "@/lib/supabase";
import { calculatePriceSummary, defaultTaxSettings, mercadoLibreClassicOption, money, moneyWithCents, percent, toNumber } from "@/lib/pricing";
import type { MercadoLibreCategoryFee, MercadoLibreInstallmentFee, MercadoLibrePriceOption, MercadoLibreShippingCost, Product, ProductChannelMargin, TaxSettings } from "@/lib/types";

type MarginMode = "margin" | "net";

type ModalState = {
  product: Product;
  mode: MarginMode;
  margins: Record<string, number>;
  netProfits: Record<string, number | null>;
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
    return [mercadoLibreClassicOption(), ...installments.map((item) => ({
      code: item.code,
      name: item.name,
      installment_count: item.installment_count,
      financing_fee_rate: item.financing_fee_rate,
      active: item.active
    }))];
  }, [installments]);

  const filteredProducts = useMemo(() => {
    const q = query.toLowerCase();
    return products.filter((product) => {
      const text = `${product.sku} ${product.name} ${product.brand || ""} ${product.model || ""} ${product.category || ""}`.toLowerCase();
      return !q || text.includes(q);
    });
  }, [products, query]);

  function getMargin(productId: string | undefined, channelCode: string) {
    const setting = marginSettings.find((item) => item.product_id === productId && item.channel_code === channelCode);
    return Number(setting?.desired_margin_rate ?? 5);
  }

  function getNetProfit(productId: string | undefined, channelCode: string) {
    const setting = marginSettings.find((item) => item.product_id === productId && item.channel_code === channelCode);
    return setting?.desired_net_profit ?? null;
  }

  function openProductModal(product: Product) {
    const margins: Record<string, number> = {};
    const netProfits: Record<string, number | null> = {};
    pricingOptions.forEach((option) => {
      margins[option.code] = getMargin(product.id, option.code);
      netProfits[option.code] = getNetProfit(product.id, option.code);
    });
    setModal({ product, mode: "margin", margins, netProfits });
  }

  async function saveMargins() {
    if (!modal || !modal.product.id) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const rows = pricingOptions.map((option) => ({
      product_id: modal.product.id,
      sku: modal.product.sku,
      channel_code: option.code,
      desired_margin_rate: Number(modal.margins[option.code] ?? 5),
      desired_net_profit: modal.netProfits[option.code]
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
      netProfits: { ...modal.netProfits, [channelCode]: null }
    });
  }

  function updateNetProfit(channelCode: string, value: string) {
    if (!modal) return;
    const net = toNumber(value);
    setModal({
      ...modal,
      mode: "net",
      netProfits: { ...modal.netProfits, [channelCode]: net }
    });
  }

  function modalRows() {
    if (!modal) return [];
    const product = modal.product;
    const categoryFee = categoryFees.find((item) => item.category?.toLowerCase() === (product.category || "").toLowerCase());
    const shippingCost = shippingCosts.find((item) => item.product_id === product.id || item.sku === product.sku);
    return pricingOptions.map((option) => {
      const desiredNetProfit = modal.netProfits[option.code];
      const desiredMargin = modal.margins[option.code] ?? 5;
      const result = calculatePriceSummary(product, option, categoryFee, taxes, shippingCost, {
        desiredMarginRate: desiredMargin,
        desiredNetProfit,
        roundTo: 100,
        roundingMode: "nearest"
      });
      return { option, categoryFee, shippingCost, result: result as any };
    });
  }

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
        <div className="field">
          <label>Buscar producto</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por SKU, nombre, marca, modelo o categoría" />
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
                    <td><button className="button ghost" onClick={() => openProductModal(product)}>Calcular / editar</button></td>
                  </tr>
                ))}
                {filteredProducts.length === 0 && <tr><td colSpan={7}>No se encontraron productos.</td></tr>}
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

            <p className="small">Los datos en rojo vienen de categoría, costos por canal, envíos e impuestos. Los valores editables son margen deseado % o ganancia neta. Por defecto todos los canales se crean con 5%.</p>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Canal</th>
                    <th>Margen deseado %</th>
                    <th>Ganancia neta objetivo</th>
                    <th>Datos de cálculo</th>
                    <th>Resumen</th>
                  </tr>
                </thead>
                <tbody>
                  {modalRows().map(({ option, result }) => (
                    <tr key={option.code}>
                      <td><strong>{option.code}</strong><br /><span className="small">{option.name}</span></td>
                      <td style={{ minWidth: 130 }}>
                        <input type="number" step="0.01" value={modal.margins[option.code] ?? 5} onChange={(e) => updateMargin(option.code, e.target.value)} />
                      </td>
                      <td style={{ minWidth: 150 }}>
                        <input type="number" step="0.01" value={modal.netProfits[option.code] ?? ""} placeholder="Opcional" onChange={(e) => updateNetProfit(option.code, e.target.value)} />
                      </td>
                      <td className="calc-red">
                        <div>Categoría: {modal.product.category || "-"}</div>
                        <div>Comisión: {percent(result.marketplaceFeeRate)}</div>
                        <div>Envío: {moneyWithCents(result.shippingCostAmount)}</div>
                        <div>IVA: {percent(modal.product.vat_rate)}</div>
                        <div>Ganancias: {percent(result.iiggRate)}</div>
                        <div>IDC: {percent(result.idcRate)}</div>
                        <div>IIBB: {percent(result.iibbRate)}</div>
                        <div>Estructura: {percent(result.structureRate)}</div>
                      </td>
                      <td className="calc-green">
                        {result.valid ? (
                          <>
                            <div><strong>Precio de venta:</strong> {moneyWithCents(result.roundedPrice)}</div>
                            <div>IVA venta: -{moneyWithCents(result.vatAmount)}</div>
                            <div>Precio sin IVA: {moneyWithCents(result.netSalePrice)}</div>
                            <div>Comisión x venta: -{moneyWithCents(result.marketplaceFeeAmount)}</div>
                            <div>Ingresos brutos: -{moneyWithCents(result.iibbAmount)}</div>
                            <br />
                            <div>Envío: -{moneyWithCents(result.shippingCostAmount)}</div>
                            <div>Gasto de estructura: -{moneyWithCents(result.structureAmount)}</div>
                            <div>Costo: -{moneyWithCents(modal.product.cost_without_vat)}</div>
                            <br />
                            <div>Margen bruto: {moneyWithCents(result.grossProfit)}</div>
                            <div>Imp. Ganancias: -{moneyWithCents(result.incomeTaxAmount)}</div>
                            <br />
                            <div><strong>Ganancia:</strong> {moneyWithCents(result.netProfit)}</div>
                            <div><strong>Margen real:</strong> {percent(result.marginOnNetSale)}</div>
                          </>
                        ) : <span className="message error">{result.error}</span>}
                      </td>
                    </tr>
                  ))}
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
