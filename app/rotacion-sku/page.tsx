"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { moneyWithCents } from "@/lib/pricing";
import type { MercadoLibreOrderItem, MercadoLibreShippingCost, Product } from "@/lib/types";

type SortKey = "units30" | "revenue30" | "stockDays" | "stock";

type RotationRow = {
  sku: string;
  productName: string;
  stock: number;
  activePublications: number;
  units7: number;
  units30: number;
  units60: number;
  revenue30: number;
  avgPrice30: number | null;
  stockDays: number | null;
  lastSale?: string | null;
  catalogCount: number;
  itemIds: string[];
};

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

export default function RotacionSkuPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("units30");
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

    return products.map((product) => {
      const sku = product.sku.toUpperCase();
      const skuSales = salesBySku.get(sku) || [];
      const skuPublications = pubsBySku.get(sku) || [];
      const stockFromMl = skuPublications.length ? Math.max(...skuPublications.map((item) => numberValue(item.meli_stock))) : 0;
      const stock = numberValue(product.stock) || stockFromMl;

      const byDays = (days: number) => skuSales.filter((sale) => daysBetween(sale.order_date) <= days);
      const lastSale = skuSales[0]?.order_date || null;
      const sales7 = byDays(7);
      const sales30 = byDays(30);
      const sales60 = byDays(60);
      const units7 = sales7.reduce((total, sale) => total + numberValue(sale.quantity), 0);
      const units30 = sales30.reduce((total, sale) => total + numberValue(sale.quantity), 0);
      const units60 = sales60.reduce((total, sale) => total + numberValue(sale.quantity), 0);
      const revenue30 = sales30.reduce((total, sale) => total + numberValue(sale.total_amount), 0);
      const dailyUnits = Math.max(units7 / 7, units30 / 30, units60 / 60);
      const stockDays = dailyUnits > 0 ? stock / dailyUnits : null;

      return {
        sku,
        productName: product.name,
        stock,
        activePublications: skuPublications.length,
        units7,
        units30,
        units60,
        revenue30,
        avgPrice30: units30 > 0 ? revenue30 / units30 : null,
        stockDays,
        lastSale,
        catalogCount: skuPublications.filter((item) => item.meli_catalog_listing).length,
        itemIds: [...new Set(skuPublications.map((item) => item.meli_item_id).filter(Boolean) as string[])],
      };
    });
  }, [products, publications, sales]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (needle && !`${row.sku} ${row.productName} ${row.itemIds.join(" ")}`.toLowerCase().includes(needle)) return false;
        if (onlyWithSales && row.units30 <= 0) return false;
        if (onlyLowStock && !(row.stockDays !== null && row.stockDays < 25)) return false;
        return true;
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? -1;
        const bv = b[sortKey] ?? -1;
        if (sortKey === "stockDays") return Number(av) - Number(bv);
        return Number(bv) - Number(av);
      });
  }, [onlyLowStock, onlyWithSales, query, rows, sortKey]);

  const totals = useMemo(() => {
    const units30 = rows.reduce((total, row) => total + row.units30, 0);
    const revenue30 = rows.reduce((total, row) => total + row.revenue30, 0);
    const activeSkus = rows.filter((row) => row.units30 > 0).length;
    const lowStock = rows.filter((row) => row.stockDays !== null && row.stockDays < 25).length;
    return { units30, revenue30, activeSkus, lowStock };
  }, [rows]);

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
    <main className="page">
      <PageHero
        title="Ventas / Rotacion por SKU"
        description="Ventas recientes, unidades, stock y dias estimados para priorizar reposicion, promos y liquidacion."
        onRefresh={syncSales}
        refreshLabel={syncing ? "Sincronizando..." : "Sincronizar ventas ML"}
        refreshDisabled={syncing}
      />

      <div className="rotation-top-actions">
        <Link className="button ghost" href="/dashboard">Volver al dashboard</Link>
      </div>

      {error && <div className="alert error">{error}</div>}
      {(syncInfo || salesCoverage) && (
        <div className="rotation-sync-info">
          {syncInfo && <span>{syncInfo}</span>}
          {salesCoverage && (
            <span>
              Datos cargados: {salesCoverage.count} items vendidos desde {shortDate(salesCoverage.first)} hasta {shortDate(salesCoverage.last)}.
            </span>
          )}
        </div>
      )}

      <section className="rotation-summary">
        <article className="metric-card">
          <span>Unidades 30 dias</span>
          <strong>{totals.units30}</strong>
        </article>
        <article className="metric-card">
          <span>Venta 30 dias</span>
          <strong>{moneyWithCents(totals.revenue30)}</strong>
        </article>
        <article className="metric-card">
          <span>SKU con venta</span>
          <strong>{totals.activeSkus}</strong>
        </article>
        <article className="metric-card">
          <span>Stock bajo</span>
          <strong>{totals.lowStock}</strong>
        </article>
      </section>

      <section className="card rotation-card">
        <div className="rotation-toolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, producto o MLA" />
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="units30">Mas unidades 30 dias</option>
            <option value="revenue30">Mayor venta 30 dias</option>
            <option value="stockDays">Menos dias de stock</option>
            <option value="stock">Mayor stock</option>
          </select>
          <label>
            <input type="checkbox" checked={onlyWithSales} onChange={(event) => setOnlyWithSales(event.target.checked)} />
            Con ventas
          </label>
          <label>
            <input type="checkbox" checked={onlyLowStock} onChange={(event) => setOnlyLowStock(event.target.checked)} />
            Stock bajo
          </label>
        </div>

        {loading ? (
          <div className="empty-state">Cargando rotacion...</div>
        ) : (
          <div className="rotation-table-wrap">
            <table className="rotation-table">
              <thead>
                <tr>
                  <th>SKU / Producto</th>
                  <th>Publicaciones</th>
                  <th>7 dias</th>
                  <th>30 dias</th>
                  <th>60 dias</th>
                  <th>Venta 30d</th>
                  <th>Stock</th>
                  <th>Dias stock</th>
                  <th>Ultima venta</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.sku}>
                    <td>
                      <strong>{row.sku}</strong>
                      <span>{row.productName}</span>
                    </td>
                    <td>
                      <strong>{row.activePublications}</strong>
                      <span>{row.catalogCount ? `${row.catalogCount} catalogo` : "Sin catalogo"}</span>
                    </td>
                    <td>{row.units7}</td>
                    <td>{row.units30}</td>
                    <td>{row.units60}</td>
                    <td>
                      <strong>{moneyWithCents(row.revenue30)}</strong>
                      <span>{row.avgPrice30 ? `Prom. ${moneyWithCents(row.avgPrice30)}` : "-"}</span>
                    </td>
                    <td>{row.stock}</td>
                    <td>
                      <span className={`stock-pill ${statusClass(row.stockDays, row.stock)}`}>{stockLabel(row.stockDays)}</span>
                    </td>
                    <td>{shortDate(row.lastSale)}</td>
                  </tr>
                ))}
                {!filteredRows.length && (
                  <tr>
                    <td colSpan={9}>
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
        .rotation-top-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 12px;
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
          border: 1px solid #d6e3f5;
          border-radius: 999px;
          background: #f8fbff;
          padding: 7px 10px;
        }
        .metric-card {
          background: #fff;
          border: 1px solid #d9e4f5;
          border-radius: 8px;
          padding: 16px;
        }
        .metric-card span {
          display: block;
          color: #4a5f7d;
          font-size: 13px;
          margin-bottom: 8px;
        }
        .metric-card strong {
          font-size: 26px;
        }
        .rotation-card {
          padding: 18px;
        }
        .rotation-toolbar {
          display: grid;
          grid-template-columns: minmax(260px, 1fr) 220px auto auto;
          gap: 12px;
          align-items: center;
          margin-bottom: 16px;
        }
        .rotation-toolbar input,
        .rotation-toolbar select {
          border: 1px solid #cfe0f6;
          border-radius: 8px;
          min-height: 40px;
          padding: 0 12px;
          background: #fff;
        }
        .rotation-toolbar label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-weight: 700;
          color: #0f3d7a;
          white-space: nowrap;
        }
        .rotation-table-wrap {
          overflow-x: auto;
        }
        .rotation-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          min-width: 980px;
        }
        .rotation-table th {
          text-align: left;
          color: #526580;
          font-size: 12px;
          font-weight: 800;
          border-bottom: 1px solid #dce6f4;
          padding: 10px;
        }
        .rotation-table td {
          border-bottom: 1px solid #e4edf8;
          padding: 12px 10px;
          vertical-align: middle;
        }
        .rotation-table td span {
          display: block;
          color: #4c6280;
          font-size: 12px;
          margin-top: 3px;
        }
        .stock-pill {
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          padding: 5px 10px;
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
