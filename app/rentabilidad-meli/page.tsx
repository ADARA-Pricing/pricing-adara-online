"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Calculator, RefreshCw, Search } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { moneyWithCents, percent } from "@/lib/pricing";
import type { MercadoLibreOrderItem, MercadoLibreShippingCost, Product } from "@/lib/types";

type Period = 7 | 30 | 60;
type SortKey = "sku" | "productName" | "units" | "revenue" | "netProfit" | "margin" | "stock" | "lastSale";
type SortDirection = "asc" | "desc";

type ProfitabilityRow = {
  sku: string;
  productName: string;
  category?: string | null;
  stock: number;
  activePublications: number;
  units: number;
  revenue: number;
  netProfit: number;
  netSale: number;
  margin: number | null;
  avgPrice: number | null;
  lastSale?: string | null;
  errors: number;
};

function numberValue(value: unknown) {
  return Number(value || 0);
}

function daysBetween(from: string) {
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) return Infinity;
  return (Date.now() - date.getTime()) / 86400000;
}

function shortDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(value));
}

function sortIcon(key: SortKey, sortKey: SortKey, direction: SortDirection) {
  if (key !== sortKey) return <ArrowUpDown aria-hidden="true" />;
  return direction === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />;
}

export default function RentabilidadMeliPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [period, setPeriod] = useState<Period>(30);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("netProfit");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function fetchSalesSince(sinceIso: string) {
    const pageSize = 1000;
    const result: MercadoLibreOrderItem[] = [];

    for (let from = 0; from < 30000; from += pageSize) {
      const to = from + pageSize - 1;
      const response = await supabase
        .from("mercadolibre_order_items")
        .select("*")
        .gte("order_date", sinceIso)
        .order("order_date", { ascending: false })
        .range(from, to);

      if (response.error) return response;
      const page = (response.data || []) as MercadoLibreOrderItem[];
      result.push(...page);
      if (page.length < pageSize) break;
    }

    return { data: result, error: null };
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    const since = new Date();
    since.setDate(since.getDate() - 65);

    const [productsResponse, publicationsResponse, salesResponse] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active").order("sku", { ascending: true }),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true).eq("meli_status", "active"),
      fetchSalesSince(since.toISOString()),
    ]);

    setLoading(false);
    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);
    if (publicationsResponse.error) setError(publicationsResponse.error.message);
    else setPublications((publicationsResponse.data || []) as MercadoLibreShippingCost[]);
    if (salesResponse.error) setError(salesResponse.error.message);
    else setSales((salesResponse.data || []) as MercadoLibreOrderItem[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncSales() {
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch("/api/mercadolibre/sync-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 60, chunkDays: 7 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudieron sincronizar ventas.");
      setSyncInfo(`Ventas ML: ${data.saved || 0} items guardados, ${data.scanned || 0} ordenes revisadas.`);
      await loadData();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudieron sincronizar ventas.");
    } finally {
      setSyncing(false);
    }
  }

  const rows = useMemo<ProfitabilityRow[]>(() => {
    const productById = new Map(products.map((product) => [product.id, product]));
    const productBySku = new Map(products.map((product) => [product.sku.toUpperCase(), product]));
    const publicationBySku = new Map<string, MercadoLibreShippingCost[]>();
    publications.forEach((publication) => {
      const product = productById.get(publication.product_id);
      const sku = (publication.sku || product?.sku || "").toUpperCase();
      if (!sku) return;
      publicationBySku.set(sku, [...(publicationBySku.get(sku) || []), publication]);
    });

    const salesBySku = new Map<string, MercadoLibreOrderItem[]>();
    sales
      .filter((sale) => daysBetween(sale.order_date) <= period)
      .filter((sale) => sale.status !== "cancelled")
      .forEach((sale) => {
        const skuKeys = new Set<string>();
        const saleSku = (sale.sku || "").toUpperCase();
        if (saleSku) skuKeys.add(saleSku);
        const productSku = sale.product_id ? productById.get(sale.product_id)?.sku?.toUpperCase() : "";
        if (productSku) skuKeys.add(productSku);
        skuKeys.forEach((sku) => salesBySku.set(sku, [...(salesBySku.get(sku) || []), sale]));
      });

    return products.map((product) => {
      const sku = product.sku.toUpperCase();
      const skuSales = salesBySku.get(sku) || [];
      const skuPublications = publicationBySku.get(sku) || [];
      const stockFromMl = skuPublications.length ? Math.max(...skuPublications.map((publication) => numberValue(publication.meli_stock))) : 0;
      const revenue = skuSales.reduce((total, sale) => total + numberValue(sale.total_amount), 0);
      const units = skuSales.reduce((total, sale) => total + numberValue(sale.quantity), 0);
      const netProfit = skuSales.reduce((total, sale) => total + numberValue(sale.normalized_total_net_profit), 0);
      const netSale = skuSales.reduce(
        (total, sale) => total + numberValue(sale.normalized_net_sale_price) * numberValue(sale.quantity),
        0,
      );
      const errors = skuSales.filter((sale) => sale.normalized_profit_error).length;
      const lastSale = skuSales[0]?.order_date || null;

      return {
        sku,
        productName: product.name,
        category: product.category,
        stock: skuPublications.length ? stockFromMl : numberValue(product.stock),
        activePublications: skuPublications.length,
        units,
        revenue,
        netProfit,
        netSale,
        margin: netSale > 0 ? (netProfit / netSale) * 100 : null,
        avgPrice: units > 0 ? revenue / units : null,
        lastSale,
        errors,
      };
    });
  }, [products, publications, sales, period]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return rows
      .filter((row) => row.units > 0)
      .filter((row) => !needle || `${row.sku} ${row.productName} ${row.category || ""}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (sortKey === "sku" || sortKey === "productName") {
          return String(a[sortKey]).localeCompare(String(b[sortKey]), "es") * multiplier;
        }
        if (sortKey === "lastSale") {
          return ((a.lastSale ? new Date(a.lastSale).getTime() : 0) - (b.lastSale ? new Date(b.lastSale).getTime() : 0)) * multiplier;
        }
        return (numberValue(a[sortKey]) - numberValue(b[sortKey])) * multiplier;
      });
  }, [rows, query, sortKey, sortDirection]);

  const totals = useMemo(() => {
    const units = filteredRows.reduce((total, row) => total + row.units, 0);
    const revenue = filteredRows.reduce((total, row) => total + row.revenue, 0);
    const netProfit = filteredRows.reduce((total, row) => total + row.netProfit, 0);
    const netSale = filteredRows.reduce((total, row) => total + row.netSale, 0);
    return {
      units,
      revenue,
      netProfit,
      margin: netSale > 0 ? (netProfit / netSale) * 100 : null,
      products: filteredRows.length,
    };
  }, [filteredRows]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "sku" || key === "productName" ? "asc" : "desc");
  }

  return (
    <main className="page rotation-page">
      <PageHero
        title="Rentabilidad ML"
        description="Margen promedio por producto normalizado a MercadoLibre 1 pago."
        icon={<Calculator aria-hidden="true" />}
        actions={(
          <button className="button" type="button" onClick={syncSales} disabled={syncing || loading}>
            <RefreshCw aria-hidden="true" />
            {syncing ? "Sincronizando..." : "Sincronizar ventas ML"}
          </button>
        )}
      />

      {error && <div className="alert error">{error}</div>}
      {syncInfo && <div className="rotation-sync-info"><span>{syncInfo}</span></div>}

      <section className="rotation-summary">
        <article className="kpi-card">
          <span className="kpi-label">Productos vendidos</span>
          <strong className="kpi-value">{totals.products}</strong>
          <small className="kpi-meta">Ultimos {period} dias</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Unidades</span>
          <strong className="kpi-value">{totals.units}</strong>
          <small className="kpi-meta">Vendidas</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Facturacion</span>
          <strong className="kpi-value">{moneyWithCents(totals.revenue)}</strong>
          <small className="kpi-meta">ML</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Margen normalizado</span>
          <strong className="kpi-value">{percent(totals.margin)}</strong>
          <small className="kpi-meta">Como 1 pago</small>
        </article>
      </section>

      <section className="card rotation-card">
        <div className="rotation-toolbar">
          <label className="search-control">
            <Search aria-hidden="true" />
            <input className="search-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, producto o categoria" />
          </label>
          <select value={period} onChange={(event) => setPeriod(Number(event.target.value) as Period)}>
            <option value={7}>Ultimos 7 dias</option>
            <option value={30}>Ultimos 30 dias</option>
            <option value={60}>Ultimos 60 dias</option>
          </select>
        </div>

        <div className="rotation-table-wrap">
          <table className="rotation-table">
            <thead>
              <tr>
                <th className="sticky-product-column">
                  <button type="button" onClick={() => toggleSort("productName")}>Producto {sortIcon("productName", sortKey, sortDirection)}</button>
                </th>
                <th><button type="button" onClick={() => toggleSort("stock")}>Stock {sortIcon("stock", sortKey, sortDirection)}</button></th>
                <th><button type="button" onClick={() => toggleSort("units")}>Unidades {sortIcon("units", sortKey, sortDirection)}</button></th>
                <th><button type="button" onClick={() => toggleSort("revenue")}>Facturacion {sortIcon("revenue", sortKey, sortDirection)}</button></th>
                <th><button type="button" onClick={() => toggleSort("netProfit")}>Neto normalizado {sortIcon("netProfit", sortKey, sortDirection)}</button></th>
                <th><button type="button" onClick={() => toggleSort("margin")}>Margen {sortIcon("margin", sortKey, sortDirection)}</button></th>
                <th><button type="button" onClick={() => toggleSort("lastSale")}>Ultima venta {sortIcon("lastSale", sortKey, sortDirection)}</button></th>
                <th>MLA</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.sku}>
                  <td>
                    <strong>{row.productName}</strong>
                    <span>{row.sku}{row.category ? ` · ${row.category}` : ""}</span>
                  </td>
                  <td className="numeric">{row.stock}</td>
                  <td className="numeric">{row.units}</td>
                  <td className="numeric">{moneyWithCents(row.revenue)}<span>Prom. {moneyWithCents(row.avgPrice)}</span></td>
                  <td className={`numeric ${row.netProfit < 0 ? "negative-money" : "positive-money"}`}>{moneyWithCents(row.netProfit)}</td>
                  <td className={`numeric ${numberValue(row.margin) < 0 ? "negative-money" : "positive-money"}`}>
                    {percent(row.margin)}
                    {row.errors > 0 && <span>{row.errors} sin calculo</span>}
                  </td>
                  <td className="date-cell">{shortDate(row.lastSale)}</td>
                  <td className="numeric">{row.activePublications}</td>
                </tr>
              ))}
              {!filteredRows.length && (
                <tr>
                  <td colSpan={8}>No hay ventas para el periodo seleccionado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
