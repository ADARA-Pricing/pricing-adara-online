"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChartNoAxesCombined, Filter, RefreshCw, Search } from "lucide-react";
import { usePricingLoad } from '@/lib/usePricingLoad';
import { PricingDataStatus, PricingPagination } from '@/components/PricingDataStatus';
import { normalizeFilter, categoryOptions, readPages } from '@/lib/pricingData';
import { CategoryFilter, PricingSearch } from '@/components/PricingFilters';
import { useRememberedView } from '@/lib/useRememberedView';
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { profitabilityTotals } from '@/lib/profitability';
import { moneyWithCents, percent } from "@/lib/pricing";
import type { MercadoLibreOrderItem, MercadoLibreShippingCost, Product } from "@/lib/types";

type Period = "today" | 7 | 30 | 60;
type SortKey = "sku" | "productName" | "units" | "revenue" | "netProfit" | "margin" | "normalizedMargin" | "marginOnCost" | "stock" | "lastSale" | "activePublications";
type SortDirection = "asc" | "desc";
type ProfitabilityStatusFilter = "" | "with_sales" | "no_sales" | "low_stock" | "normal" | "negative_margin" | "without_profit";
type FilterableColumn = "productName" | "activePublications" | "units" | "revenue" | "netProfit" | "margin" | "stock" | "stockDays";
type NumberFilterOperator = "gt" | "lt" | "between";
type ColumnFilter =
  | { kind: "text"; value: string }
  | { kind: "number"; operator: NumberFilterOperator; min: string; max: string };

type ProfitabilityRow = {
  key: string;
  sku: string;
  productName: string;
  category?: string | null;
  thumbnail: string | null;
  orderId?: string | null;
  meliItemId?: string | null;
  stock: number;
  activePublications: number;
  units: number;
  revenue: number;
  netProfit: number | null;
  costProfit?: number;
  coveredRevenue?: number;
  calculatedSales?: number;
  itemIds?: string[];
  netSale: number;
  margin: number | null;
  normalizedNetSale: number;
  normalizedProfit: number | null;
  normalizedMargin: number | null;
  costBasis: number;
  marginOnCost: number | null;
  avgPrice: number | null;
  stockDays: number | null;
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

function shortDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function isToday(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  return formatter.format(date) === formatter.format(new Date());
}

function argentinaTodayStart() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00-03:00`);
}

function formatUnits(value: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value);
}

function stockDaysLabel(days: number | null) {
  if (days === null) return "Sin ventas";
  if (!Number.isFinite(days)) return "-";
  if (days < 7) return `${days.toFixed(1)} dias`;
  return `${Math.round(days)} dias`;
}

function isActiveMeliPublication(publication: MercadoLibreShippingCost) {
  return publication.active !== false && publication.meli_status === "active";
}

function productImage(publications: MercadoLibreShippingCost[], meliItemId?: string | null) {
  const exactPublication = meliItemId ? publications.find((publication) => publication.meli_item_id === meliItemId && Boolean(publication.meli_thumbnail)) : null;
  if (exactPublication?.meli_thumbnail) return exactPublication.meli_thumbnail;
  return (
    publications.find((publication) => isActiveMeliPublication(publication) && Boolean(publication.meli_thumbnail))?.meli_thumbnail ||
    publications.find((publication) => Boolean(publication.meli_thumbnail))?.meli_thumbnail ||
    null
  );
}

function productInitial(name: string, sku: string) {
  return (name || sku || "P").slice(0, 2).toUpperCase();
}

function marginClass(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  if (value < 0) return "negative-money";
  return "positive-money";
}

const sortLabels: Record<SortKey, string> = {
  sku: "SKU",
  productName: "Producto",
  units: "Unidades",
  revenue: "Facturación",
  netProfit: "Ganancia real",
  margin: "Margen real",
  normalizedMargin: "Margen normalizado",
  marginOnCost: "Margen s/costo",
  stock: "Stock",
  lastSale: "Última venta",
  activePublications: "Publicaciones activas",
};

const salesSelectColumns = [
  "updated_at",
  "id",
  "order_id",
  "order_date",
  "status",
  "meli_item_id",
  "variation_id",
  "sku",
  "product_id",
  "title",
  "quantity",
  "unit_price",
  "total_amount",
  "real_net_sale_price",
  "real_total_net_profit",
  "normalized_net_sale_price",
  "normalized_net_profit",
  "normalized_total_net_profit",
  "normalized_cost_for_profit",
  "normalized_margin_on_cost",
  "normalized_profit_error",
].join(",");

const publicationSelectColumns = [
  "id", "meli_last_sync_at", "updated_at",
  "product_id",
  "sku",
  "active",
  "meli_item_id",
  "meli_status",
  "meli_stock",
  "meli_thumbnail",
].join(",");

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
  const dataLoad = usePricingLoad('rentabilidad-meli', supabase);
  const [listPage, setListPage] = useState(1);
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [period, setPeriod] = useState<Period>("today");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProfitabilityStatusFilter>("");
  const [onlyWithSales, setOnlyWithSales] = useState(false);
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterableColumn, ColumnFilter>>>({});
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("netProfit");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [salesSyncProgress, setSalesSyncProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState<string | null>("Cargando rentabilidad ML...");
  const [todayReady, setTodayReady] = useState(false);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function loadData(options: { quiet?: boolean; initial?: boolean } = {}) {
    const since = new Date(); since.setHours(0,0,0,0); since.setDate(since.getDate() - 65);
    setLoading(true);
    try { await dataLoad.run({ products: { table: 'products', filters: [['neq','status','discontinued']] }, publications: { table: 'mercadolibre_shipping_costs', columns: publicationSelectColumns, filters: [['eq','active',true]] }, sales: { table: 'mercadolibre_order_items', columns: salesSelectColumns, filters: [['gte','order_date',since.toISOString()]], order: 'order_date', ascending: false } }, data => { setProducts(data.products); setPublications(data.publications); setSales(data.sales); }, !options.initial); }
    finally { setLoading(false); }
  }

  async function loadTodayThenHistory() {
    setLoadingInfo("Cargando primero las ventas de hoy...");
    try {
      const today = argentinaTodayStart();
      const result = await readPages(
        supabase,
        { table: "mercadolibre_order_items", columns: salesSelectColumns, filters: [["gte", "order_date", today.toISOString()]], order: "order_date", ascending: false },
        new AbortController().signal,
      );
      setSales(result.rows);
      setTodayReady(true);
      setLoadingInfo("Mostrando las ventas de hoy; completando el historial en segundo plano...");
    } catch {
      // La carga completa conserva su manejo de errores y puede recuperar la
      // vista aunque la consulta prioritaria haya fallado de forma transitoria.
      setLoadingInfo("Cargando el historial de rentabilidad...");
    }
    await loadData({ initial: true });
  }

  useEffect(() => {
    checkSession();
    loadTodayThenHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncSales() {
    setSyncing(true);
    setSalesSyncProgress(null);
    setSyncInfo("Sincronizando primero las ventas más recientes de MercadoLibre...");
    setError(null);
    try {
      const totalDays = 60;
      const chunkDays = 3;
      const chunkMs = chunkDays * 86400000;
      const overallFrom = new Date(Date.now() - totalDays * 86400000);
      let windowEnd = new Date();
      let completedDays = 0;
      let saved = 0;
      let scanned = 0;

      while (windowEnd.getTime() > overallFrom.getTime()) {
        const windowStart = new Date(Math.max(overallFrom.getTime(), windowEnd.getTime() - chunkMs));
        const response = await fetch("/api/mercadolibre/sync-sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: windowStart.toISOString(), to: windowEnd.toISOString(), chunkDays }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "No se pudieron sincronizar ventas.");

        saved += Number(data.saved || 0);
        scanned += Number(data.scanned || 0);
        completedDays = Math.min(totalDays, completedDays + chunkDays);
        setSalesSyncProgress({ completed: completedDays, total: totalDays });
        setSyncInfo(`Rentabilidad disponible hasta el momento: ${saved} items guardados, ${scanned} órdenes revisadas.`);
        await loadData({ quiet: true });
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        windowEnd = new Date(windowStart.getTime() - 1);
      }
      setSyncInfo(`Ventas ML actualizadas: ${saved} items guardados, ${scanned} órdenes revisadas.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudieron sincronizar ventas.");
    } finally {
      setSyncing(false);
      setSalesSyncProgress(null);
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

    const periodDays = period === "today" ? 1 : period;
    const periodSales = sales
      .filter((sale) => period === "today" ? isToday(sale.order_date) : daysBetween(sale.order_date) <= period)
      .filter((sale) => sale.status !== "cancelled")
      .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime());

    if (period === "today") {
      return periodSales.map((sale) => {
        const saleSku = (sale.sku || "").toUpperCase();
        const product = (sale.product_id ? productById.get(sale.product_id) : null) || productBySku.get(saleSku) || null;
        const sku = saleSku || product?.sku?.toUpperCase() || "-";
        const skuPublications = publicationBySku.get(sku) || [];
        const activeSkuPublications = skuPublications.filter(isActiveMeliPublication);
        const stockFromMl = activeSkuPublications.length ? Math.max(...activeSkuPublications.map((publication) => numberValue(publication.meli_stock))) : 0;
        const units = numberValue(sale.quantity);
        const revenue = numberValue(sale.total_amount);
        const netProfit = numberValue(sale.real_total_net_profit ?? sale.normalized_total_net_profit);
        const netSale = numberValue(sale.real_net_sale_price ?? sale.normalized_net_sale_price) * units;
        const normalizedNetSale = numberValue(sale.normalized_net_sale_price) * units;
        const costBasis = numberValue(sale.normalized_cost_for_profit) * units;

        return {
          key: `sale-${sale.order_id}-${sale.meli_item_id}-${sale.variation_id || ""}-${sale.id || sale.order_date}`,
          sku,
          productName: sale.title || product?.name || "Venta MercadoLibre",
          category: product?.category || null,
          thumbnail: productImage(skuPublications, sale.meli_item_id),
          orderId: sale.order_id,
          meliItemId: sale.meli_item_id,
          stock: activeSkuPublications.length ? stockFromMl : numberValue(product?.stock),
          activePublications: activeSkuPublications.length,
          units,
          revenue,
          netProfit,
          netSale,
          margin: netSale > 0 ? (netProfit / netSale) * 100 : null,
          normalizedNetSale,
          normalizedProfit: netProfit,
          normalizedMargin: normalizedNetSale > 0 ? (netProfit / normalizedNetSale) * 100 : null,
          costBasis,
          marginOnCost: costBasis > 0 ? (netProfit / costBasis) * 100 : null,
          avgPrice: units > 0 ? revenue / units : null,
          stockDays: null,
          lastSale: sale.order_date,
          ...profitabilityTotals([sale]),
          itemIds: [sale.meli_item_id],
        };
      });
    }

    const salesBySku = new Map<string, MercadoLibreOrderItem[]>();
    periodSales.forEach((sale) => {
        const skuKeys = new Set<string>();
        const saleSku = (sale.sku || "").toUpperCase();

        const productSku = sale.product_id ? productById.get(sale.product_id)?.sku?.toUpperCase() : "";
        if (productSku || saleSku) skuKeys.add(productSku || saleSku);
        skuKeys.forEach((sku) => salesBySku.set(sku, [...(salesBySku.get(sku) || []), sale]));
      });

    return products.map((product) => {
      const sku = product.sku.toUpperCase();
      const skuSales = salesBySku.get(sku) || [];
      const skuPublications = publicationBySku.get(sku) || [];
      const activeSkuPublications = skuPublications.filter(isActiveMeliPublication);
      const stockFromMl = activeSkuPublications.length ? Math.max(...activeSkuPublications.map((publication) => numberValue(publication.meli_stock))) : 0;
      const revenue = skuSales.reduce((total, sale) => total + numberValue(sale.total_amount), 0);
      const units = skuSales.reduce((total, sale) => total + numberValue(sale.quantity), 0);
      const netProfit = skuSales.reduce((total, sale) => total + numberValue(sale.real_total_net_profit ?? sale.normalized_total_net_profit), 0);
      const netSale = skuSales.reduce(
        (total, sale) => total + numberValue(sale.real_net_sale_price ?? sale.normalized_net_sale_price) * numberValue(sale.quantity),
        0,
      );
      const normalizedNetSale = skuSales.reduce(
        (total, sale) => total + numberValue(sale.normalized_net_sale_price) * numberValue(sale.quantity),
        0,
      );
      const costBasis = skuSales.reduce(
        (total, sale) => total + numberValue(sale.normalized_cost_for_profit) * numberValue(sale.quantity),
        0,
      );
      const dailyUnits = units > 0 ? units / periodDays : 0;
      const stockDays = dailyUnits > 0 ? (activeSkuPublications.length ? stockFromMl : numberValue(product.stock)) / dailyUnits : null;
      const errors = skuSales.filter((sale) => sale.normalized_profit_error).length;
      const lastSale = skuSales[0]?.order_date || null;

      return {
        key: `sku-${sku}`,
        sku,
        productName: product.name,
        category: product.category,
        thumbnail: productImage(skuPublications),
        stock: activeSkuPublications.length ? stockFromMl : numberValue(product.stock),
        activePublications: activeSkuPublications.length,
        units,
        revenue,
        netProfit,
        netSale,
        margin: netSale > 0 ? (netProfit / netSale) * 100 : null,
        normalizedNetSale,
        normalizedProfit: netProfit,
        normalizedMargin: normalizedNetSale > 0 ? (netProfit / normalizedNetSale) * 100 : null,
        costBasis,
        marginOnCost: costBasis > 0 ? (netProfit / costBasis) * 100 : null,
        avgPrice: units > 0 ? revenue / units : null,
        stockDays,
        lastSale,
        ...profitabilityTotals(skuSales),
        itemIds: [...new Set(skuSales.map(sale => sale.meli_item_id).filter(Boolean))],
      };
    });
  }, [products, publications, sales, period]);

  const hasVisibleData = todayReady || !dataLoad.initial;

  const categories = useMemo(() => {
    return categoryOptions(rows.map((row) => row.category));
  }, [rows]);

  function columnFilterIsActive(filter?: ColumnFilter) {
    if (!filter) return false;
    if (filter.kind === "text") return Boolean(filter.value.trim());
    if (filter.operator === "between") return Boolean(filter.min.trim() || filter.max.trim());
    return Boolean(filter.min.trim());
  }

  function numericFilterMatches(value: number | null | undefined, filter: Extract<ColumnFilter, { kind: "number" }>) {
    const number = Number(value);
    if (!Number.isFinite(number)) return false;
    const min = Number(filter.min);
    const max = Number(filter.max);
    if (filter.operator === "gt") return Number.isFinite(min) ? number > min : true;
    if (filter.operator === "lt") return Number.isFinite(min) ? number < min : true;
    if (Number.isFinite(min) && number < min) return false;
    if (Number.isFinite(max) && number > max) return false;
    return Number.isFinite(min) || Number.isFinite(max);
  }

  function rowMatchesColumnFilters(row: ProfitabilityRow) {
    return (Object.entries(columnFilters) as Array<[FilterableColumn, ColumnFilter]>).every(([column, filter]) => {
      if (!columnFilterIsActive(filter)) return true;
      if (filter.kind === "text") {
        return `${row.productName} ${row.sku} ${row.category || ""}`.toLowerCase().includes(filter.value.trim().toLowerCase());
      }
      return numericFilterMatches(row[column] as number | null, filter);
    });
  }

  const activeColumnFilterCount = Object.values(columnFilters).filter(columnFilterIsActive).length;

  const filteredRows = useMemo(() => {
    const needle = normalizeFilter(query);
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return rows
      .filter((row) => {
        if (needle && !normalizeFilter(`${row.sku} ${row.productName} ${row.category || ""} ${row.orderId || ""} ${row.meliItemId || ""}`).includes(needle)) return false;
        if (categoryFilter && normalizeFilter(row.category) !== normalizeFilter(categoryFilter)) return false;
        if (statusFilter === "with_sales" && row.units <= 0) return false;
        if (statusFilter === "no_sales" && row.units > 0) return false;
        if (statusFilter === "low_stock" && !(row.stockDays !== null && row.stockDays < 25)) return false;
        if (statusFilter === "normal" && !(row.stockDays !== null && row.stockDays >= 25)) return false;
        if (statusFilter === "negative_margin" && !(row.margin !== null && row.margin < 0)) return false;
        if (statusFilter === "without_profit" && row.errors <= 0) return false;
        if (onlyWithSales && row.units <= 0) return false;
        if (onlyLowStock && !(row.stockDays !== null && row.stockDays < 25)) return false;
        if (!rowMatchesColumnFilters(row)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortKey === "sku" || sortKey === "productName") {
          return String(a[sortKey]).localeCompare(String(b[sortKey]), "es") * multiplier;
        }
        if (sortKey === "lastSale") {
          return ((a.lastSale ? new Date(a.lastSale).getTime() : 0) - (b.lastSale ? new Date(b.lastSale).getTime() : 0)) * multiplier;
        }
        return (numberValue(a[sortKey]) - numberValue(b[sortKey])) * multiplier;
      });
  }, [categoryFilter, columnFilters, onlyLowStock, onlyWithSales, query, rows, sortDirection, sortKey, statusFilter]);

  useRememberedView(supabase, 'rentabilidad-meli', [query, categoryFilter, sortKey, sortDirection, columnFilters, onlyWithSales, onlyLowStock, listPage, period, statusFilter], (values) => { setQuery(values[0]); setCategoryFilter(values[1]); setSortKey(values[2]); setSortDirection(values[3]); setColumnFilters(values[4]); setOnlyWithSales(values[5]); setOnlyLowStock(values[6]); setListPage(values[7]); setPeriod(values[8]); setStatusFilter(values[9]); }, !dataLoad.incomplete);
  const totals = useMemo(() => {
    const units = filteredRows.reduce((total, row) => total + row.units, 0);
    const revenue = filteredRows.reduce((total, row) => total + row.revenue, 0);
    const calculatedSales = filteredRows.reduce((total, row) => total + (row.calculatedSales || 0), 0);
    const netProfit = calculatedSales ? filteredRows.reduce((total, row) => total + (row.netProfit ?? 0), 0) : null;
    const normalizedProfit = filteredRows.reduce((total, row) => total + (row.normalizedProfit ?? 0), 0);
    const costProfit = filteredRows.reduce((total, row) => total + (row.costProfit || 0), 0);
    const coveredRevenue = filteredRows.reduce((total, row) => total + (row.coveredRevenue || 0), 0);
    const netSale = filteredRows.reduce((total, row) => total + row.netSale, 0);
    const normalizedNetSale = filteredRows.reduce((total, row) => total + row.normalizedNetSale, 0);
    const costBasis = filteredRows.reduce((total, row) => total + row.costBasis, 0);
    return {
      units,
      revenue,
      netProfit,
      grossProfitRate: netProfit !== null && coveredRevenue > 0 ? (netProfit / coveredRevenue) * 100 : null,
      margin: netProfit !== null && netSale > 0 ? (netProfit / netSale) * 100 : null,
      normalizedMargin: normalizedNetSale > 0 ? (normalizedProfit / normalizedNetSale) * 100 : null,
      marginOnCost: costBasis > 0 ? (costProfit / costBasis) * 100 : null,
      products: new Set(filteredRows.filter(row => row.units > 0).map(row => row.sku)).size,
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
    setStatusFilter("");
    setOnlyWithSales(false);
    setOnlyLowStock(false);
    setColumnFilters({});
  }

  function resetSort() {
    setSortKey("netProfit");
    setSortDirection("desc");
  }

  function updateColumnFilter(column: FilterableColumn, filter: ColumnFilter) {
    setColumnFilters((current) => ({ ...current, [column]: filter }));
  }

  function clearColumnFilter(column: FilterableColumn) {
    setColumnFilters((current) => {
      const next = { ...current };
      delete next[column];
      return next;
    });
  }

  function clearAdvancedFilters() {
    setColumnFilters({});
  }

  const columnFilterLabels: Record<FilterableColumn, string> = {
    productName: "Producto",
    activePublications: "MLA",
    units: "Unidades",
    revenue: "Facturacion",
    netProfit: "Neto",
    margin: "Margen",
    stock: "Stock",
    stockDays: "Dias stock",
  };
  const statusFilterLabels: Record<Exclude<ProfitabilityStatusFilter, "">, string> = {
    with_sales: "Con ventas",
    no_sales: "Sin ventas",
    low_stock: "Stock bajo",
    normal: "Stock normal",
    negative_margin: "Margen negativo",
    without_profit: "Sin calculo",
  };
  const quickFilterCount = [query.trim(), categoryFilter, statusFilter, onlyWithSales ? "sales" : "", onlyLowStock ? "stock" : ""].filter(Boolean).length;
  const activeFilterCount = quickFilterCount + activeColumnFilterCount;
  const defaultSortActive = sortKey === "netProfit" && sortDirection === "desc";
  const activeQuickFilterEntries = [
    query.trim() ? { key: "query", label: `Busqueda "${query.trim()}"`, clear: () => setQuery("") } : null,
    categoryFilter ? { key: "category", label: `Categoria ${categoryFilter}`, clear: () => setCategoryFilter("") } : null,
    statusFilter ? { key: "status", label: statusFilterLabels[statusFilter], clear: () => setStatusFilter("") } : null,
    onlyWithSales ? { key: "with-sales", label: "Con ventas", clear: () => setOnlyWithSales(false) } : null,
    onlyLowStock ? { key: "low-stock", label: "Stock bajo", clear: () => setOnlyLowStock(false) } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  function formatColumnFilterValue(column: FilterableColumn, filter: ColumnFilter) {
    if (filter.kind === "text") return `${columnFilterLabels[column]} contiene "${filter.value.trim()}"`;
    const unit = column === "revenue" || column === "netProfit" ? "$" : "";
    const min = filter.min.trim();
    const max = filter.max.trim();
    if (filter.operator === "gt") return `${columnFilterLabels[column]} > ${unit}${min}`;
    if (filter.operator === "lt") return `${columnFilterLabels[column]} < ${unit}${min}`;
    return `${columnFilterLabels[column]} ${min ? `>= ${unit}${min}` : ""}${min && max ? " y " : ""}${max ? `<= ${unit}${max}` : ""}`;
  }

  function activeColumnFilterEntries() {
    return (Object.entries(columnFilters) as Array<[FilterableColumn, ColumnFilter]>)
      .filter(([, filter]) => columnFilterIsActive(filter));
  }

  function renderAdvancedFilterField(column: FilterableColumn) {
    const current = columnFilters[column];
    const isText = column === "productName";
    return (
      <div className={`rotation-advanced-field ${columnFilterIsActive(current) ? "active" : ""}`} key={column}>
        <div className="rotation-advanced-field-head">
          <span>{columnFilterLabels[column]}</span>
          {columnFilterIsActive(current) && (
            <button type="button" onClick={() => clearColumnFilter(column)} aria-label={`Quitar filtro ${columnFilterLabels[column]}`}>x</button>
          )}
        </div>
        {isText ? (
          <label>
            <span>Contiene</span>
            <input
              autoFocus
              value={current?.kind === "text" ? current.value : ""}
              onChange={(event) => updateColumnFilter(column, { kind: "text", value: event.target.value })}
              placeholder="Buscar en producto"
            />
          </label>
        ) : (
          <>
            <label>
              <span>Condicion</span>
              <select
                value={current?.kind === "number" ? current.operator : "gt"}
                onChange={(event) => updateColumnFilter(column, {
                  kind: "number",
                  operator: event.target.value as NumberFilterOperator,
                  min: current?.kind === "number" ? current.min : "",
                  max: current?.kind === "number" ? current.max : "",
                })}
              >
                <option value="gt">Mayor que</option>
                <option value="lt">Menor que</option>
                <option value="between">Entre</option>
              </select>
            </label>
            <label>
              <span>{current?.kind === "number" && current.operator === "between" ? "Desde" : "Valor"}</span>
              <input
                autoFocus
                type="number"
                value={current?.kind === "number" ? current.min : ""}
                onChange={(event) => updateColumnFilter(column, {
                  kind: "number",
                  operator: current?.kind === "number" ? current.operator : "gt",
                  min: event.target.value,
                  max: current?.kind === "number" ? current.max : "",
                })}
              />
            </label>
            {current?.kind === "number" && current.operator === "between" && (
              <label>
                <span>Hasta</span>
                <input
                  type="number"
                  value={current.max}
                  onChange={(event) => updateColumnFilter(column, { ...current, max: event.target.value })}
                />
              </label>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <main className="page rotation-page">
      <PageHero
        title="Rentabilidad ML"
        description={syncing
          ? salesSyncProgress
            ? `Actualizando ventas en segundo plano: últimos ${salesSyncProgress.completed} de ${salesSyncProgress.total} días.`
            : "Actualizando primero las ventas más recientes..."
          : "Resultados históricos calculados y comparación con referencia de 1 pago. Ratios ponderados por sus bases."}
        icon={<ChartNoAxesCombined aria-hidden="true" />}
        actions={(
          <button className="button rentability-sync-button" type="button" onClick={syncSales} disabled={syncing || loading}>
            <RefreshCw aria-hidden="true" />
            {syncing ? "Sincronizando..." : "Sincronizar ventas"}
          </button>
        )}
      />

      {loading && <div className="rotation-sync-info"><span><RefreshCw aria-hidden="true" />{loadingInfo || "Cargando datos..."}</span></div>}
      <PricingDataStatus state={dataLoad.state} publications={publications} onRefresh={() => loadData()} />
      {error && <div className="alert error">{error}</div>}
      {syncInfo && <div className="rotation-sync-info"><span>{syncing && <RefreshCw aria-hidden="true" />}{syncInfo}</span></div>}
      {!loading && !error && (
        <div className="rotation-sync-info muted">
          <span>{sales.length} ventas cargadas para analizar rentabilidad.</span>
        </div>
      )}

      <details className="pricing-explanation"><summary>Cómo se calculan estos indicadores</summary><p>Ganancia real: resultado calculado y guardado para la venta, luego de costo, comisión, envío, cargo fijo, estructura e impuestos configurados. No equivale a una liquidación bancaria confirmada. Facturación incluye IVA; margen real divide ganancia por venta neta de IVA. Ganancia/facturación usa sólo ventas con ganancia calculable en ambos lados del cociente.</p><p>Margen normalizado: conserva la ganancia guardada y la divide por la venta neta de referencia de 1 pago. Es comparativo; no es otra ganancia realizada. Margen sobre costo: ganancia normalizada / costo utilizado guardado. Los totales son cocientes de sumas, nunca promedios simples de porcentajes.</p><p>Se usa el historial de costo cuando existe; registros sin historial pueden haber usado el costo vigente al sincronizar. La base guardada no identifica esa procedencia en ventas antiguas. “—” significa dato faltante o división imposible, no cero. Los indicadores excluyen registros sin cálculo válido y muestran su cantidad por fila. Período seleccionado; zona horaria Argentina.</p></details>
      <section className="rotation-summary">
        <article className="kpi-card">
          <span className="kpi-label">Productos vendidos</span>
          <strong className="kpi-value">{hasVisibleData ? formatUnits(totals.products) : "—"}</strong>
          <small className="kpi-meta">{period === "today" ? "Ventas de hoy" : `Últimos ${period} días`}</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Unidades</span>
          <strong className="kpi-value">{hasVisibleData ? formatUnits(totals.units) : "—"}</strong>
          <small className="kpi-meta">Vendidas</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Facturacion</span>
          <strong className="kpi-value">{hasVisibleData ? moneyWithCents(totals.revenue) : "—"}</strong>
          <small className="kpi-meta">ML</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Ganancia real</span>
          <strong className="kpi-value">{hasVisibleData ? moneyWithCents(totals.netProfit) : "—"}</strong>
          <small className="kpi-meta">{period === "today" ? "Ganancia del dia" : `Últimos ${period} días`}</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Ganancia / facturacion</span>
          <strong className="kpi-value">{hasVisibleData ? percent(totals.grossProfitRate) : "—"}</strong>
          <small className="kpi-meta">Sobre venta bruta ML</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Margen real</span>
          <strong className="kpi-value">{hasVisibleData ? percent(totals.margin) : "—"}</strong>
          <small className="kpi-meta">Sobre ventas reales</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Margen normalizado</span>
          <strong className="kpi-value">{hasVisibleData ? percent(totals.normalizedMargin) : "—"}</strong>
          <small className="kpi-meta">Base comparable 1 pago</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Margen sobre costo</span>
          <strong className="kpi-value">{hasVisibleData ? percent(totals.marginOnCost) : "—"}</strong>
          <small className="kpi-meta">Ganancia / costo usado</small>
        </article>
      </section>

      <section className="card rotation-card">
        <div className="rotation-toolbar">
          <PricingSearch value={query} onChange={setQuery} />
          <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} categories={categories} />
          <select aria-label="Estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ProfitabilityStatusFilter)}>
            <option value="">Todos los estados</option>
            <option value="with_sales">Con ventas</option>
            <option value="no_sales">Sin ventas</option>
            <option value="low_stock">Stock bajo</option>
            <option value="normal">Stock normal</option>
            <option value="negative_margin">Margen negativo</option>
            <option value="without_profit">Sin calculo</option>
          </select>
          <label className={`rotation-filter-chip ${onlyWithSales ? "active" : ""}`}>
            <input type="checkbox" checked={onlyWithSales} onChange={(event) => setOnlyWithSales(event.target.checked)} />
            {onlyWithSales && <Check aria-hidden="true" />}
            Con ventas
          </label>
          <label className={`rotation-filter-chip ${onlyLowStock ? "active" : ""}`}>
            <input type="checkbox" checked={onlyLowStock} onChange={(event) => setOnlyLowStock(event.target.checked)} />
            {onlyLowStock && <Check aria-hidden="true" />}
            Stock bajo
          </label>
          <button
            className={`rotation-advanced-toggle ${advancedFiltersOpen || activeColumnFilterCount ? "active" : ""}`}
            type="button"
            onClick={() => setAdvancedFiltersOpen((current) => !current)}
          >
            <Filter aria-hidden="true" />
            Filtros avanzados{activeColumnFilterCount ? ` · ${activeColumnFilterCount}` : ""}
          </button>
        </div>
        <div className="rotation-period-row">
          {(["today", 7, 30, 60] as Period[]).map((option) => (
            <button className={period === option ? "active" : ""} type="button" onClick={() => setPeriod(option)} key={option}>
              {option === "today" ? "Hoy" : `${option} dias`}
            </button>
          ))}
        </div>
        {advancedFiltersOpen && (
          <div className="rotation-advanced-panel">
            <div className="rotation-advanced-grid">
              {renderAdvancedFilterField("productName")}
              {renderAdvancedFilterField("activePublications")}
              {renderAdvancedFilterField("units")}
              {renderAdvancedFilterField("revenue")}
              {renderAdvancedFilterField("netProfit")}
              {renderAdvancedFilterField("margin")}
              {renderAdvancedFilterField("stock")}
              {renderAdvancedFilterField("stockDays")}
            </div>
            <div className="rotation-advanced-actions">
              <button className="button ghost small-button" type="button" onClick={() => setAdvancedFiltersOpen(false)}>Cerrar</button>
              <button className="button ghost small-button" type="button" onClick={clearAdvancedFilters} disabled={!activeColumnFilterCount}>Limpiar filtros avanzados</button>
            </div>
          </div>
        )}

        <div className="rotation-table-status">
          <div className="rotation-active-context">
            <span>{hasVisibleData ? filteredRows.length : "—"} de {hasVisibleData ? rows.length : "—"} {period === "today" ? "ventas" : "productos"}</span>
            <span>{period === "today" ? "Periodo hoy" : `Periodo ${period} dias`}</span>
            {activeQuickFilterEntries.map((filter) => (
              <button className="rotation-active-filter" type="button" key={filter.key} onClick={filter.clear}>
                {filter.label} <span aria-hidden="true">x</span>
              </button>
            ))}
            {activeColumnFilterEntries().map(([column, filter]) => (
              <button className="rotation-active-filter" type="button" key={column} onClick={() => clearColumnFilter(column)}>
                {formatColumnFilterValue(column, filter)} <span aria-hidden="true">x</span>
              </button>
            ))}
            <span>Ordenado por {sortLabels[sortKey]} {sortDirection === "asc" ? "↑" : "↓"}</span>
          </div>
          <div className="rotation-table-actions">
            {activeFilterCount ? <button className="button ghost small-button" type="button" onClick={clearFilters}>Limpiar filtros</button> : null}
            {!defaultSortActive ? <button className="button ghost small-button" type="button" onClick={resetSort}>Restablecer orden</button> : null}
          </div>
        </div>

        <PricingPagination page={listPage} total={hasVisibleData ? filteredRows.length : 0} onPage={setListPage} />
          <div className="rotation-table-wrap">
          <table className="rotation-table">
            <colgroup>
              <col className="rentability-col-product" />
              <col className="rentability-col-small" />
              <col className="rentability-col-small" />
              <col className="rentability-col-money" />
              <col className="rentability-col-money" />
              <col className="rentability-col-rate" />
              <col className="rentability-col-rate-wide" />
              <col className="rentability-col-rate" />
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
                <th className="numeric-header"><SortButton column="netProfit">Ganancia real</SortButton></th>
                <th className="numeric-header"><SortButton column="margin">Margen real</SortButton></th>
                <th className="numeric-header"><SortButton column="normalizedMargin">Margen normalizado</SortButton></th>
                <th className="numeric-header"><SortButton column="marginOnCost">Margen s/costo</SortButton></th>
                <th className="date-header"><SortButton column="lastSale">{period === "today" ? "Hora" : "Última venta"}</SortButton></th>
                <th className="numeric-header"><SortButton column="activePublications">Publicaciones activas</SortButton></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice((Math.min(listPage, Math.max(1, Math.ceil(filteredRows.length / 40))) - 1) * 40, Math.min(listPage, Math.max(1, Math.ceil(filteredRows.length / 40))) * 40).map((row) => (
                <tr key={row.key}>
                  <td>
                    <div className="rotation-product-cell">
                      <RentabilityThumbnail src={row.thumbnail} label={productInitial(row.productName, row.sku)} />
                      <div className="rotation-product-text">
                        <strong>{row.productName}</strong>
                        <span>
                          {row.sku}{row.category ? ` · ${row.category}` : ""}
                          {period === "today" && row.orderId ? ` · Orden ${row.orderId}` : ""}
                          {period === "today" && row.meliItemId ? ` · ${row.meliItemId}` : ""}
                        </span>
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
                  <td className={`numeric ${marginClass(row.normalizedMargin)}`}>{percent(row.normalizedMargin)}</td>
                  <td className={`numeric ${marginClass(row.marginOnCost)}`}>{percent(row.marginOnCost)}</td>
                  <td className="date-cell">{period === "today" ? shortDateTime(row.lastSale) : shortDate(row.lastSale)}</td>
                  <td className="numeric">{formatUnits(row.activePublications)}<details><summary>MLA vendidos</summary>{row.itemIds?.map(id => <div key={id}><code>{id}</code><button className="button ghost small-button" aria-label={`Copiar ${id}`} onClick={() => navigator.clipboard.writeText(id).catch(() => setError("No se pudo copiar el MLA."))}>Copiar</button></div>)}</details></td>
                </tr>
              ))}
              {!dataLoad.incomplete && !filteredRows.length && (
                <tr>
                  <td colSpan={10}>
                    <div className="empty-state">
                      {loading
                        ? "Cargando ventas..."
                        : period === "today"
                          ? "No hay ventas de hoy para los filtros actuales. Proba 7 dias o sincroniza ventas."
                          : "No hay ventas para los filtros actuales."}
                    </div>
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
          min-width: 0;
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
          font-size: clamp(18px, 1.55vw, 26px);
          font-weight: 800;
          line-height: 1.08;
          letter-spacing: 0;
          font-variant-numeric: tabular-nums;
          max-width: 100%;
          overflow-wrap: anywhere;
          white-space: normal;
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
          animation: spin 0.9s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .rotation-card {
          padding: 18px;
        }
        .rotation-toolbar {
          display: grid;
          grid-template-columns: minmax(280px, 1fr) 190px 180px auto auto auto;
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
        .rotation-period-row {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin: 0 0 10px;
        }
        .rotation-period-row button {
          min-height: 36px;
          border: 1px solid #cfe0f6;
          border-radius: 999px;
          background: #fff;
          cursor: pointer;
          padding: 0 14px;
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
        }
        .rotation-period-row button.active {
          border-color: #2563eb;
          background: #eff6ff;
          color: #1d4ed8;
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
        .rotation-filter-chip svg {
          width: 13px;
          height: 13px;
          color: #1d4ed8;
        }
        .rotation-filter-chip.active {
          border-color: #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
        }
        .rotation-advanced-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 36px;
          border: 1px solid #dbe4f0;
          border-radius: 9px;
          background: #fff;
          color: #2563eb;
          padding: 0 11px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
        }
        .rotation-advanced-toggle:hover,
        .rotation-advanced-toggle.active {
          border-color: #bfdbfe;
          background: #eff6ff;
        }
        .rotation-advanced-toggle svg {
          width: 14px;
          height: 14px;
          stroke-width: 1.9;
        }
        .rotation-advanced-panel {
          display: grid;
          gap: 12px;
          margin: 0 0 12px;
          padding: 12px;
          border: 1px solid #dbe6f4;
          border-radius: 10px;
          background: #f8fafc;
        }
        .rotation-advanced-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .rotation-advanced-field {
          display: grid;
          gap: 7px;
          min-width: 0;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          background: #fff;
          padding: 10px;
        }
        .rotation-advanced-field.active {
          border-color: #bfdbfe;
          background: #f8fbff;
        }
        .rotation-advanced-field-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          color: #0f172a;
          font-size: 12px;
          font-weight: 800;
        }
        .rotation-advanced-field-head button {
          all: unset;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          color: #64748b;
          cursor: pointer;
        }
        .rotation-advanced-field-head button:hover {
          background: #e2e8f0;
          color: #0f172a;
        }
        .rotation-advanced-field label {
          display: grid;
          gap: 4px;
        }
        .rotation-advanced-field label span {
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
        }
        .rotation-advanced-field input,
        .rotation-advanced-field select {
          width: 100%;
          min-height: 34px;
          border: 1px solid #cfe0f6;
          border-radius: 8px;
          padding: 0 9px;
          background: #fff;
          color: #0f172a;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }
        .rotation-advanced-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
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
        .rotation-active-context {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
          min-width: 0;
        }
        .rotation-active-filter {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 24px;
          border: 1px solid #bfdbfe;
          border-radius: 999px;
          background: #eff6ff;
          color: #1d4ed8;
          padding: 0 8px;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
        }
        .rotation-active-filter.passive {
          cursor: default;
        }
        .rotation-active-filter span {
          color: inherit;
          font-size: 12px;
          margin: 0;
        }
        .rotation-table-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .rotation-table-wrap {
          width: 100%;
          overflow-x: auto;
        }
        .rotation-table {
          width: 100%;
          min-width: 1480px;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
        }
        .rentability-col-product { width: 390px; }
        .rentability-col-small { width: 104px; }
        .rentability-col-money { width: 172px; }
        .rentability-col-rate { width: 128px; }
        .rentability-col-rate-wide { width: 164px; }
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
          white-space: normal;
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
        :global(.rotation-page .rotation-table th .rotation-sort-trigger) {
          max-width: 100%;
          white-space: normal !important;
          word-break: keep-all;
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
        :global(.rotation-page .rotation-sort-trigger) {
          all: unset;
          appearance: none !important;
          -webkit-appearance: none !important;
          display: inline-flex;
          align-items: center;
          justify-content: inherit;
          gap: 4px;
          width: auto;
          border: 0 !important;
          border-radius: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          color: inherit;
          font: inherit;
          font-size: inherit;
          font-weight: inherit;
          min-height: 0 !important;
          height: auto !important;
          line-height: 1.2;
          padding: 2px 0 !important;
          text-align: inherit;
          cursor: pointer;
          white-space: nowrap;
        }
        :global(.rotation-page .rotation-sort-trigger:hover) {
          color: #2563eb;
        }
        :global(.rotation-page .rotation-sort-trigger.active) {
          color: #1d4ed8;
        }
        .numeric-header .rotation-sort-trigger,
        .date-header .rotation-sort-trigger {
          justify-content: flex-end;
        }
        :global(.rotation-page .rotation-sort-trigger svg) {
          width: 12px;
          height: 12px;
          flex: 0 0 12px;
          stroke-width: 1.7;
        }
        :global(.rotation-page .rotation-sort-trigger .idle-sort-icon) {
          width: 0;
          opacity: 0;
          transition: opacity 0.12s ease, width 0.12s ease;
        }
        :global(.rotation-page .rotation-sort-trigger:hover .idle-sort-icon) {
          width: 12px;
          opacity: 0.55;
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
          .rotation-toolbar > * {
            min-width: 0;
          }
          .rotation-table-status {
            align-items: flex-start;
            flex-direction: column;
          }
          .rotation-advanced-grid {
            grid-template-columns: 1fr;
          }
          .rotation-period-row {
            justify-content: stretch;
          }
          .rotation-period-row select {
            width: 100%;
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
