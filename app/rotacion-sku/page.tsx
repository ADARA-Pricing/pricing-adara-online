"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ChartNoAxesCombined, Database, RefreshCw, Search } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { moneyWithCents } from "@/lib/pricing";
import type { MercadoLibreOrderItem, MercadoLibreShippingCost, Product } from "@/lib/types";

type SortKey = "productName" | "sku" | "units7" | "revenue7" | "units30" | "revenue30" | "units60" | "stock" | "stockDays" | "lastSale" | "activePublications" | "catalogCount";
type SortDirection = "asc" | "desc";

type RotationRow = {
  sku: string;
  productName: string;
  category?: string | null;
  thumbnail: string | null;
  stock: number;
  activePublications: number;
  units7: number;
  units30: number;
  units60: number;
  revenue7: number;
  revenue30: number;
  avgPrice30: number | null;
  stockDays: number | null;
  lastSale?: string | null;
  catalogCount: number;
  itemIds: string[];
};

function RotationThumbnail({ src, label }: { src: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="rotation-product-thumb">
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : label}
    </div>
  );
}

function numberValue(value: unknown) {
  return Number(value || 0);
}

function shortDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(value));
}

function daysBetween(from: string) {
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) return Infinity;
  return (Date.now() - date.getTime()) / 86400000;
}

function stockLabel(days: number | null) {
  if (days === null) return "Sin ventas";
  if (!Number.isFinite(days)) return "-";
  if (days < 7) return `${days.toFixed(1)} dias`;
  return `${Math.round(days)} dias`;
}

function statusClass(days: number | null, stock: number) {
  if (!stock) return "danger";
  if (days === null) return "quiet";
  if (days < 10) return "danger";
  if (days < 25) return "warning";
  return "good";
}

function productImage(publications: MercadoLibreShippingCost[]) {
  return publications.find((publication) => Boolean(publication.meli_thumbnail))?.meli_thumbnail || null;
}

function productInitial(name: string, sku: string) {
  return (name || sku || "P").slice(0, 2).toUpperCase();
}

export default function RotacionSkuPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [imagePublications, setImagePublications] = useState<MercadoLibreShippingCost[]>([]);
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("units30");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [rotationFilter, setRotationFilter] = useState("");
  const [onlyWithSales, setOnlyWithSales] = useState(false);
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function fetchSalesSince(sinceIso: string) {
    const pageSize = 1000;
    const result: MercadoLibreOrderItem[] = [];

    for (let from = 0; from < 20000; from += pageSize) {
      const to = from + pageSize - 1;
      const response = await supabase
        .from("mercadolibre_order_items")
        .select("*")
        .gte("order_date", sinceIso)
        .neq("status", "cancelled")
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

    const [productsResponse, publicationsResponse, imagePublicationsResponse, salesResponse] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active").order("sku", { ascending: true }),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true).eq("meli_status", "active"),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true),
      fetchSalesSince(since.toISOString()),
    ]);

    setLoading(false);
    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);
    if (publicationsResponse.error) setError(publicationsResponse.error.message);
    else setPublications((publicationsResponse.data || []) as MercadoLibreShippingCost[]);
    if (imagePublicationsResponse.error) setError(imagePublicationsResponse.error.message);
    else setImagePublications((imagePublicationsResponse.data || []) as MercadoLibreShippingCost[]);
    if (salesResponse.error) {
      setError(
        salesResponse.error.message.includes("mercadolibre_order_items")
          ? "Falta aplicar la migracion de ventas ML. Ejecuta database/036_meli_order_items.sql en Supabase."
          : salesResponse.error.message,
      );
    } else {
      setSales((salesResponse.data || []) as MercadoLibreOrderItem[]);
    }
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
      setSyncInfo(`Ventas ML: ${data.saved || 0} items guardados, ${data.scanned || 0} ordenes revisadas en ${data.windows || 1} ventanas.`);
      await loadData();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudieron sincronizar ventas.");
    } finally {
      setSyncing(false);
    }
  }

  const rows = useMemo<RotationRow[]>(() => {
    const salesBySku = new Map<string, MercadoLibreOrderItem[]>();
    sales.forEach((sale) => {
      const sku = (sale.sku || "").toUpperCase();
      if (!sku) return;
      salesBySku.set(sku, [...(salesBySku.get(sku) || []), sale]);
    });

    const productById = new Map(products.map((product) => [product.id, product]));
    const pubsBySku = new Map<string, MercadoLibreShippingCost[]>();
    publications.forEach((publication) => {
      const product = productById.get(publication.product_id);
      const sku = (publication.sku || product?.sku || "").toUpperCase();
      if (!sku) return;
      pubsBySku.set(sku, [...(pubsBySku.get(sku) || []), publication]);
    });
    const imagePubsBySku = new Map<string, MercadoLibreShippingCost[]>();
    imagePublications.forEach((publication) => {
      const product = productById.get(publication.product_id);
      const sku = (publication.sku || product?.sku || "").toUpperCase();
      if (!sku) return;
      imagePubsBySku.set(sku, [...(imagePubsBySku.get(sku) || []), publication]);
    });

    return products.map((product) => {
      const sku = product.sku.toUpperCase();
      const skuSales = salesBySku.get(sku) || [];
      const skuPublications = pubsBySku.get(sku) || [];
      const skuImagePublications = imagePubsBySku.get(sku) || skuPublications;
      const activePublications = skuPublications.filter((item) => item.meli_status === "active");
      const stockSourcePublications = activePublications.length ? activePublications : skuPublications;
      const stockFromMl = stockSourcePublications.length ? Math.max(...stockSourcePublications.map((item) => numberValue(item.meli_stock))) : 0;
      const stock = skuPublications.length ? stockFromMl : numberValue(product.stock);

      const byDays = (days: number) => skuSales.filter((sale) => daysBetween(sale.order_date) <= days);
      const lastSale = skuSales[0]?.order_date || null;
      const sales7 = byDays(7);
      const sales30 = byDays(30);
      const sales60 = byDays(60);
      const units7 = sales7.reduce((total, sale) => total + numberValue(sale.quantity), 0);
      const units30 = sales30.reduce((total, sale) => total + numberValue(sale.quantity), 0);
      const units60 = sales60.reduce((total, sale) => total + numberValue(sale.quantity), 0);
      const revenue7 = sales7.reduce((total, sale) => total + numberValue(sale.total_amount), 0);
      const revenue30 = sales30.reduce((total, sale) => total + numberValue(sale.total_amount), 0);
      const dailyUnits = Math.max(units7 / 7, units30 / 30, units60 / 60);
      const stockDays = dailyUnits > 0 ? stock / dailyUnits : null;

      return {
        sku,
        productName: product.name,
        category: product.category,
        thumbnail: productImage(skuImagePublications),
        stock,
        activePublications: skuPublications.length,
        units7,
        units30,
        units60,
        revenue7,
        revenue30,
        avgPrice30: units30 > 0 ? revenue30 / units30 : null,
        stockDays,
        lastSale,
        catalogCount: skuPublications.filter((item) => item.meli_catalog_listing).length,
        itemIds: [...new Set(skuPublications.map((item) => item.meli_item_id).filter(Boolean) as string[])],
      };
    });
  }, [products, publications, imagePublications, sales]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const multiplier = sortDirection === "asc" ? 1 : -1;

    return rows
      .filter((row) => {
        if (needle && !`${row.sku} ${row.productName} ${row.itemIds.join(" ")}`.toLowerCase().includes(needle)) return false;
        if (categoryFilter && row.category !== categoryFilter) return false;
        if (rotationFilter === "no_sales" && row.units30 > 0) return false;
        if (rotationFilter === "low_stock" && !(row.stockDays !== null && row.stockDays < 25)) return false;
        if (rotationFilter === "normal" && !(row.stockDays !== null && row.stockDays >= 25)) return false;
        if (onlyWithSales && row.units30 <= 0) return false;
        if (onlyLowStock && !(row.stockDays !== null && row.stockDays < 25)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortKey === "productName" || sortKey === "sku") {
          return String(a[sortKey] || "").localeCompare(String(b[sortKey] || ""), "es") * multiplier;
        }
        if (sortKey === "lastSale") {
          const av = a.lastSale ? new Date(a.lastSale).getTime() : 0;
          const bv = b.lastSale ? new Date(b.lastSale).getTime() : 0;
          return (av - bv) * multiplier;
        }
        const av = Number(a[sortKey] ?? -1);
        const bv = Number(b[sortKey] ?? -1);
        return (av - bv) * multiplier;
      });
  }, [categoryFilter, onlyLowStock, onlyWithSales, query, rotationFilter, rows, sortDirection, sortKey]);

  const totals = useMemo(() => {
    const units30 = rows.reduce((total, row) => total + row.units30, 0);
    const revenue30 = rows.reduce((total, row) => total + row.revenue30, 0);
    const activeSkus = rows.filter((row) => row.units30 > 0).length;
    const lowStock = rows.filter((row) => row.stockDays !== null && row.stockDays < 25).length;
    return { units30, revenue30, activeSkus, lowStock };
  }, [rows]);

  const categories = useMemo(() => {
    return [...new Set(rows.map((row) => row.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  const activeFilterCount = [query.trim(), categoryFilter, rotationFilter, onlyWithSales ? "sales" : "", onlyLowStock ? "stock" : ""].filter(Boolean).length;

  function changeSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "productName" || key === "sku" ? "asc" : "desc");
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown aria-hidden="true" />;
    return sortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />;
  }

  function SortButton({ column, children }: { column: SortKey; children: ReactNode }) {
    return (
      <button className={`rotation-sort-trigger ${sortKey === column ? "active" : ""}`} type="button" onClick={() => changeSort(column)}>
        {children}
        <SortIcon column={column} />
      </button>
    );
  }

  function clearFilters() {
    setQuery("");
    setCategoryFilter("");
    setRotationFilter("");
    setOnlyWithSales(false);
    setOnlyLowStock(false);
  }

  const salesCoverage = useMemo(() => {
    const dates = sales
      .map((sale) => new Date(sale.order_date).getTime())
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b);
    if (!dates.length) return null;
    return {
      first: new Date(dates[0]).toISOString(),
      last: new Date(dates[dates.length - 1]).toISOString(),
      count: sales.length,
    };
  }, [sales]);

  return (
    <main className="page rotation-page">
      <PageHero
        title="Rotación SKU"
        description="Ventas recientes, stock y rotación para priorizar reposición, promociones y liquidación."
        icon={<ChartNoAxesCombined aria-hidden="true" />}
        actions={(
          <>
            <Link className="button ghost page-back-button rotation-back-button" href="/dashboard"><ArrowLeft aria-hidden="true" />Volver al dashboard</Link>
            <button className="button" type="button" onClick={syncSales} disabled={syncing}>
              <RefreshCw aria-hidden="true" />
              {syncing ? "Sincronizando..." : "Sincronizar ventas ML"}
            </button>
          </>
        )}
      />

      {error && <div className="alert error">{error}</div>}
      {(syncInfo || salesCoverage) && (
        <div className="rotation-sync-info">
          {syncInfo && <span>{syncInfo}</span>}
          {salesCoverage && (
            <span>
              <Database aria-hidden="true" />
              Datos cargados: {salesCoverage.count} items vendidos desde {shortDate(salesCoverage.first)} hasta {shortDate(salesCoverage.last)}.
            </span>
          )}
        </div>
      )}

      <section className="rotation-summary">
        <article className="kpi-card">
          <span className="kpi-label">Unidades 30 dias</span>
          <strong className="kpi-value">{totals.units30}</strong>
          <small className="kpi-meta">Vendidas</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Venta 30 dias</span>
          <strong className="kpi-value">{moneyWithCents(totals.revenue30)}</strong>
          <small className="kpi-meta">Facturacion ML</small>
        </article>
        <article className="kpi-card rotation-kpi-good">
          <span className="kpi-label">SKU con venta</span>
          <strong className="kpi-value">{totals.activeSkus}</strong>
          <small className="kpi-meta">Ultimos 30 dias</small>
        </article>
        <article className="kpi-card rotation-kpi-warning">
          <span className="kpi-label">Stock bajo</span>
          <strong className="kpi-value">{totals.lowStock}</strong>
          <small className="kpi-meta">Menos de 25 dias</small>
        </article>
      </section>

      <section className="card rotation-card">
        <div className="rotation-toolbar">
          <label className="search-control">
            <Search aria-hidden="true" />
            <input className="search-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, producto o MLA" />
          </label>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">Todas las categorias</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select value={rotationFilter} onChange={(event) => setRotationFilter(event.target.value)}>
            <option value="">Todos los estados</option>
            <option value="low_stock">Stock bajo</option>
            <option value="normal">Stock normal</option>
            <option value="no_sales">Sin ventas 30d</option>
          </select>
          <label className={`rotation-filter-chip ${onlyWithSales ? "active" : ""}`}>
            <input type="checkbox" checked={onlyWithSales} onChange={(event) => setOnlyWithSales(event.target.checked)} />
            Con ventas
          </label>
          <label className={`rotation-filter-chip ${onlyLowStock ? "active" : ""}`}>
            <input type="checkbox" checked={onlyLowStock} onChange={(event) => setOnlyLowStock(event.target.checked)} />
            Stock bajo
          </label>
        </div>
        <div className="rotation-table-status">
          <span>{filteredRows.length} de {rows.length} SKU{activeFilterCount ? ` · ${activeFilterCount} filtros activos` : ""}</span>
          {activeFilterCount ? <button className="button ghost small-button" type="button" onClick={clearFilters}>Limpiar filtros</button> : null}
        </div>

        {loading ? (
          <div className="rotation-skeleton">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className="rotation-table-wrap">
            <table className="rotation-table">
              <colgroup>
                <col className="rotation-col-product" />
                <col className="rotation-col-publications" />
                <col className="rotation-col-units" />
                <col className="rotation-col-money" />
                <col className="rotation-col-units" />
                <col className="rotation-col-money" />
                <col className="rotation-col-units" />
                <col className="rotation-col-stock" />
                <col className="rotation-col-days" />
                <col className="rotation-col-date" />
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2}><SortButton column="productName">Producto</SortButton></th>
                  <th rowSpan={2}><SortButton column="activePublications">Publicaciones</SortButton></th>
                  <th colSpan={2}>Últimos 7 días</th>
                  <th colSpan={2}>Últimos 30 días</th>
                  <th rowSpan={2}><SortButton column="units60">60 días</SortButton></th>
                  <th rowSpan={2}><SortButton column="stock">Stock</SortButton></th>
                  <th rowSpan={2}><SortButton column="stockDays">Días stock</SortButton></th>
                  <th rowSpan={2}><SortButton column="lastSale">Última venta</SortButton></th>
                </tr>
                <tr>
                  <th><SortButton column="units7">Unidades</SortButton></th>
                  <th><SortButton column="revenue7">Venta</SortButton></th>
                  <th><SortButton column="units30">Unidades</SortButton></th>
                  <th><SortButton column="revenue30">Venta</SortButton></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.sku}>
                    <td>
                      <div className="rotation-product-cell">
                        <RotationThumbnail src={row.thumbnail} label={productInitial(row.productName, row.sku)} />
                        <div className="rotation-product-text">
                          <strong>{row.productName}</strong>
                          <span>{row.sku}{row.category ? ` · ${row.category}` : ""}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{row.activePublications}</strong>
                      <span>{row.catalogCount ? `${row.catalogCount} catalogo` : "Sin catalogo"}</span>
                    </td>
                    <td className="numeric">{row.units7}</td>
                    <td className="numeric">{moneyWithCents(row.revenue7)}</td>
                    <td className="numeric">{row.units30}</td>
                    <td className="numeric">
                      <strong>{moneyWithCents(row.revenue30)}</strong>
                      <span>{row.avgPrice30 ? `Prom. ${moneyWithCents(row.avgPrice30)}` : "-"}</span>
                    </td>
                    <td className="numeric">{row.units60}</td>
                    <td className="numeric">{row.stock}</td>
                    <td>
                      <span className={`stock-pill ${statusClass(row.stockDays, row.stock)}`}>{stockLabel(row.stockDays)}</span>
                    </td>
                    <td>{shortDate(row.lastSale)}</td>
                  </tr>
                ))}
                {!filteredRows.length && (
                  <tr>
                    <td colSpan={10}>
                      <div className="empty-state">No hay SKU para los filtros actuales.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <style jsx>{`
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
        .rotation-sync-info svg {
          width: 14px;
          height: 14px;
          color: #64748b;
        }
        .rotation-back-button {
          white-space: nowrap;
        }
        .rotation-card {
          padding: 18px;
        }
        .rotation-toolbar {
          display: grid;
          grid-template-columns: minmax(280px, 1fr) 190px 180px auto auto;
          gap: 12px;
          align-items: center;
          margin-bottom: 10px;
        }
        .rotation-toolbar select {
          border: 1px solid #cfe0f6;
          border-radius: 8px;
          min-height: 40px;
          padding: 0 12px;
          background: #fff;
        }
        .rotation-filter-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-height: 34px;
          border: 1px solid #dbe4f0;
          border-radius: 999px;
          background: #fff;
          padding: 0 11px;
          font-weight: 700;
          color: #334155;
          white-space: nowrap;
        }
        .rotation-filter-chip.active {
          border-color: #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
        }
        .rotation-table-status {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          margin-bottom: 10px;
        }
        .rotation-skeleton {
          display: grid;
          gap: 8px;
        }
        .rotation-skeleton span {
          height: 58px;
          border-radius: 10px;
          background: linear-gradient(90deg, #f1f5f9, #f8fafc, #f1f5f9);
        }
        .rotation-table-wrap {
          overflow-x: auto;
        }
        .rotation-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1180px;
          table-layout: fixed;
        }
        .rotation-col-product { width: 34%; }
        .rotation-col-publications { width: 9%; }
        .rotation-col-units { width: 6.5%; }
        .rotation-col-money { width: 10%; }
        .rotation-col-stock { width: 6%; }
        .rotation-col-days { width: 7%; }
        .rotation-col-date { width: 7%; }
        .rotation-table th {
          text-align: left;
          background: #f8fafc;
          color: #526580;
          font-size: 11px;
          font-weight: 800;
          border-bottom: 1px solid #dce6f4;
          padding: 8px 10px;
          vertical-align: middle;
        }
        .rotation-table thead tr:first-child th[colspan] {
          text-align: center;
          color: #64748b;
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          background: #f6f8fb;
        }
        .rotation-table thead tr:nth-child(2) th {
          background: #f8fafc;
          padding-top: 7px;
          padding-bottom: 7px;
        }
        .rotation-table td {
          border-bottom: 1px solid #e4edf8;
          padding: 8px 10px;
          vertical-align: middle;
          font-variant-numeric: tabular-nums;
        }
        .rotation-table tbody tr:hover td {
          background: #f8fbff;
        }
        .rotation-table .numeric {
          text-align: right;
        }
        .rotation-table td span {
          display: block;
          color: #4c6280;
          font-size: 12px;
          margin-top: 3px;
        }
        .rotation-sort-trigger {
          all: unset;
          appearance: none !important;
          -webkit-appearance: none !important;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          width: auto;
          height: auto !important;
          min-height: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          color: inherit;
          cursor: pointer;
          padding: 2px 0 !important;
          font: inherit;
          font-size: inherit;
          font-weight: inherit;
          line-height: 1.2;
          text-align: left;
          white-space: nowrap;
        }
        :global(.rotation-page .rotation-sort-trigger) {
          border: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          min-height: 0 !important;
          height: auto !important;
          padding: 2px 0 !important;
        }
        .rotation-sort-trigger:hover {
          color: #2563eb;
        }
        .rotation-sort-trigger.active {
          color: #1d4ed8;
        }
        .rotation-sort-trigger svg {
          width: 12px;
          height: 12px;
          flex-shrink: 0;
          stroke-width: 1.7;
        }
        .rotation-product-sort {
          display: flex;
          flex-direction: column;
          gap: 3px;
          align-items: flex-start;
        }
        .rotation-product-cell {
          display: flex;
          gap: 10px;
          align-items: center;
          min-width: 310px;
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
          font-weight: 800;
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
        .stock-pill {
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          padding: 4px 9px;
          font-size: 12px;
          font-weight: 800;
          margin-top: 0 !important;
        }
        .stock-pill.good {
          background: #e9f8ef;
          color: #007a4d;
        }
        .stock-pill.warning {
          background: #fff4df;
          color: #a15d00;
        }
        .stock-pill.danger {
          background: #ffe8e8;
          color: #d81717;
        }
        .stock-pill.quiet {
          background: #edf3fb;
          color: #425979;
        }
        @media (max-width: 900px) {
          .rotation-summary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .rotation-toolbar {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
