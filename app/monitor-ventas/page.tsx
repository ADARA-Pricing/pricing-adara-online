"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Boxes, CircleDollarSign, PackageCheck, RefreshCw, ShoppingBag, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHero } from "@/components/PageHero";
import { PricingDataStatus } from "@/components/PricingDataStatus";
import { createClient } from "@/lib/supabase";
import { usePricingLoad } from "@/lib/usePricingLoad";
import { moneyWithCents, percent } from "@/lib/pricing";
import type { MercadoLibreOrderItem, MercadoLibreShippingCost, Product } from "@/lib/types";

function argentinaDayStart() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${date}T00:00:00-03:00`);
}

function numberValue(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function timeLabel(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function HourlyChart({ values }: { values: number[] }) {
  const data = values.map((revenue, hour) => ({ hour: String(hour).padStart(2, "0"), revenue }));

  return (
    <div className="sales-monitor-chart" role="img" aria-label="Facturación acumulada por hora de hoy">
      <div className="sales-monitor-chart-title">
        <span>Facturación por hora</span>
        <strong>Hoy</strong>
      </div>
      <div className="sales-monitor-chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
            <defs><linearGradient id="salesRevenue" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#246bfe" stopOpacity={0.35} /><stop offset="100%" stopColor="#246bfe" stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#e7ecf4" strokeDasharray="3 5" />
            <XAxis dataKey="hour" interval={3} tickLine={false} axisLine={false} tick={{ fill: "#7a8497", fontSize: 11 }} />
            <YAxis tickFormatter={compactMoney} width={52} tickLine={false} axisLine={false} tick={{ fill: "#7a8497", fontSize: 11 }} />
            <Tooltip formatter={(value: number) => [moneyWithCents(value), "Facturación"]} labelFormatter={(hour) => `${hour}:00 hs`} cursor={{ stroke: "#246bfe", strokeDasharray: "4 4" }} contentStyle={{ borderRadius: 12, border: "1px solid #dfe7f3", boxShadow: "0 8px 20px rgba(15,23,42,.12)" }} />
            <Area type="monotone" dataKey="revenue" stroke="#246bfe" strokeWidth={3} fill="url(#salesRevenue)" activeDot={{ r: 5, strokeWidth: 3, stroke: "#fff" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function SalesMonitorPage() {
  const router = useRouter();
  const supabase = createClient();
  const dataLoad = usePricingLoad("monitor-ventas", supabase);
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  async function syncTodaySales() {
    setSyncing(true);
    setSyncInfo("Buscando las ventas de hoy en Mercado Libre...");
    try {
      const response = await fetch("/api/mercadolibre/sync-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: argentinaDayStart().toISOString(), to: new Date().toISOString(), chunkDays: 1 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "No se pudieron actualizar las ventas desde Mercado Libre.");
      setSyncInfo(`${Number(data.saved || 0)} ventas actualizadas desde Mercado Libre.`);
    } catch (error) {
      setSyncInfo(error instanceof Error ? error.message : "No se pudieron actualizar las ventas desde Mercado Libre.");
    } finally {
      setSyncing(false);
    }
  }

  async function loadData(options: { syncToday?: boolean } = {}) {
    setLoading(true);
    if (options.syncToday) await syncTodaySales();
    const today = argentinaDayStart();
    try {
      await dataLoad.run({
        sales: { table: "mercadolibre_order_items", filters: [["gte", "order_date", today.toISOString()]], order: "order_date", ascending: false },
        products: { table: "products", filters: [["neq", "status", "discontinued"]] },
        publications: { table: "mercadolibre_shipping_costs", filters: [["eq", "active", true]] },
      }, (data) => {
        setSales(data.sales.filter((sale) => sale.status !== "cancelled"));
        setProducts(data.products);
        setPublications(data.publications);
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/login");
      else loadData({ syncToday: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useMemo(() => {
    const productsById = new Map(products.map((product) => [product.id, product]));
    const publicationByItemId = new Map(publications.filter((publication) => publication.meli_item_id).map((publication) => [publication.meli_item_id, publication]));
    const publicationBySku = new Map(publications.filter((publication) => publication.sku).map((publication) => [publication.sku.toUpperCase(), publication]));
    const stockByProduct = new Map<string, number>();
    publications.filter((publication) => publication.meli_status === "active").forEach((publication) => {
      if (!publication.product_id) return;
      stockByProduct.set(publication.product_id, Math.max(stockByProduct.get(publication.product_id) || 0, numberValue(publication.meli_stock)));
    });
    const hourly = Array.from({ length: 24 }, () => 0);
    const rows = sales.map((sale) => {
      const date = new Date(sale.order_date);
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hourCycle: "h23" }).format(date));
      const revenue = numberValue(sale.total_amount);
      if (hour >= 0 && hour < 24) hourly[hour] += revenue;
      const units = numberValue(sale.quantity);
      const profit = numberValue(sale.real_total_net_profit ?? sale.normalized_total_net_profit);
      const netSale = numberValue(sale.real_net_sale_price ?? sale.normalized_net_sale_price) * units;
      const product = sale.product_id ? productsById.get(sale.product_id) : null;
      const publication = publicationByItemId.get(sale.meli_item_id) || publicationBySku.get((sale.sku || product?.sku || "").toUpperCase());
      const logisticType = String(sale.shipping_logistic_type || "").toLowerCase();
      const shippingLabel = logisticType === "self_service" ? "FLEX" : logisticType === "fulfillment" ? "FULL" : null;
      return { sale, product, revenue, units, profit, margin: netSale > 0 ? profit / netSale * 100 : null, stock: product?.id ? stockByProduct.get(product.id) ?? numberValue(product.stock) : 0, thumbnail: publication?.meli_thumbnail || null, shippingLabel };
    });
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    const units = rows.reduce((sum, row) => sum + row.units, 0);
    const profit = rows.reduce((sum, row) => sum + row.profit, 0);
    return { rows, hourly, revenue, units, profit, stock: [...stockByProduct.values()].reduce((sum, stock) => sum + stock, 0) };
  }, [sales, products, publications]);

  return (
    <main className="container wide sales-monitor-page">
      <PageHero title="Ventas de hoy" description="Se actualiza desde Mercado Libre al abrir y al refrescar." icon={<BarChart3 aria-hidden="true" />} onRefresh={() => loadData({ syncToday: true })} />
      <PricingDataStatus state={dataLoad.state} publications={publications} onRefresh={() => loadData({ syncToday: true })} />

      <section className="sales-monitor-total">
        <span><i /> Actualizado {new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}</span>
        <strong>{moneyWithCents(view.revenue)}</strong>
        <small>Facturación bruta de hoy</small>
      </section>
      {syncInfo && <p className={`sales-monitor-sync-note ${syncInfo.includes("No se pudieron") ? "error" : ""}`}>{syncing ? "Sincronizando ventas de hoy..." : syncInfo}</p>}

      <section className="sales-monitor-overview">
        <div className="sales-monitor-metrics">
          <article><ShoppingBag aria-hidden="true" /><span>Ventas</span><strong>{view.rows.length}</strong></article>
          <article><PackageCheck aria-hidden="true" /><span>Unidades</span><strong>{view.units}</strong></article>
          <article><CircleDollarSign aria-hidden="true" /><span>Ganancia estimada</span><strong>{moneyWithCents(view.profit)}</strong></article>
          <article><Boxes aria-hidden="true" /><span>Stock ML</span><strong>{view.stock}</strong></article>
        </div>
        <HourlyChart values={view.hourly} />
      </section>

      <section className="card sales-monitor-list-card">
        <div className="sales-monitor-list-header">
          <div><h2>Ventas de hoy</h2><p>Precio vendido y rentabilidad de cada operación.</p></div>
          <button type="button" className="button secondary" onClick={() => loadData({ syncToday: true })} disabled={loading || syncing}><RefreshCw aria-hidden="true" className={loading || syncing ? "spin" : ""} />{syncing ? "Sincronizando..." : "Actualizar ML"}</button>
        </div>
        {loading ? <p className="sales-monitor-empty">Cargando ventas...</p> : view.rows.length === 0 ? <p className="sales-monitor-empty">Todavía no hay ventas registradas hoy.</p> : (
          <div className="sales-monitor-sales">
            {view.rows.map(({ sale, product, revenue, units, profit, margin, stock, thumbnail, shippingLabel }) => (
              <article className="sales-monitor-sale" key={`${sale.order_id}-${sale.meli_item_id}-${sale.variation_id || ""}-${sale.id || sale.order_date}`}>
                <div className="sales-monitor-sale-main">
                  <div className="sales-monitor-thumbnail" aria-hidden="true">
                    {thumbnail ? <img src={thumbnail} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
                    <span>{(sale.title || product?.name || "?").trim().charAt(0)}</span>
                  </div>
                  <div className="sales-monitor-sale-title"><strong>{sale.title || product?.name || "Venta Mercado Libre"}</strong><small>{sale.sku || product?.sku || "Sin SKU"} · {units} {units === 1 ? "unidad" : "unidades"} · Stock {stock}{shippingLabel ? <em className={`sales-monitor-logistic ${shippingLabel.toLowerCase()}`}>{shippingLabel}</em> : null}</small></div>
                  <span className="sales-monitor-time">{timeLabel(sale.order_date)}</span>
                </div>
                <div className="sales-monitor-sale-values"><div><span>Vendido</span><strong>{moneyWithCents(revenue)}</strong></div><div className={profit < 0 ? "negative" : "positive"}><span>Ganancia</span><strong>{moneyWithCents(profit)}</strong><small>{margin === null ? "Sin cálculo" : percent(margin)}</small></div></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
