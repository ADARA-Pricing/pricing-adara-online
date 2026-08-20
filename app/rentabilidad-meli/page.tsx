"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, ChartNoAxesCombined, RefreshCw, Search } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { moneyWithCents, percent } from "@/lib/pricing";
import type { MercadoLibreOrderItem, MercadoLibreShippingCost, Product } from "@/lib/types";

type Period = 7 | 30 | 60;
type SortKey = "sku" | "productName" | "units" | "revenue" | "netProfit" | "margin" | "stock" | "lastSale" | "activePublications";
type SortDirection = "asc" | "desc";

type ProfitabilityRow = {
  sku: string;
  productName: string;
  category?: string | null;
  thumbnail: string | null;
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

function formatUnits(value: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value);
}

function productImage(publications: MercadoLibreShippingCost[]) {
  return publications.find((publication) => Boolean(publication.meli_thumbnail))?.meli_thumbnail || null;
}

function productInitial(name: string, sku: string) {
  return (name || sku || "P").slice(0, 2).toUpperCase();
}

function marginClass(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  if (value < 0) return "negative-money";
  return "positive-money";
}

function RentabilityThumbnail({ src, label }: { src: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="rotation-product-thumb">
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : label}
    </div>
  );
}

export default function RentabilidadMeliPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [period, setPeriod] = useState<Period>(30);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
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
        thumbnail: productImage(skuPublications),
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

  const categories = useMemo(() => {
    return [...new Set(rows.map((row) => row.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  const soldRows = useMemo(() => rows.filter((row) => row.units > 0), [rows]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return rows
      .filter((row) => row.units > 0)
      .filter((row) => !needle || `${row.sku} ${row.productName} ${row.category || ""}`.toLowerCase().includes(needle))
      .filter((row) => !categoryFilter || row.category === categoryFilter)
      .sort((a, b) => {
        if (sortKey === "sku" || sortKey === "productName") {
          return String(a[sortKey]).localeCompare(String(b[sortKey]), "es") * multiplier;
        }
        if (sortKey === "lastSale") {
          return ((a.lastSale ? new Date(a.lastSale).getTime() : 0) - (b.lastSale ? new Date(b.lastSale).getTime() : 0)) * multiplier;
        }
        return (numberValue(a[sortKey]) - numberValue(b[sortKey])) * multiplier;
      });
  }, [rows, query, categoryFilter, sortKey, sortDirection]);

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

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="idle-sort-icon" aria-hidden="true" />;
    return sortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />;
  }

  function SortButton({ column, children }: { column: SortKey; children: ReactNode }) {
    return (
      <button className={`rotation-sort-trigger ${sortKey === column ? "active" : ""}`} type="button" onClick={() => toggleSort(column)}>
        {children}
        <SortIcon column={column} />
      </button>
    );
  }

  function clearFilters() {
    setQuery("");
    setCategoryFilter("");
  }

  const hasFilters = Boolean(query.trim() || categoryFilter);

  return (
    <main className="page rotation-page">
      <PageHero
        title="Rentabilidad ML"
        description="Margen promedio por producto normalizado a MercadoLibre 1 pago."
        icon={<ChartNoAxesCombined aria-hidden="true" />}
        actions={(
          <button className="button rentability-sync-button" type="button" onClick={syncSales} disabled={syncing || loading}>
            <RefreshCw aria-hidden="true" />
            {syncing ? "Sincronizando..." : "Sincronizar ventas"}
          </button>
        )}
      />

      {error && <div className="alert error">{error}</div>}
      {syncInfo && <div className="rotation-sync-info"><span>{syncInfo}</span></div>}

      <section className="rotation-summary">
        <article className="kpi-card">
          <span className="kpi-label">Productos vendidos</span>
          <strong className="kpi-value">{formatUnits(totals.products)}</strong>
          <small className="kpi-meta">Últimos {period} días</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Unidades</span>
          <strong className="kpi-value">{formatUnits(totals.units)}</strong>
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
            <input className="search-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, producto o categoría" />
          </label>
          <select value={period} onChange={(event) => setPeriod(Number(event.target.value) as Period)}>
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={60}>Últimos 60 días</option>
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((category) => (
              <option value={category} key={category}>{category}</option>
            ))}
          </select>
        </div>

        <div className="rentability-table-status">
          <span>{hasFilters ? `${filteredRows.length} de ${soldRows.length} productos` : `${soldRows.length} productos`}</span>
          {hasFilters && (
            <button type="button" onClick={clearFilters}>Limpiar filtros</button>
          )}
        </div>

        <div className="rotation-table-wrap">
          <table className="rotation-table">
            <colgroup>
              <col className="rentability-col-product" />
              <col className="rentability-col-small" />
              <col className="rentability-col-small" />
              <col className="rentability-col-money" />
              <col className="rentability-col-money" />
              <col className="rentability-col-small" />
              <col className="rentability-col-date" />
              <col className="rentability-col-small" />
            </colgroup>
            <thead>
              <tr>
                <th className="sticky-product-column">
                  <SortButton column="productName">Producto</SortButton>
                </th>
                <th className="numeric-header"><SortButton column="stock">Stock</SortButton></th>
                <th className="numeric-header"><SortButton column="units">Unidades</SortButton></th>
                <th className="numeric-header"><SortButton column="revenue">Facturación</SortButton></th>
                <th className="numeric-header"><SortButton column="netProfit">Neto normalizado</SortButton></th>
                <th className="numeric-header"><SortButton column="margin">Margen</SortButton></th>
                <th className="date-header"><SortButton column="lastSale">Última venta</SortButton></th>
                <th className="numeric-header"><SortButton column="activePublications">MLA</SortButton></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.sku}>
                  <td>
                    <div className="rotation-product-cell">
                      <RentabilityThumbnail src={row.thumbnail} label={productInitial(row.productName, row.sku)} />
                      <div className="rotation-product-text">
                        <strong>{row.productName}</strong>
                        <span>{row.sku}{row.category ? ` · ${row.category}` : ""}</span>
                      </div>
                    </div>
                  </td>
                  <td className={`numeric ${row.stock <= 0 ? "negative-money" : ""}`}>{formatUnits(row.stock)}</td>
                  <td className="numeric">{formatUnits(row.units)}</td>
                  <td className="numeric money-stack">
                    <strong>{moneyWithCents(row.revenue)}</strong>
                    <span>Prom. {moneyWithCents(row.avgPrice)}</span>
                  </td>
                  <td className="numeric net-profit-cell">{moneyWithCents(row.netProfit)}</td>
                  <td className={`numeric ${marginClass(row.margin)}`}>
                    {percent(row.margin)}
                    {row.errors > 0 && <span>{row.errors} sin calculo</span>}
                  </td>
                  <td className="date-cell">{shortDate(row.lastSale)}</td>
                  <td className="numeric">{formatUnits(row.activePublications)}</td>
                </tr>
              ))}
              {!filteredRows.length && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">No hay ventas para los filtros actuales.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <style jsx>{`
        .rentability-sync-button {
          min-height: 40px;
          white-space: nowrap;
        }
        .rotation-summary {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin: 18px 0;
        }
        .rotation-summary .kpi-card {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: center;
          min-height: 86px;
          padding: 14px 16px;
          border: 1px solid #dbe6f4;
          border-radius: 12px;
          background: #fff;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
          gap: 3px;
        }
        .rotation-summary .kpi-label,
        .rotation-summary .kpi-meta {
          display: block;
          color: #4c6280;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.25;
        }
        .rotation-summary .kpi-value {
          display: block;
          color: #020817;
          font-size: 26px;
          font-weight: 800;
          line-height: 1.08;
          letter-spacing: 0;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .rotation-sync-info {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin: 12px 0 0;
          color: #385172;
          font-size: 13px;
        }
        .rotation-sync-info span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid #d6e3f5;
          border-radius: 999px;
          background: #f8fbff;
          padding: 7px 10px;
        }
        .rotation-card {
          padding: 18px;
        }
        .rotation-toolbar {
          display: grid;
          grid-template-columns: minmax(320px, 1fr) 180px 220px;
          gap: 12px;
          align-items: center;
          margin-bottom: 12px;
        }
        .rotation-toolbar select {
          border: 1px solid #cfe0f6;
          border-radius: 8px;
          min-height: 40px;
          padding: 0 12px;
          background: #fff;
          color: #0f172a;
          font-size: 13px;
          font-weight: 600;
        }
        .rentability-table-status {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin: 4px 0 12px;
          color: #4c6280;
          font-size: 12px;
          font-weight: 700;
        }
        .rentability-table-status button {
          border: 0;
          background: transparent;
          color: #2563eb;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
        }
        .rotation-table-wrap {
          width: 100%;
          overflow-x: auto;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: #fff;
        }
        .rotation-table {
          width: 100%;
          min-width: 1120px;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
        }
        .rentability-col-product { width: 390px; }
        .rentability-col-small { width: 104px; }
        .rentability-col-money { width: 172px; }
        .rentability-col-date { width: 124px; }
        .rotation-table thead {
          background: #f8fafc;
        }
        .rotation-table th {
          height: 40px;
          border-bottom: 1px solid #e2e8f0;
          color: #51627a;
          font-size: 11px;
          font-weight: 800;
          line-height: 1.2;
          padding: 0 12px;
          text-align: left;
          text-transform: uppercase;
          letter-spacing: 0;
          white-space: nowrap;
        }
        .rotation-table th.numeric-header,
        .rotation-table th.date-header {
          text-align: right;
        }
        .rotation-table td {
          height: 60px;
          border-bottom: 1px solid #edf2f7;
          color: #0f172a;
          font-size: 13px;
          padding: 8px 12px;
          vertical-align: middle;
        }
        .rotation-table tbody tr:last-child td {
          border-bottom: 0;
        }
        .rotation-table tbody tr:hover td {
          background: #f8fbff;
        }
        .rotation-table .numeric,
        .rotation-table .date-cell {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .rotation-table td span {
          display: block;
          color: #64748b;
          font-size: 11px;
          font-weight: 600;
          line-height: 1.25;
          margin-top: 3px;
        }
        .rotation-product-cell {
          display: flex;
          gap: 10px;
          align-items: center;
          min-width: 0;
        }
        :global(.rotation-page .rotation-product-thumb) {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px !important;
          height: 44px !important;
          min-width: 44px !important;
          min-height: 44px !important;
          max-width: 44px !important;
          max-height: 44px !important;
          flex: 0 0 44px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: #ffffff;
          color: #2563eb;
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
          overflow: hidden;
        }
        :global(.rotation-page .rotation-product-thumb img) {
          display: block;
          width: 100% !important;
          height: 100% !important;
          max-width: 40px !important;
          max-height: 40px !important;
          object-fit: contain;
          flex: 0 0 auto;
        }
        .rotation-product-text {
          min-width: 0;
        }
        .rotation-product-text strong {
          display: -webkit-box;
          color: #0f172a;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.25;
          overflow: hidden;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .rotation-product-text span {
          color: #4c6280;
          font-size: 12px;
          line-height: 1.25;
          margin-top: 3px;
        }
        .money-stack strong,
        .net-profit-cell {
          color: #0f172a;
          font-weight: 800;
        }
        .net-profit-cell {
          color: #1d4ed8;
        }
        .rotation-sort-trigger {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 4px;
          width: 100%;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: 11px;
          font-weight: 800;
          line-height: 1.2;
          padding: 0;
          text-align: inherit;
          text-transform: uppercase;
          cursor: pointer;
        }
        .numeric-header .rotation-sort-trigger,
        .date-header .rotation-sort-trigger {
          justify-content: flex-end;
        }
        .rotation-sort-trigger svg {
          width: 12px;
          height: 12px;
          flex: 0 0 12px;
          color: #2563eb;
          stroke-width: 2;
        }
        .rotation-sort-trigger .idle-sort-icon {
          color: #94a3b8;
          opacity: 0;
        }
        .rotation-sort-trigger:hover .idle-sort-icon {
          opacity: 1;
        }
        .rotation-sort-trigger.active {
          color: #2563eb;
        }
        .empty-state {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 96px;
          color: #64748b;
          font-size: 13px;
          font-weight: 700;
        }
        @media (max-width: 900px) {
          .rotation-summary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .rotation-toolbar {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 620px) {
          .rotation-summary {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
