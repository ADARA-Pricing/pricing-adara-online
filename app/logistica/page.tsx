"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Download, Printer, RefreshCw, Search, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { usePricingLoad } from "@/lib/usePricingLoad";
import { PricingDataStatus, PricingPagination } from "@/components/PricingDataStatus";
import type { MercadoLibreOrderItem } from "@/lib/types";

type Mode = "all" | "cross_docking" | "self_service";
type Shipment = { id: string; mode: "cross_docking" | "self_service"; orderIds: string[]; date: string; items: MercadoLibreOrderItem[] };

const PAGE_SIZE = 50;

function argentinaTodayStart() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${day}T00:00:00-03:00`);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function modeLabel(mode: Shipment["mode"]) { return mode === "cross_docking" ? "Colecta" : "Flex"; }

export default function LogisticaPage() {
  const router = useRouter();
  const supabase = createClient();
  const dataLoad = usePricingLoad("logistica", supabase);
  const [sales, setSales] = useState<MercadoLibreOrderItem[]>([]);
  const [mode, setMode] = useState<Mode>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadData(force = false) {
    const since = argentinaTodayStart();
    since.setDate(since.getDate() - 14);
    await dataLoad.run({
      sales: {
        table: "mercadolibre_order_items",
        columns: "id,order_id,order_date,status,pack_id,shipment_id,shipping_logistic_type,meli_item_id,sku,title,quantity",
        filters: [["gte", "order_date", since.toISOString()], ["neq", "status", "cancelled"]],
        order: "order_date", ascending: false,
      },
    }, (data) => setSales(data.sales), force);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/login");
      else void loadData();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shipments = useMemo(() => {
    const groups = new Map<string, Shipment>();
    for (const sale of sales) {
      const logistic = sale.shipping_logistic_type;
      if (!sale.shipment_id || (logistic !== "cross_docking" && logistic !== "self_service")) continue;
      const id = String(sale.shipment_id);
      const current = groups.get(id) || { id, mode: logistic, orderIds: [], date: sale.order_date, items: [] };
      if (!current.orderIds.includes(sale.order_id)) current.orderIds.push(sale.order_id);
      if (sale.order_date > current.date) current.date = sale.order_date;
      current.items.push(sale);
      groups.set(id, current);
    }
    return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [sales]);

  const counts = useMemo(() => ({
    all: shipments.length,
    cross_docking: shipments.filter((item) => item.mode === "cross_docking").length,
    self_service: shipments.filter((item) => item.mode === "self_service").length,
  }), [shipments]);
  const unclassified = useMemo(() => sales.filter((sale) => !sale.shipment_id || !["cross_docking", "self_service"].includes(sale.shipping_logistic_type || "")).length, [sales]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es-AR");
    return shipments.filter((item) => (mode === "all" || item.mode === mode) && (!term || [item.id, ...item.orderIds, ...item.items.flatMap((sale) => [sale.sku, sale.title || ""])].some((text) => text.toLocaleLowerCase("es-AR").includes(term))));
  }, [shipments, mode, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageIds = pageItems.map((item) => item.id);
  const selectedOnPage = selected.filter((id) => pageIds.includes(id));

  function changeView(nextMode: Mode) { setMode(nextMode); setPage(1); setSelected([]); }
  function changePage(nextPage: number) { setPage(nextPage); setSelected([]); }
  function changeQuery(value: string) { setQuery(value); setPage(1); setSelected([]); }
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function togglePage() { setSelected(selectedOnPage.length === pageIds.length ? [] : pageIds); }

  async function refresh() {
    if (syncing) return;
    setSyncing(true);
    setMessage("Actualizando ventas recientes desde Mercado Libre...");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesión vencida. Volvé a iniciar sesión.");
      const from = argentinaTodayStart();
      from.setDate(from.getDate() - 1);
      const response = await fetch("/api/mercadolibre/sync-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ from: from.toISOString(), to: new Date().toISOString(), chunkDays: 1 }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudieron actualizar las ventas.");
      await loadData(true);
      setMessage(`${Number(result.saved || 0)} ventas nuevas o modificadas. La disponibilidad de etiquetas se confirma al imprimir.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar.");
    } finally { setSyncing(false); }
  }

  async function printLabels(ids: string[], format: "pdf" | "zpl") {
    if (!ids.length || ids.length > PAGE_SIZE || printing) return;
    const pdfTab = format === "pdf" ? window.open("", "_blank") : null;
    setPrinting(true);
    setMessage(`Solicitando ${ids.length} etiqueta${ids.length === 1 ? "" : "s"} a Mercado Libre...`);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesión vencida. Volvé a iniciar sesión.");
      const response = await fetch("/api/mercadolibre/shipment-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ shipmentIds: ids, format }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Mercado Libre no pudo generar las etiquetas.");
      }
      const url = URL.createObjectURL(await response.blob());
      if (format === "pdf" && pdfTab) pdfTab.location.href = url;
      else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `etiquetas-ml-${ids.length}.${format}`;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      setMessage(format === "pdf" ? "PDF abierto: usá Imprimir en el visor del navegador." : "Archivo ZPL descargado para la impresora térmica.");
    } catch (error) {
      pdfTab?.close();
      setMessage(error instanceof Error ? error.message : "No se pudieron obtener las etiquetas.");
    } finally { setPrinting(false); }
  }

  function printPickList(items: Shipment[]) {
    if (!items.length) return;
    const tab = window.open("", "_blank");
    if (!tab) { setMessage("Permití las ventanas emergentes para imprimir la hoja de preparación."); return; }
    const doc = tab.document;
    doc.title = `Preparación de ${items.length} envíos`;
    const style = doc.createElement("style");
    style.textContent = "body{font:12px Arial,sans-serif;margin:18mm;color:#111}h1{font-size:20px}h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%;margin:10px 0 20px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}.check{width:28px}.order{page-break-inside:avoid}@media print{button{display:none}}";
    doc.head.append(style);
    const heading = doc.createElement("h1");
    heading.textContent = `Hoja de preparación · ${items.length} envíos`;
    doc.body.append(heading);
    const subheading = doc.createElement("p");
    subheading.textContent = `Generada ${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })} · Página ${currentPage} · ${mode === "all" ? "Colecta y Flex" : mode === "cross_docking" ? "Colecta" : "Flex"}`;
    doc.body.append(subheading);
    const totals = new Map<string, { title: string; quantity: number }>();
    items.forEach((shipment) => shipment.items.forEach((sale) => {
      const key = sale.sku || sale.meli_item_id || "Sin SKU";
      const current = totals.get(key) || { title: sale.title || "", quantity: 0 };
      current.quantity += Number(sale.quantity || 0);
      totals.set(key, current);
    }));
    const table = (columns: string[], rows: string[][]) => {
      const element = doc.createElement("table");
      const header = doc.createElement("tr");
      columns.forEach((text) => { const th = doc.createElement("th"); th.textContent = text; header.append(th); });
      element.append(header);
      rows.forEach((values) => { const row = doc.createElement("tr"); values.forEach((text) => { const td = doc.createElement("td"); td.textContent = text; row.append(td); }); element.append(row); });
      return element;
    };
    const totalsHeading = doc.createElement("h2"); totalsHeading.textContent = "Buscar en depósito · total por producto"; doc.body.append(totalsHeading);
    doc.body.append(table(["✓", "SKU", "Producto", "Cantidad"], [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sku, value]) => ["☐", sku, value.title, String(value.quantity)])));
    const ordersHeading = doc.createElement("h2"); ordersHeading.textContent = "Control por paquete"; doc.body.append(ordersHeading);
    doc.body.append(table(["✓", "Envío", "Modalidad", "Pedido", "SKU", "Producto", "Cantidad"], items.flatMap((shipment) => shipment.items.map((sale) => ["☐", shipment.id, modeLabel(shipment.mode), sale.order_id, sale.sku || "Sin SKU", sale.title || "", String(sale.quantity)]))));
    tab.setTimeout(() => tab.print(), 300);
  }

  return <main className="container wide logistics-page">
    <header className="logistics-header">
      <div><h1>Logística Mercado Libre</h1><p>Prepará envíos de Colecta y Flex. Se muestran ventas guardadas de los últimos 14 días; Mercado Libre confirma si cada etiqueta está lista al solicitarla.</p></div>
      <button className="button" type="button" onClick={refresh} disabled={syncing}><RefreshCw size={16} /> {syncing ? "Actualizando..." : "Actualizar ventas"}</button>
    </header>
    <PricingDataStatus state={dataLoad.state} onRefresh={() => void loadData(true)} />
    {message && <div className="message info" role="status">{message}</div>}
    {unclassified > 0 && <div className="message info">{unclassified} renglones de venta no aparecen aquí porque no tienen ID de envío o modalidad Colecta/Flex confirmada.</div>}
    <div className="logistics-tabs" role="tablist" aria-label="Tipo de envío">
      {(["all", "cross_docking", "self_service"] as Mode[]).map((value) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? "active" : ""} onClick={() => changeView(value)}>{value === "all" ? "Todos" : value === "cross_docking" ? "Colecta" : "Flex"} <span>{counts[value]}</span></button>)}
    </div>
    <div className="logistics-toolbar">
      <label className="logistics-search"><Search size={17} /><input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Buscar pedido, envío, SKU o producto" /></label>
      <div className="logistics-actions">
        <button className="button ghost" type="button" onClick={() => printLabels(selectedOnPage, "pdf")} disabled={!selectedOnPage.length || printing}><Printer size={16} /> Imprimir seleccionadas ({selectedOnPage.length})</button>
        <button className="button ghost" type="button" onClick={() => printLabels(pageIds, "pdf")} disabled={!pageIds.length || printing}><ClipboardList size={16} /> Imprimir página ({pageIds.length})</button>
        <button className="button ghost" type="button" onClick={() => printPickList(pageItems)} disabled={!pageItems.length}><ClipboardList size={16} /> Hoja de preparación</button>
        <button className="button ghost" type="button" onClick={() => printLabels(selectedOnPage.length ? selectedOnPage : pageIds, "zpl")} disabled={!pageIds.length || printing}><Download size={16} /> Descargar ZPL</button>
      </div>
    </div>
    <div className="logistics-select-row"><label><input type="checkbox" checked={pageIds.length > 0 && selectedOnPage.length === pageIds.length} onChange={togglePage} disabled={!pageIds.length} /> Seleccionar los {pageIds.length} envíos de esta página</label><span>Máximo 50 etiquetas por solicitud</span></div>
    <div className="logistics-list">
      {pageItems.map((shipment) => <article className="logistics-order" key={shipment.id}>
        <div className="logistics-order-head"><label><input type="checkbox" checked={selectedOnPage.includes(shipment.id)} onChange={() => toggle(shipment.id)} /><strong>Envío #{shipment.id}</strong></label><span className="logistics-mode"><Truck size={15} /> {modeLabel(shipment.mode)}</span><span>{dateLabel(shipment.date)}</span><button className="button ghost" type="button" onClick={() => printLabels([shipment.id], "pdf")} disabled={printing}><Printer size={15} /> Imprimir etiqueta</button></div>
        <div className="logistics-order-meta">Pedido{shipment.orderIds.length > 1 ? "s" : ""} {shipment.orderIds.join(", ")} · {shipment.items.reduce((total, sale) => total + Number(sale.quantity || 0), 0)} unidades</div>
        <div className="logistics-products">{shipment.items.map((sale, index) => <div key={sale.id || `${sale.order_id}-${index}`}><strong>{sale.sku || "Sin SKU"}</strong><span>{sale.title || sale.meli_item_id}</span><b>{sale.quantity} u.</b></div>)}</div>
      </article>)}
      {!pageItems.length && <div className="empty-state">No hay envíos de {mode === "all" ? "Colecta o Flex" : mode === "cross_docking" ? "Colecta" : "Flex"} que coincidan con la búsqueda.</div>}
    </div>
    <PricingPagination page={currentPage} total={filtered.length} size={PAGE_SIZE} onPage={changePage} />
  </main>;
}
