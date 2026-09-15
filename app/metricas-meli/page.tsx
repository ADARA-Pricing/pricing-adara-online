"use client";
import { profitabilityTotals } from "@/lib/profitability";
import { readPages } from "@/lib/pricingData";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Info, RefreshCw, TrendingUp } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { moneyWithCents, percent } from "@/lib/pricing";
import type { MercadoLibreOrderItem } from "@/lib/types";

type Period = "week" | "month" | "30" | "60";
type MetricKey = "revenue" | "netProfit" | "units" | "orders" | "grossProfitRate" | "realMargin" | "normalizedMargin" | "marginOnCost" | "avgTicket";
type SortKey = "key" | MetricKey;
type SortDirection = "asc" | "desc";

type DailyMetric = {
  key: string;
  label: string;
  fullLabel: string;
  orders: number;
  units: number;
  revenue: number;
  netProfit: number | null;
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
  "normalized_profit_error",
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
  grossProfitRate: "Ganancia / facturación",
  realMargin: "Margen real",
  normalizedMargin: "Margen normalizado",
  marginOnCost: "Margen sobre costo",
  avgTicket: "Ticket promedio",
};

const metricHelp: Partial<Record<MetricKey, string>> = {
  grossProfitRate: "Ganancia guardada / facturación bruta de las mismas ventas con cálculo válido; excluye ventas sin cálculo.",
  realMargin: "Ganancia neta real dividida por venta neta real.",
  normalizedMargin: "Ganancia neta real dividida por venta neta normalizada a 1 pago.",
  marginOnCost: "Ganancia neta real dividida por costo usado para el cálculo.",
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
  if (period === "30") return "Últimos 30 días";
  return "Últimos 60 días";
}

function formatMetric(value: number | null, metric: MetricKey) {
  if (value === null || !Number.isFinite(value)) return "-";
  const kind = metricKinds[metric];
  if (kind === "money") return moneyWithCents(value);
  if (kind === "percent") return percent(value);
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value);
}

function formatAxisValue(value: number, metric: MetricKey) {
  if (!Number.isFinite(value)) return "-";
  const kind = metricKinds[metric];
  if (kind === "percent") return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(value)}%`;
  if (kind === "number") return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value);
  const abs = Math.abs(value);
  if (abs >= 1000000) return `$ ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(value / 1000000)} M`;
  if (abs >= 1000) return `$ ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value / 1000)} K`;
  return moneyWithCents(value);
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
  const [sortKey, setSortKey] = useState<SortKey>("key");
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
    try { const result = await readPages(supabase, { table: 'mercadolibre_order_items', columns: salesSelectColumns, filters: [['gte','order_date',sinceIso],['neq','status','cancelled']], order: 'order_date', ascending: false }, new AbortController().signal); return { data: result.rows, error: null }; }
    catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : 'Error de lectura' } }; }
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
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las métricas ML.");
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

      row.units += units;
      row.revenue += numberValue(sale.total_amount);

      row.netSale += numberValue(sale.real_net_sale_price ?? sale.normalized_net_sale_price) * units;
      row.normalizedNetSale += numberValue(sale.normalized_net_sale_price) * units;
      row.costBasis += numberValue(sale.normalized_cost_for_profit) * units;
      if (!orderIdsByDay.has(key)) orderIdsByDay.set(key, new Set());
      orderIdsByDay.get(key)?.add(sale.order_id || `${sale.id}-${sale.meli_item_id}`);
    });

    return days.map((row) => {
      const orders = orderIdsByDay.get(row.key)?.size || 0;
      const summary = profitabilityTotals(sales.filter(sale => sale.status !== "cancelled" && dateKey(sale.order_date) === row.key));
      return {
        ...row,
        orders,
        avgTicket: orders > 0 ? row.revenue / orders : null,
        ...summary,
        grossProfitRate: summary.netProfit !== null && summary.coveredRevenue > 0 ? summary.netProfit / summary.coveredRevenue * 100 : null,
        realMargin: summary.margin,
      };
    });
  }, [period, sales]);

  const totals = useMemo(() => {
    const orders = dailyRows.reduce((total, row) => total + row.orders, 0);
    const units = dailyRows.reduce((total, row) => total + row.units, 0);
    const revenue = dailyRows.reduce((total, row) => total + row.revenue, 0);
    const keys = new Set(dailyRows.map(row => row.key));
    const summary = profitabilityTotals(sales.filter(sale => sale.status !== "cancelled" && keys.has(dateKey(sale.order_date))));
    const netSale = dailyRows.reduce((total, row) => total + row.netSale, 0);
    const normalizedNetSale = dailyRows.reduce((total, row) => total + row.normalizedNetSale, 0);
    const costBasis = dailyRows.reduce((total, row) => total + row.costBasis, 0);
    return {
      orders,
      units,
      revenue,
      ...summary,
      avgTicket: orders > 0 ? revenue / orders : null,
      grossProfitRate: summary.netProfit !== null && summary.coveredRevenue > 0 ? summary.netProfit / summary.coveredRevenue * 100 : null,
      realMargin: summary.margin,
    };
  }, [dailyRows, sales]);

  const sortedDailyRows = useMemo(() => {
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return [...dailyRows].sort((a, b) => {
      if (sortKey === "key") return a.key.localeCompare(b.key) * multiplier;
      return (numberValue(a[sortKey]) - numberValue(b[sortKey])) * multiplier;
    });
  }, [dailyRows, sortDirection, sortKey]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "key" ? "desc" : "desc");
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

  function MetricHelp({ metricKey }: { metricKey: MetricKey }) {
    const help = metricHelp[metricKey];
    if (!help) return null;
    return (
      <span className="metricas-help" title={help} aria-label={help}>
        <Info aria-hidden="true" />
      </span>
    );
  }

  const chartValues = dailyRows.map((row) => Number(row[metric] || 0));
  const minValue = Math.min(0, ...chartValues);
  const maxValue = Math.max(1, ...chartValues);
  const range = maxValue - minValue || 1;
  const chartWidth = Math.max(760, dailyRows.length * 46 + 74);
  const chartHeight = 300;
  const plotTop = 22;
  const plotBottom = 244;
  const plotLeft = 82;
  const plotRight = chartWidth - 24;
  const tooltipWidth = 220;
  const tooltipHeight = 126;
  const zeroY = plotTop + ((maxValue - 0) / range) * (plotBottom - plotTop);
  const points = dailyRows.map((row, index) => {
    const x = plotLeft + (index * (plotRight - plotLeft)) / Math.max(1, dailyRows.length - 1);
    const y = plotTop + ((maxValue - Number(row[metric] || 0)) / range) * (plotBottom - plotTop);
    return { x, y, row };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const yTicks = Array.from({ length: 5 }, (_, index) => minValue + (range * index) / 4).reverse();
  const todayKey = dateKey(new Date().toISOString());

  return (
    <main className="page metricas-meli-page">
      <PageHero
        title="Métricas ML"
        description="Ventas de MercadoLibre por día: facturación, ganancia, margen y unidades."
        icon={<TrendingUp aria-hidden="true" />}
        actions={(
          <button className="button" type="button" onClick={syncSales} disabled={syncing || loading}>
            <RefreshCw aria-hidden="true" />
            {syncing ? "Sincronizando..." : "Sincronizar ventas"}
          </button>
        )}
        onRefresh={() => loadData()}
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
      </section>

      <section className="metricas-summary-grid">
        <article className="kpi-card">
          <span className="kpi-label">Facturación</span>
          <strong className="kpi-value">{loading && !sales.length ? "—" : moneyWithCents(totals.revenue)}</strong>
          <small className="kpi-meta">{periodLabel(period)}</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Ganancia neta</span>
          <strong className="kpi-value">{loading && !sales.length ? "—" : moneyWithCents(totals.netProfit)}</strong>
          <small className="kpi-meta">Ganancia guardada · {totals.errors} sin cálculo</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Ganancia / facturación <MetricHelp metricKey="grossProfitRate" /></span>
          <strong className="kpi-value">{loading && !sales.length ? "—" : percent(totals.grossProfitRate)}</strong>
          <small className="kpi-meta">Neta sobre bruto ML</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Margen real <MetricHelp metricKey="realMargin" /></span>
          <strong className="kpi-value">{loading && !sales.length ? "—" : percent(totals.realMargin)}</strong>
          <small className="kpi-meta">Sobre neto real</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Unidades</span>
          <strong className="kpi-value">{loading && !sales.length ? "—" : formatMetric(totals.units, "units")}</strong>
          <small className="kpi-meta">{totals.orders} ventas</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Ticket promedio</span>
          <strong className="kpi-value">{loading && !sales.length ? "—" : formatMetric(totals.avgTicket, "avgTicket")}</strong>
          <small className="kpi-meta">Facturación / ventas</small>
        </article>
      </section>

      <section className="card metricas-chart-card">
        <div className="metricas-chart-head">
          <div>
            <h2>{metricLabels[metric]}</h2>
            <p>{periodLabel(period)} - {dailyRows.length} días - {sales.length} items de venta cargados</p>
          </div>
          <label className="metricas-chart-select">
            <span>Métrica</span>
            <select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)}>
              {(Object.keys(metricLabels) as MetricKey[]).map((key) => (
                <option key={key} value={key}>{metricLabels[key]}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="metricas-chart-scroll">
          <svg className="metricas-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`Grafico de ${metricLabels[metric]}`}>
            {yTicks.map((tick) => {
              const y = plotTop + ((maxValue - tick) / range) * (plotBottom - plotTop);
              return (
                <g key={tick}>
                  <line x1={plotLeft} x2={plotRight} y1={y} y2={y} className="metricas-grid-line" />
                  <text x={plotLeft - 10} y={y + 4} textAnchor="end" className="metricas-y-label">{formatAxisValue(tick, metric)}</text>
                </g>
              );
            })}
            <line x1={plotLeft} x2={plotRight} y1={zeroY} y2={zeroY} className="metricas-zero-line" />
            <path d={path} className="metricas-line" />
            {points.map((point) => {
              const value = Number(point.row[metric] || 0);
              const barHeight = Math.abs(point.y - zeroY);
              const y = value >= 0 ? point.y : zeroY;
              const tooltipX = Math.min(Math.max(point.x - tooltipWidth / 2, plotLeft), chartWidth - tooltipWidth - 12);
              const tooltipY = Math.min(Math.max(point.y - tooltipHeight - 12, 8), chartHeight - tooltipHeight - 8);
              return (
                <g key={point.row.key} className="metricas-point">
                  <rect x={point.x - 9} y={y} width="18" height={Math.max(2, barHeight)} rx="5" className={value >= 0 ? "metricas-bar" : "metricas-bar negative"} />
                  <circle cx={point.x} cy={point.y} r="4" className="metricas-dot" />
                  <foreignObject className="metricas-svg-tooltip" x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight}>
                    <div className="metricas-tooltip-card">
                      <strong>{point.row.label}</strong>
                      <span>{metricLabels[metric]}</span>
                      <b>{formatMetric(value, metric)}</b>
                      <div>
                        <span>Ventas</span>
                        <em>{formatMetric(point.row.orders, "orders")}</em>
                        <span>Unidades</span>
                        <em>{formatMetric(point.row.units, "units")}</em>
                      </div>
                    </div>
                  </foreignObject>
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
          <span className="badge badge-neutral">{periodLabel(period)}</span>
        </div>
        <div className="table-wrap">
          <table className="metricas-table">
            <thead>
              <tr>
                <th><SortButton column="key">Dia</SortButton></th>
                <th className="numeric-header"><SortButton column="orders">Ventas</SortButton></th>
                <th className="numeric-header"><SortButton column="units">Unidades</SortButton></th>
                <th className="numeric-header"><SortButton column="revenue">Facturación</SortButton></th>
                <th className="numeric-header"><SortButton column="netProfit">Ganancia neta</SortButton></th>
                <th className="numeric-header"><SortButton column="grossProfitRate">Ganancia / fact.</SortButton></th>
                <th className="numeric-header"><SortButton column="realMargin">Margen real</SortButton></th>
                <th className="numeric-header"><SortButton column="normalizedMargin">Margen normalizado</SortButton></th>
                <th className="numeric-header"><SortButton column="marginOnCost">Margen s/costo</SortButton></th>
                <th className="numeric-header"><SortButton column="avgTicket">Ticket prom.</SortButton></th>
              </tr>
            </thead>
            <tbody>
              {sortedDailyRows.map((row) => (
                <tr key={row.key} className={row.key === todayKey ? "is-today" : ""}>
                  <td><strong>{row.fullLabel}</strong>{row.key === todayKey ? <span className="metricas-today-pill">Hoy</span> : null}</td>
                  <td className="numeric-cell">{formatMetric(row.orders, "orders")}</td>
                  <td className="numeric-cell">{formatMetric(row.units, "units")}</td>
                  <td className="numeric-cell">{moneyWithCents(row.revenue)}</td>
                  <td className={`numeric-cell metricas-net-profit ${row.netProfit < 0 ? "negative-money" : ""}`}>{moneyWithCents(row.netProfit)}</td>
                  <td className="numeric-cell">{percent(row.grossProfitRate)}</td>
                  <td className="numeric-cell">{percent(row.realMargin)}</td>
                  <td className="numeric-cell">{percent(row.normalizedMargin)}</td>
                  <td className="numeric-cell">{percent(row.marginOnCost)}</td>
                  <td className="numeric-cell">{formatMetric(row.avgTicket, "avgTicket")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
