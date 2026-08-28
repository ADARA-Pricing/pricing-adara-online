"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, RefreshCw, TrendingUp } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { moneyWithCents, percent } from "@/lib/pricing";
import type { MercadoLibreOrderItem } from "@/lib/types";

type Period = "week" | "month" | "30" | "60";
type MetricKey = "revenue" | "netProfit" | "units" | "orders" | "grossProfitRate" | "realMargin" | "normalizedMargin" | "marginOnCost" | "avgTicket";

type DailyMetric = {
  key: string;
  label: string;
  fullLabel: string;
  orders: number;
  units: number;
  revenue: number;
  netProfit: number;
  netSale: number;
  normalizedNetSale: number;
  costBasis: number;
  avgTicket: number | null;
  grossProfitRate: number | null;
  realMargin: number | null;
  normalizedMargin: number | null;
  marginOnCost: number | null;
};

const salesSelectColumns = [
  "id",
  "order_id",
  "order_date",
  "status",
  "quantity",
  "total_amount",
  "real_net_sale_price",
  "real_total_net_profit",
  "normalized_net_sale_price",
  "normalized_total_net_profit",
  "normalized_cost_for_profit",
].join(",");

const metricLabels: Record<MetricKey, string> = {
  revenue: "Facturado bruto",
  netProfit: "Ganancia neta",
  units: "Unidades",
  orders: "Ventas",
  grossProfitRate: "Ganancia / facturacion",
  realMargin: "Margen real",
  normalizedMargin: "Margen normalizado",
  marginOnCost: "Margen sobre costo",
  avgTicket: "Ticket promedio",
};

const metricKinds: Record<MetricKey, "money" | "percent" | "number"> = {
  revenue: "money",
  netProfit: "money",
  units: "number",
  orders: "number",
  grossProfitRate: "percent",
  realMargin: "percent",
  normalizedMargin: "percent",
  marginOnCost: "percent",
  avgTicket: "money",
};

function numberValue(value: unknown) {
  return Number(value || 0);
}

function dateKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortDayLabel(key: string) {
  const [, month, day] = key.split("-");
  return `${day}/${month}`;
}

function longDayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(year, month - 1, day));
}

function startForPeriod(period: Period) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") start.setDate(start.getDate() - 6);
  if (period === "30") start.setDate(start.getDate() - 29);
  if (period === "60") start.setDate(start.getDate() - 59);
  if (period === "month") start.setDate(1);
  return start;
}

function periodLabel(period: Period) {
  if (period === "week") return "Semana";
  if (period === "month") return "Mes en curso";
  if (period === "30") return "Ultimos 30 dias";
  return "Ultimos 60 dias";
}

function formatMetric(value: number | null, metric: MetricKey) {
  if (value === null || !Number.isFinite(value)) return "-";
  const kind = metricKinds[metric];
  if (kind === "money") return moneyWithCents(value);
  if (kind === "percent") return percent(value);
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value);
}

function isJwtClockError(message?: string | null) {
  return /jwt issued at future/i.test(message || "");
}

export default function MetricasMeliPage() {
  const router = useRouter();
  const supabase = createClient();
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [period, setPeriod] = useState<Period>("month");
  const [metric, setMetric] = useState<MetricKey>("revenue");
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
      const response = await supabase
        .from("mercadolibre_order_items")
        .select(salesSelectColumns)
        .gte("order_date", sinceIso)
        .neq("status", "cancelled")
        .order("order_date", { ascending: false })
        .range(from, from + pageSize - 1);
      if (response.error) return response;
      const page = (response.data || []) as unknown as MercadoLibreOrderItem[];
      result.push(...page);
      if (page.length < pageSize) break;
    }
    return { data: result, error: null };
  }

  async function loadData(retriedSession = false) {
    setLoading(true);
    setError(null);
    const since = startForPeriod("60");

    try {
      const response = await fetchSalesSince(since.toISOString());
      if (response.error) {
        if (!retriedSession && isJwtClockError(response.error.message)) {
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError) {
            await loadData(true);
            return;
          }
        }
        setError(response.error.message);
        return;
      }
      setSales((response.data || []) as MercadoLibreOrderItem[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las metricas ML.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncSales() {
    setSyncing(true);
    setSyncInfo("Sincronizando ventas de MercadoLibre...");
    setError(null);
    try {
      const response = await fetch("/api/mercadolibre/sync-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 60, chunkDays: 3 }),
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

  const dailyRows = useMemo<DailyMetric[]>(() => {
    const start = startForPeriod(period);
    const days: DailyMetric[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const cursor = new Date(start); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
      const key = dateKey(cursor.toISOString());
      days.push({
        key,
        label: shortDayLabel(key),
        fullLabel: longDayLabel(key),
        orders: 0,
        units: 0,
        revenue: 0,
        netProfit: 0,
        netSale: 0,
        normalizedNetSale: 0,
        costBasis: 0,
        avgTicket: null,
        grossProfitRate: null,
        realMargin: null,
        normalizedMargin: null,
        marginOnCost: null,
      });
    }

    const byKey = new Map(days.map((day) => [day.key, day]));
    const orderIdsByDay = new Map<string, Set<string>>();

    sales.forEach((sale) => {
      if (sale.status === "cancelled") return;
      const key = dateKey(sale.order_date);
      const row = byKey.get(key);
      if (!row) return;
      const units = numberValue(sale.quantity);
      const realProfit = numberValue(sale.real_total_net_profit ?? sale.normalized_total_net_profit);
      row.units += units;
      row.revenue += numberValue(sale.total_amount);
      row.netProfit += realProfit;
      row.netSale += numberValue(sale.real_net_sale_price ?? sale.normalized_net_sale_price) * units;
      row.normalizedNetSale += numberValue(sale.normalized_net_sale_price) * units;
      row.costBasis += numberValue(sale.normalized_cost_for_profit) * units;
      if (!orderIdsByDay.has(key)) orderIdsByDay.set(key, new Set());
      orderIdsByDay.get(key)?.add(sale.order_id || `${sale.id}-${sale.meli_item_id}`);
    });

    return days.map((row) => {
      const orders = orderIdsByDay.get(row.key)?.size || 0;
      return {
        ...row,
        orders,
        avgTicket: orders > 0 ? row.revenue / orders : null,
        grossProfitRate: row.revenue > 0 ? (row.netProfit / row.revenue) * 100 : null,
        realMargin: row.netSale > 0 ? (row.netProfit / row.netSale) * 100 : null,
        normalizedMargin: row.normalizedNetSale > 0 ? (row.netProfit / row.normalizedNetSale) * 100 : null,
        marginOnCost: row.costBasis > 0 ? (row.netProfit / row.costBasis) * 100 : null,
      };
    });
  }, [period, sales]);

  const totals = useMemo(() => {
    const orders = dailyRows.reduce((total, row) => total + row.orders, 0);
    const units = dailyRows.reduce((total, row) => total + row.units, 0);
    const revenue = dailyRows.reduce((total, row) => total + row.revenue, 0);
    const netProfit = dailyRows.reduce((total, row) => total + row.netProfit, 0);
    const netSale = dailyRows.reduce((total, row) => total + row.netSale, 0);
    const normalizedNetSale = dailyRows.reduce((total, row) => total + row.normalizedNetSale, 0);
    const costBasis = dailyRows.reduce((total, row) => total + row.costBasis, 0);
    return {
      orders,
      units,
      revenue,
      netProfit,
      avgTicket: orders > 0 ? revenue / orders : null,
      grossProfitRate: revenue > 0 ? (netProfit / revenue) * 100 : null,
      realMargin: netSale > 0 ? (netProfit / netSale) * 100 : null,
      normalizedMargin: normalizedNetSale > 0 ? (netProfit / normalizedNetSale) * 100 : null,
      marginOnCost: costBasis > 0 ? (netProfit / costBasis) * 100 : null,
    };
  }, [dailyRows]);

  const chartValues = dailyRows.map((row) => Number(row[metric] || 0));
  const minValue = Math.min(0, ...chartValues);
  const maxValue = Math.max(1, ...chartValues);
  const range = maxValue - minValue || 1;
  const chartWidth = Math.max(720, dailyRows.length * 44);
  const chartHeight = 280;
  const plotTop = 22;
  const plotBottom = 232;
  const zeroY = plotTop + ((maxValue - 0) / range) * (plotBottom - plotTop);
  const points = dailyRows.map((row, index) => {
    const x = 28 + (index * (chartWidth - 56)) / Math.max(1, dailyRows.length - 1);
    const y = plotTop + ((maxValue - Number(row[metric] || 0)) / range) * (plotBottom - plotTop);
    return { x, y, row };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");

  return (
    <main className="page metricas-meli-page">
      <PageHero
        title="Metricas ML"
        description="Ventas de MercadoLibre por dia: facturacion, ganancia, margen y unidades."
        icon={<TrendingUp aria-hidden="true" />}
        actions={(
          <button className="button rentability-sync-button" type="button" onClick={syncSales} disabled={syncing || loading}>
            <RefreshCw aria-hidden="true" />
            {syncing ? "Sincronizando..." : "Sincronizar ventas"}
          </button>
        )}
        onRefresh={loadData}
        refreshDisabled={loading || syncing}
      />

      {loading && <div className="rotation-sync-info"><span><RefreshCw aria-hidden="true" />Cargando ventas ML...</span></div>}
      {error && <div className="alert error">{error}</div>}
      {syncInfo && <div className="rotation-sync-info"><span>{syncing && <RefreshCw aria-hidden="true" />}{syncInfo}</span></div>}

      <section className="metricas-controls card">
        <div>
          <span>Periodo</span>
          <div className="metricas-segmented">
            {(["week", "month", "30", "60"] as Period[]).map((item) => (
              <button key={item} type="button" className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>
                {periodLabel(item)}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span>Metrica del grafico</span>
          <select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)}>
            {(Object.keys(metricLabels) as MetricKey[]).map((key) => (
              <option key={key} value={key}>{metricLabels[key]}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="metricas-summary-grid">
        <article className="kpi-card">
          <span className="kpi-label">Facturacion</span>
          <strong className="kpi-value">{moneyWithCents(totals.revenue)}</strong>
          <small className="kpi-meta">{periodLabel(period)}</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Ganancia neta</span>
          <strong className="kpi-value">{moneyWithCents(totals.netProfit)}</strong>
          <small className="kpi-meta">Suma real del periodo</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Ganancia / facturacion</span>
          <strong className="kpi-value">{percent(totals.grossProfitRate)}</strong>
          <small className="kpi-meta">Neta sobre bruto ML</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Margen real</span>
          <strong className="kpi-value">{percent(totals.realMargin)}</strong>
          <small className="kpi-meta">Sobre neto real</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Unidades</span>
          <strong className="kpi-value">{formatMetric(totals.units, "units")}</strong>
          <small className="kpi-meta">{totals.orders} ventas</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Ticket promedio</span>
          <strong className="kpi-value">{formatMetric(totals.avgTicket, "avgTicket")}</strong>
          <small className="kpi-meta">Facturacion / ventas</small>
        </article>
      </section>

      <section className="card metricas-chart-card">
        <div className="metricas-chart-head">
          <div>
            <h2>{metricLabels[metric]}</h2>
            <p>{periodLabel(period)} - {dailyRows.length} dias - {sales.length} items de venta cargados</p>
          </div>
          <BarChart3 aria-hidden="true" />
        </div>
        <div className="metricas-chart-scroll">
          <svg className="metricas-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`Grafico de ${metricLabels[metric]}`}>
            <line x1="20" x2={chartWidth - 20} y1={zeroY} y2={zeroY} className="metricas-zero-line" />
            <path d={path} className="metricas-line" />
            {points.map((point) => {
              const value = Number(point.row[metric] || 0);
              const barHeight = Math.abs(point.y - zeroY);
              const y = value >= 0 ? point.y : zeroY;
              return (
                <g key={point.row.key}>
                  <rect x={point.x - 9} y={y} width="18" height={Math.max(2, barHeight)} rx="5" className={value >= 0 ? "metricas-bar" : "metricas-bar negative"} />
                  <circle cx={point.x} cy={point.y} r="4" className="metricas-dot" />
                  <title>{`${point.row.fullLabel}: ${formatMetric(value, metric)}`}</title>
                </g>
              );
            })}
            {points.map((point, index) => (
              <text key={`${point.row.key}-label`} x={point.x} y="262" textAnchor="middle" className="metricas-axis-label">
                {dailyRows.length > 18 && index % 2 ? "" : point.row.label}
              </text>
            ))}
          </svg>
        </div>
      </section>

      <section className="card metricas-table-card">
        <div className="metricas-table-head">
          <h2>Detalle diario</h2>
          <span>{periodLabel(period)}</span>
        </div>
        <div className="table-wrap">
          <table className="metricas-table">
            <thead>
              <tr>
                <th>Dia</th>
                <th>Ventas</th>
                <th>Unidades</th>
                <th>Facturacion</th>
                <th>Ganancia neta</th>
                <th>Ganancia / fact.</th>
                <th>Margen real</th>
                <th>Margen normalizado</th>
                <th>Margen s/costo</th>
                <th>Ticket prom.</th>
              </tr>
            </thead>
            <tbody>
              {[...dailyRows].reverse().map((row) => (
                <tr key={row.key}>
                  <td><strong>{row.fullLabel}</strong></td>
                  <td>{formatMetric(row.orders, "orders")}</td>
                  <td>{formatMetric(row.units, "units")}</td>
                  <td>{moneyWithCents(row.revenue)}</td>
                  <td className={row.netProfit < 0 ? "negative-money" : "positive-money"}>{moneyWithCents(row.netProfit)}</td>
                  <td>{percent(row.grossProfitRate)}</td>
                  <td>{percent(row.realMargin)}</td>
                  <td>{percent(row.normalizedMargin)}</td>
                  <td>{percent(row.marginOnCost)}</td>
                  <td>{formatMetric(row.avgTicket, "avgTicket")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
