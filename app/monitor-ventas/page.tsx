"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Boxes, CircleDollarSign, PackageCheck, RefreshCw, ShoppingBag, TrendingUp } from "lucide-react";
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
  const max = Math.max(...values, 1);
  const width = 720;
  const height = 236;
  const padding = { left: 12, right: 12, top: 16, bottom: 26 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const points = values.map((value, hour) => {
    const x = padding.left + (hour / 23) * chartWidth;
    const y = padding.top + chartHeight - (value / max) * chartHeight;
    return `${x},${y}`;
  }).join(" ");
  const area = `${padding.left},${padding.top + chartHeight} ${points} ${width - padding.right},${padding.top + chartHeight}`;
  const currentHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const currentX = padding.left + (Math.min(Math.max(currentHour, 0), 23) / 23) * chartWidth;

  return (
    <div className="sales-monitor-chart" role="img" aria-label="Facturación acumulada por hora de hoy">
      <div className="sales-monitor-chart-title">
        <span>Facturación por hora</span>
        <strong>Hoy</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75, 1].map((line) => {
          const y = padding.top + chartHeight - chartHeight * line;
          return <line key={line} x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="sales-monitor-grid-line" />;
        })}
        <polygon points={area} className="sales-monitor-area" />
        <polyline points={points} className="sales-monitor-line" />
        <line x1={currentX} x2={currentX} y1={padding.top} y2={padding.top + chartHeight} className="sales-monitor-now-line" />
        <circle cx={currentX} cy={padding.top + chartHeight - (values[currentHour] || 0) / max * chartHeight} r="5" className="sales-monitor-now-dot" />
        {[0, 4, 8, 12, 16, 20, 23].map((hour) => (
          <text key={hour} x={padding.left + (hour / 23) * chartWidth} y={height - 6} textAnchor="middle" className="sales-monitor-axis-label">
            {String(hour).padStart(2, "0")}
          </text>
        ))}
      </svg>
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

  async function loadData() {
    setLoading(true);
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
      else loadData();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useMemo(() => {
    const productsById = new Map(products.map((product) => [product.id, product]));
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
      return { sale, product, revenue, units, profit, margin: netSale > 0 ? profit / netSale * 100 : null, stock: product?.id ? stockByProduct.get(product.id) ?? numberValue(product.stock) : 0 };
    });
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    const units = rows.reduce((sum, row) => sum + row.units, 0);
    const profit = rows.reduce((sum, row) => sum + row.profit, 0);
    return { rows, hourly, revenue, units, profit, stock: [...stockByProduct.values()].reduce((sum, stock) => sum + stock, 0) };
  }, [sales, products, publications]);

  return (
    <main className="container wide sales-monitor-page">
      <PageHero title="Ventas de hoy" description="Seguimiento en vivo de facturación, unidades y rentabilidad." icon={<BarChart3 aria-hidden="true" />} onRefresh={loadData} />
      <PricingDataStatus state={dataLoad.state} publications={publications} onRefresh={loadData} />

      <section className="sales-monitor-total">
        <span><i /> Actualizado {new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}</span>
        <strong>{moneyWithCents(view.revenue)}</strong>
        <small>Facturación bruta de hoy</small>
      </section>

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
          <button type="button" className="button secondary" onClick={loadData} disabled={loading}><RefreshCw aria-hidden="true" className={loading ? "spin" : ""} />Actualizar</button>
        </div>
        {loading ? <p className="sales-monitor-empty">Cargando ventas...</p> : view.rows.length === 0 ? <p className="sales-monitor-empty">Todavía no hay ventas registradas hoy.</p> : (
          <div className="sales-monitor-sales">
            {view.rows.map(({ sale, product, revenue, units, profit, margin, stock }) => (
              <article className="sales-monitor-sale" key={`${sale.order_id}-${sale.meli_item_id}-${sale.variation_id || ""}-${sale.id || sale.order_date}`}>
                <div className="sales-monitor-sale-main"><span className="sales-monitor-time">{timeLabel(sale.order_date)}</span><div><strong>{sale.title || product?.name || "Venta Mercado Libre"}</strong><small>{sale.sku || product?.sku || "Sin SKU"} · {units} {units === 1 ? "unidad" : "unidades"} · Stock {stock}</small></div></div>
                <div className="sales-monitor-sale-values"><div><span>Vendido</span><strong>{moneyWithCents(revenue)}</strong></div><div className={profit < 0 ? "negative" : "positive"}><span>Ganancia</span><strong>{moneyWithCents(profit)}</strong><small>{margin === null ? "Sin cálculo" : percent(margin)}</small></div></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
