"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { createClient } from "@/lib/supabase";
import { calculateMercadoLibrePrice, defaultTaxSettings, mercadoLibreClassicOption, money, percent } from "@/lib/pricing";
import type { MercadoLibreCategoryFee, MercadoLibreInstallmentFee, MercadoLibrePriceOption, Product, RoundingMode, TaxSettings } from "@/lib/types";

export default function PricesPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [query, setQuery] = useState("");
  const [selectedOption, setSelectedOption] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [desiredProfitRate, setDesiredProfitRate] = useState(10);
  const [roundTo, setRoundTo] = useState(100);
  const [roundingMode, setRoundingMode] = useState<RoundingMode>("nearest");
  const [loading, setLoading] = useState(true);
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
    const [productsResponse, installmentsResponse, categoryFeesResponse, taxesResponse] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active").order("name", { ascending: true }),
      supabase.from("mercadolibre_installment_fees").select("*").eq("active", true).order("code", { ascending: true }),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").single()
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
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((product) => product.category && set.add(product.category));
    return Array.from(set).sort();
  }, [products]);

  const pricingOptions = useMemo<MercadoLibrePriceOption[]>(() => {
    return [mercadoLibreClassicOption(), ...installments.map((item) => ({
      code: item.code,
      name: item.name,
      installment_count: item.installment_count,
      financing_fee_rate: item.financing_fee_rate,
      active: item.active
    }))];
  }, [installments]);

  const rows = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    const output: Array<{
      product: Product;
      option: MercadoLibrePriceOption;
      categoryFee?: MercadoLibreCategoryFee;
      result: ReturnType<typeof calculateMercadoLibrePrice>;
    }> = [];

    const filteredProducts = products.filter((product) => {
      const text = `${product.sku} ${product.name} ${product.brand || ""} ${product.model || ""} ${product.category || ""}`.toLowerCase();
      const matchesQuery = !normalizedQuery || text.includes(normalizedQuery);
      const matchesCategory = selectedCategory === "all" || product.category === selectedCategory;
      return matchesQuery && matchesCategory;
    });

    const filteredOptions = pricingOptions.filter((item) => selectedOption === "all" || item.code === selectedOption);

    filteredProducts.forEach((product) => {
      const categoryFee = categoryFees.find((item) => item.category?.toLowerCase() === (product.category || "").toLowerCase());
      filteredOptions.forEach((option) => {
        output.push({
          product,
          option,
          categoryFee,
          result: calculateMercadoLibrePrice(product, option, categoryFee, taxes, desiredProfitRate, roundTo, roundingMode)
        });
      });
    });

    return output;
  }, [products, pricingOptions, categoryFees, taxes, query, selectedOption, selectedCategory, desiredProfitRate, roundTo, roundingMode]);

  return (
    <main className="container wide">
      <header className="header">
        <div className="brand">
          <h1>Precios MercadoLibre</h1>
          <p>ML Clásica usa solo comisión por categoría. Premium suma costo de cuotas. Los impuestos van por separado.</p>
        </div>
        <div className="nav">
          <button className="button ghost" onClick={loadData}>Actualizar</button>
          <AppNav onLogout={logout} />
        </div>
      </header>

      {error && <div className="message error">{error}</div>}

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="grid">
          <div className="field">
            <label>Buscar producto</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SKU, nombre, marca, modelo" />
          </div>
          <div className="field">
            <label>Tipo de publicación</label>
            <select value={selectedOption} onChange={(e) => setSelectedOption(e.target.value)}>
              <option value="all">Todas</option>
              {pricingOptions.map((item) => <option key={item.code} value={item.code}>{item.code} - {item.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Categoría</label>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              <option value="all">Todas</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Resultados</label>
            <input value={`${rows.length} combinaciones`} disabled />
          </div>
        </div>

        <div className="grid" style={{ marginTop: 14 }}>
          <div className="field">
            <label>Ganancia deseada %</label>
            <input type="number" step="0.01" value={desiredProfitRate} onChange={(e) => setDesiredProfitRate(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Redondear a</label>
            <input type="number" min="1" step="1" value={roundTo} onChange={(e) => setRoundTo(Number(e.target.value || 1))} />
          </div>
          <div className="field">
            <label>Modo redondeo</label>
            <select value={roundingMode} onChange={(e) => setRoundingMode(e.target.value as RoundingMode)}>
              <option value="nearest">Más cercano</option>
              <option value="up">Hacia arriba</option>
              <option value="down">Hacia abajo</option>
            </select>
          </div>
          <div className="field">
            <label>Impuestos activos</label>
            <input value={`IIBB ${taxes.iibb_rate}% / IDC ${taxes.idc_rate}% / IIGG ${taxes.iigg_rate}% / Est. ${taxes.structure_rate}%`} disabled />
          </div>
        </div>

        <p className="small" style={{ marginBottom: 0, marginTop: 12 }}>
          Fórmula actual: costo sin IVA / (1 - ganancia deseada - comisión ML categoría - costo cuotas - impuestos) x IVA del producto. La ganancia y el redondeo se definen acá para simular precios, no en MercadoLibre.
        </p>
      </section>

      <section className="card">
        {loading ? <p>Cargando precios...</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>ML</th>
                  <th>Costo s/IVA</th>
                  <th>IVA</th>
                  <th>Comisión categoría</th>
                  <th>Costo cuotas</th>
                  <th>Impuestos</th>
                  <th>Ganancia</th>
                  <th>Variable total</th>
                  <th>Precio calculado</th>
                  <th>Precio redondeado</th>
                  <th>Resultado neto</th>
                  <th>Margen costo</th>
                  <th>Estado categoría</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, option, categoryFee, result }) => (
                  <tr key={`${product.id}-${option.code}`}>
                    <td>{product.sku}</td>
                    <td><strong>{product.name}</strong><br /><span className="small">{product.brand || ""} {product.model || ""}</span></td>
                    <td>{product.category || "-"}</td>
                    <td><strong>{option.code}</strong><br /><span className="small">{option.name}</span></td>
                    <td>{money(product.cost_without_vat)}</td>
                    <td>{product.vat_rate}%</td>
                    <td>{percent(result.marketplaceFeeRate)}</td>
                    <td>{percent(result.financingFeeRate)}</td>
                    <td>{percent(result.taxesRate)}</td>
                    <td>{percent(result.marginRate)}</td>
                    <td>{percent(result.variableRate)}</td>
                    <td>{result.valid ? money(result.price) : result.error}</td>
                    <td><strong>{result.valid ? money(result.roundedPrice) : "-"}</strong></td>
                    <td>{result.valid ? money(result.netProfit) : "-"}</td>
                    <td>{result.valid ? percent(result.marginOnCost) : "-"}</td>
                    <td>{categoryFee ? <span className="badge">configurada</span> : <span className="badge">sin comisión</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={16}>No hay precios para mostrar. Cargá productos activos y configuraciones activas de MercadoLibre.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
