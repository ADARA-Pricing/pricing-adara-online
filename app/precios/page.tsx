"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { createClient } from "@/lib/supabase";
import { calculateMercadoLibrePrice, defaultTaxSettings, money, percent } from "@/lib/pricing";
import type { MercadoLibreCategoryFee, MercadoLibreInstallmentFee, Product, TaxSettings } from "@/lib/types";

export default function PricesPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [query, setQuery] = useState("");
  const [selectedInstallment, setSelectedInstallment] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
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
    else setInstallments((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]);

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

  const rows = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    const output: Array<{
      product: Product;
      installment: MercadoLibreInstallmentFee;
      categoryFee?: MercadoLibreCategoryFee;
      result: ReturnType<typeof calculateMercadoLibrePrice>;
    }> = [];

    const filteredProducts = products.filter((product) => {
      const text = `${product.sku} ${product.name} ${product.brand || ""} ${product.model || ""} ${product.category || ""}`.toLowerCase();
      const matchesQuery = !normalizedQuery || text.includes(normalizedQuery);
      const matchesCategory = selectedCategory === "all" || product.category === selectedCategory;
      return matchesQuery && matchesCategory;
    });

    const filteredInstallments = installments.filter((item) => selectedInstallment === "all" || item.code === selectedInstallment);

    filteredProducts.forEach((product) => {
      const categoryFee = categoryFees.find((item) => item.category?.toLowerCase() === (product.category || "").toLowerCase());
      filteredInstallments.forEach((installment) => {
        output.push({ product, installment, categoryFee, result: calculateMercadoLibrePrice(product, installment, categoryFee, taxes) });
      });
    });

    return output;
  }, [products, installments, categoryFees, taxes, query, selectedInstallment, selectedCategory]);

  return (
    <main className="container wide">
      <header className="header">
        <div className="brand">
          <h1>Precios MercadoLibre</h1>
          <p>Cálculo usando comisión por categoría + costo de cuotas + impuestos configurables</p>
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
            <label>Publicación / cuotas ML</label>
            <select value={selectedInstallment} onChange={(e) => setSelectedInstallment(e.target.value)}>
              <option value="all">Todas</option>
              {installments.map((item) => <option key={item.id || item.code} value={item.code}>{item.code} - {item.name}</option>)}
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
        <p className="small" style={{ marginBottom: 0 }}>
          Fórmula actual: costo sin IVA / (1 - ganancia - comisión categoría ML - costo cuotas - impuestos) x IVA del producto. La comisión de categoría y el costo de cuotas están separados para poder actualizarlos cuando MercadoLibre cambie las condiciones.
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
                {rows.map(({ product, installment, categoryFee, result }) => (
                  <tr key={`${product.id}-${installment.id || installment.code}`}>
                    <td>{product.sku}</td>
                    <td><strong>{product.name}</strong><br /><span className="small">{product.brand || ""} {product.model || ""}</span></td>
                    <td>{product.category || "-"}</td>
                    <td>{installment.code}</td>
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
