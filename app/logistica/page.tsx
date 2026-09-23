"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Download, Printer, RefreshCw, Search } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { PricingPagination } from "@/components/PricingDataStatus";
import { LogisticsBatches } from "@/components/LogisticsBatches";
import { LogisticsSummary } from "@/components/LogisticsSummary";

type Day = "today" | "tomorrow";
type Mode = "all" | "cross_docking" | "self_service";
type StatusFilter = "all" | "ready_to_print" | "printed";
type Item = { orderId: string; itemId: string; sku: string; title: string; image: string | null; quantity: number; unitPrice: number };
type Shipment = { id: string; mode: "cross_docking" | "self_service"; status: "ready_to_print" | "printed" | "other"; substatus: string | null; dispatchAt: string; orderIds: string[]; orderDate: string; buyer: string; locality?: string | null; province?: string | null; items: Item[] };
const PAGE_SIZE = 50;

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function modeLabel(mode: Shipment["mode"]) { return mode === "cross_docking" ? "Colecta" : "Flex"; }
function money(value: number) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value); }

export default function LogisticaPage() {
  const router = useRouter();
  const supabase = createClient();
  const [day, setDay] = useState<Day>("today");
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [mode, setMode] = useState<Mode>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"sales" | "batches" | "summary">("sales");
  const [batchRefresh, setBatchRefresh] = useState(0);
  const [pendingPrinted, setPendingPrinted] = useState<Shipment[]>([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const requestId = useRef(0);

  async function loadBoard(target: Day = day) {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.push("/login"); return; }
      const response = await fetch(`/api/mercadolibre/logistics-board?day=${target}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo consultar Mercado Libre.");
      if (currentRequest !== requestId.current) return;
      setShipments(result.shipments || []);
      setCheckedAt(result.checkedAt || null);
      setIncomplete(Boolean(result.incomplete));
      setSelected([]);
      setMessage(null);
    } catch (error) {
      if (currentRequest === requestId.current) setMessage(error instanceof Error ? error.message : "No se pudo actualizar el panel.");
    } finally { if (currentRequest === requestId.current) setLoading(false); }
  }

  useEffect(() => { void loadBoard(day); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [day]);
  useEffect(() => {
    try { setPendingPrinted(JSON.parse(window.localStorage.getItem("adara-pending-printed-batch") || "[]") as Shipment[]); } catch { /* Ignorar estado local dañado. */ }
    setPendingLoaded(true);
  }, []);
  useEffect(() => { if (pendingLoaded) window.localStorage.setItem("adara-pending-printed-batch", JSON.stringify(pendingPrinted)); }, [pendingPrinted, pendingLoaded]);

  const counts = useMemo(() => {
    const count = (mode: Shipment["mode"], status: Shipment["status"]) => shipments.filter((item) => item.mode === mode && item.status === status).length;
    return {
      flex: { unprinted: count("self_service", "ready_to_print"), printed: count("self_service", "printed") },
      collection: { unprinted: count("cross_docking", "ready_to_print"), printed: count("cross_docking", "printed") },
    };
  }, [shipments]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es-AR");
    return shipments.filter((shipment) =>
      (mode === "all" || shipment.mode === mode) &&
      (statusFilter === "all" || shipment.status === statusFilter) &&
      (!term || [shipment.id, shipment.buyer, ...shipment.orderIds, ...shipment.items.flatMap((item) => [item.sku, item.title])].some((text) => text.toLocaleLowerCase("es-AR").includes(term))),
    );
  }, [shipments, mode, statusFilter, query]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const printableOnPage = pageItems.filter((item) => item.status === "ready_to_print");
  const printableIds = printableOnPage.map((item) => item.id);
  const selectedOnPage = selected.filter((id) => printableIds.includes(id));
  const printedIds = pageItems.filter((item) => item.status === "printed").map((item) => item.id);
  const selectedPrintedOnPage = selected.filter((id) => printedIds.includes(id));
  const selectableIds = statusFilter === "printed" ? printedIds : printableIds;
  const selectedSelectable = selected.filter((id) => selectableIds.includes(id));
  const reprintView = statusFilter === "printed";
  const labelIdsOnPage = reprintView ? printedIds : printableIds;
  const selectedLabelIds = reprintView ? selectedPrintedOnPage : selectedOnPage;
  const flexControlItems = pageItems.filter((item) => item.mode === "self_service" && (!selected.length || selected.includes(item.id)));

  function selectView(nextMode: Mode, nextStatus: StatusFilter) { setMode(nextMode); setStatusFilter(nextStatus); setPage(1); setSelected([]); }
  function selectDay(next: Day) { setDay(next); selectView("all", "all"); }
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  async function printLabels(ids: string[], format: "zebra" | "zpl" | "control") {
    if (!ids.length || ids.length > PAGE_SIZE || printing) return;
    const newIds = ids.filter((id) => shipments.find((item) => item.id === id)?.status === "ready_to_print");
    if (format === "zebra" && pendingPrinted.length && newIds.length && (ids.length !== pendingPrinted.length || ids.some((id) => !pendingPrinted.some((item) => item.id === id)))) {
      setMessage("Primero confirmá la tanda anterior o reimprimí esas mismas etiquetas antes de crear otra.");
      return;
    }
    const pdfTab = format === "control" ? window.open("", "_blank") : null;
    setPrinting(true);
    setMessage(`Solicitando ${ids.length} etiqueta${ids.length === 1 ? "" : "s"} a Mercado Libre...`);
    try {
      const bridge = "https://localhost:9101";
      let printer: Record<string, unknown> | null = null;
      if (format === "zebra") {
        let printerResponse: Response;
        try {
          printerResponse = await fetch(`${bridge}/default?type=printer`, { signal: AbortSignal.timeout(5000) });
        } catch {
          throw new Error("El navegador no puede comunicarse con Zebra Browser Print. Comprobá que esté abierto (ícono de Zebra junto al reloj) y autorizá el acceso de este sitio. Si el navegador muestra un problema de certificado local, revisalo en Browser Print. No se pidió ninguna etiqueta a Mercado Libre.");
        }
        if (!printerResponse.ok) throw new Error(`Zebra Browser Print respondió con error ${printerResponse.status}. Revisá su configuración; no se pidió ninguna etiqueta a Mercado Libre.`);
        printer = await printerResponse.json();
        if (!printer?.uid) throw new Error("Zebra Browser Print está abierto, pero no tiene una impresora predeterminada. En el ícono de Zebra junto al reloj: Settings → Default Devices → Change → elegí la ZD220 → Set. No se pidió ninguna etiqueta a Mercado Libre.");
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesión vencida. Volvé a iniciar sesión.");
      const response = await fetch("/api/mercadolibre/shipment-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ shipmentIds: ids, format: format === "zebra" ? "zpl" : format }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Mercado Libre no pudo generar las etiquetas.");
      }
      if (format === "zebra") {
        const zpl = await response.text();
        if (!zpl.includes("^XA") || !zpl.includes("^XZ")) throw new Error("Mercado Libre no devolvió etiquetas ZPL válidas.");
        const writeResponse = await fetch(`${bridge}/write`, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({ device: printer, data: zpl }),
          signal: AbortSignal.timeout(30000),
        });
        if (!writeResponse.ok) throw new Error("La Zebra no aceptó el trabajo de impresión. Revisá Browser Print y reintentá.");
        if (newIds.length) setPendingPrinted(newIds.map((id) => shipments.find((item) => item.id === id)).filter((item): item is Shipment => Boolean(item)));
      } else {
        const url = URL.createObjectURL(await response.blob());
        if (format === "control" && pdfTab) pdfTab.location.href = url;
        else {
          const link = document.createElement("a");
          link.href = url;
          link.download = format === "control" ? `hoja-control-ml-${ids.length}.pdf` : `etiquetas-ml-${ids.length}.zpl`;
          link.click();
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      }
      await loadBoard(day);
      setMessage(format === "zebra" ? newIds.length ? `Se enviaron ${ids.length} etiquetas ZPL a la Zebra. Confirmá que salieron correctamente antes de preparar el lote.` : `Se enviaron ${ids.length} etiquetas ZPL para reimpresión. El lote existente no cambió.` : format === "control" ? "Hoja de control de Mercado Libre abierta para imprimir en papel." : "ZPL descargado.");
    } catch (error) {
      pdfTab?.close();
      setMessage(error instanceof Error ? error.message : "No se pudieron obtener las etiquetas.");
    } finally { setPrinting(false); }
  }

  async function confirmPrinted() {
    if (!pendingPrinted.length || printing) return;
    setPrinting(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesión vencida.");
      const warnings: string[] = [];
      for (const mode of ["self_service", "cross_docking"] as const) {
        const group = pendingPrinted.filter((item) => item.mode === mode);
        if (!group.length) continue;
        const response = await fetch("/api/mercadolibre/logistics-batches", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ shipments: group }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudo crear el lote.");
        if (result.warning) warnings.push(result.warning);
        setPendingPrinted((current) => current.filter((item) => item.mode !== mode));
      }
      setBatchRefresh((value) => value + 1);
      setTab("batches");
      setMessage(warnings.length ? warnings.join(" ") : "Lote creado y hoja de control oficial guardada. Ya podés comenzar la preparación.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo crear el lote."); }
    finally { setPrinting(false); }
  }

  async function createBatchFromPrinted() {
    const group = selectedPrintedOnPage.map((id) => shipments.find((item) => item.id === id)).filter((item): item is Shipment => Boolean(item));
    if (!group.length || printing) return;
    setPrinting(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesión vencida.");
      const warnings: string[] = [];
      for (const mode of ["self_service", "cross_docking"] as const) {
        const byMode = group.filter((item) => item.mode === mode);
        if (!byMode.length) continue;
        const response = await fetch("/api/mercadolibre/logistics-batches", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ shipments: byMode }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudo crear el lote.");
        if (result.warning) warnings.push(result.warning);
      }
      setSelected([]); setBatchRefresh((value) => value + 1); setTab("batches");
      setMessage(warnings.length ? warnings.join(" ") : "Lote creado con las etiquetas impresas y hoja de control oficial guardada.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo crear el lote."); }
    finally { setPrinting(false); }
  }

  function printPickList(items: Shipment[]) {
    if (!items.length) return;
    const tab = window.open("", "_blank");
    if (!tab) { setMessage("Permití las ventanas emergentes para imprimir la hoja de preparación."); return; }
    const doc = tab.document;
    doc.title = `Preparación de ${items.length} envíos`;
    const style = doc.createElement("style");
    style.textContent = "body{font:12px Arial,sans-serif;margin:18mm;color:#111}h1{font-size:20px}h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%;margin:10px 0 20px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}";
    doc.head.append(style);
    const addHeading = (tag: "h1" | "h2", text: string) => { const el = doc.createElement(tag); el.textContent = text; doc.body.append(el); };
    const table = (columns: string[], rows: string[][]) => {
      const element = doc.createElement("table");
      const header = doc.createElement("tr"); columns.forEach((text) => { const th = doc.createElement("th"); th.textContent = text; header.append(th); }); element.append(header);
      rows.forEach((values) => { const row = doc.createElement("tr"); values.forEach((text) => { const td = doc.createElement("td"); td.textContent = text; row.append(td); }); element.append(row); }); doc.body.append(element);
    };
    addHeading("h1", `Hoja de preparación · ${items.length} envíos`);
    const totals = new Map<string, { title: string; quantity: number }>();
    items.forEach((shipment) => shipment.items.forEach((item) => { const sku = item.sku || item.itemId || "Sin SKU"; const current = totals.get(sku) || { title: item.title, quantity: 0 }; current.quantity += item.quantity; totals.set(sku, current); }));
    addHeading("h2", "Buscar en depósito · total por producto");
    table(["✓", "SKU", "Producto", "Cantidad"], [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sku, value]) => ["☐", sku, value.title, String(value.quantity)]));
    addHeading("h2", "Control por paquete");
    table(["✓", "Envío", "Modalidad", "Pedido", "SKU", "Producto", "Cantidad"], items.flatMap((shipment) => shipment.items.map((item) => ["☐", shipment.id, modeLabel(shipment.mode), item.orderId, item.sku || "Sin SKU", item.title, String(item.quantity)])));
    tab.setTimeout(() => tab.print(), 300);
  }

  function printFlexControl(items: Shipment[]) {
    const flex = items.filter((item) => item.mode === "self_service");
    if (!flex.length) return;
    const tab = window.open("", "_blank");
    if (!tab) { setMessage("Permití las ventanas emergentes para imprimir la hoja Flex."); return; }
    const doc = tab.document;
    doc.title = `Hoja Flex con localidades · ${flex.length} envíos`;
    const style = doc.createElement("style");
    style.textContent = "@page{size:A4;margin:16mm}body{font:11px Arial,sans-serif;color:#111}h1{font-size:17px;margin:0 0 8px}p{margin:0 0 14px;color:#555}table{width:100%;border-collapse:collapse}th{background:#999;color:white;text-align:left}th,td{border-bottom:1px solid #bbb;padding:8px 6px;vertical-align:top}td strong{display:block;margin-bottom:3px}small{display:block;color:#555;margin-top:3px}.check{font-size:17px}";
    doc.head.append(style);
    const heading = doc.createElement("h1"); heading.textContent = `Hoja de control Flex · ${flex.length} envíos`; doc.body.append(heading);
    const note = doc.createElement("p"); note.textContent = "Control ADARA con localidad del destino. La hoja oficial de Mercado Libre sigue disponible por separado."; doc.body.append(note);
    const table = doc.createElement("table");
    const header = doc.createElement("tr"); ["Identificación", "Localidad", "Productos"].forEach((value) => { const th = doc.createElement("th"); th.textContent = value; header.append(th); }); table.append(header);
    for (const shipment of flex) {
      const row = doc.createElement("tr");
      const identification = doc.createElement("td");
      const shipmentId = doc.createElement("strong"); shipmentId.textContent = shipment.id; identification.append(shipmentId);
      const details = doc.createElement("small"); details.textContent = `Venta: ${shipment.orderIds.join(", ")} · ${shipment.buyer}`; identification.append(details); row.append(identification);
      const locality = doc.createElement("td"); locality.textContent = [shipment.locality || "Sin localidad informada", shipment.province].filter(Boolean).join(", "); row.append(locality);
      const products = doc.createElement("td"); shipment.items.forEach((item) => { const line = doc.createElement("div"); line.className = "check"; line.textContent = `☐ ${item.title}`; products.append(line); const detail = doc.createElement("small"); detail.textContent = `SKU: ${item.sku || "Sin SKU"} · Cantidad: ${item.quantity}`; products.append(detail); }); row.append(products);
      table.append(row);
    }
    doc.body.append(table);
    tab.setTimeout(() => tab.print(), 300);
  }

  return <main className="container wide logistics-page logistics-ml-board">
    <header className="logistics-header"><div><h1>Logística Mercado Libre</h1><p>Solo envíos con despacho {day === "today" ? "hoy" : "mañana"}, según la fecha límite informada por Mercado Libre.</p></div><button className="button" type="button" onClick={() => loadBoard(day)} disabled={loading}><RefreshCw size={16} /> {loading ? "Actualizando..." : "Actualizar"}</button></header>
    <div className="logistics-main-tabs" role="tablist" aria-label="Secciones de logística"><button type="button" role="tab" aria-selected={tab === "sales"} className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}>Ventas</button><button type="button" role="tab" aria-selected={tab === "batches"} className={tab === "batches" ? "active" : ""} onClick={() => setTab("batches")}>Lotes</button><button type="button" role="tab" aria-selected={tab === "summary"} className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>Resumen</button></div>
    {tab === "batches" ? <LogisticsBatches refreshKey={batchRefresh} /> : tab === "summary" ? <LogisticsSummary /> : <>
    {pendingPrinted.length > 0 && <div className="logistics-confirm-print"><strong>Se enviaron {pendingPrinted.length} etiquetas a la Zebra.</strong><span>Confirmá que todas salieron bien para crear el lote. Si hubo un problema, reimprimí la misma tanda antes de confirmar.</span><button className="button ghost" type="button" onClick={() => void printLabels(pendingPrinted.map((item) => item.id), "zebra")} disabled={printing}>Reimprimir tanda</button><button className="button" type="button" onClick={() => void confirmPrinted()} disabled={printing}>Sí, salieron bien · crear lote</button></div>}
    <div className="logistics-day-tabs" role="tablist" aria-label="Día de despacho"><button type="button" role="tab" aria-selected={day === "today"} className={day === "today" ? "active" : ""} onClick={() => selectDay("today")}>Envíos de hoy</button><button type="button" role="tab" aria-selected={day === "tomorrow"} className={day === "tomorrow" ? "active" : ""} onClick={() => selectDay("tomorrow")}>Mañana</button></div>
    <div className="logistics-summary">
      {([{ key: "self_service", name: "Flex", counts: counts.flex }, { key: "cross_docking", name: "Colecta", counts: counts.collection }] as const).map((group) => <div className="logistics-summary-card" key={group.key}><strong>{group.name} | {day === "today" ? "Hoy" : "Mañana"}</strong><button type="button" className={mode === group.key && statusFilter === "ready_to_print" ? "active" : ""} onClick={() => selectView(group.key, "ready_to_print")}>Etiquetas por imprimir <b>{group.counts.unprinted}</b></button><button type="button" className={mode === group.key && statusFilter === "printed" ? "active" : ""} onClick={() => selectView(group.key, "printed")}>Listas para despachar <b>{group.counts.printed}</b></button></div>)}
      <button className={`logistics-summary-all ${mode === "all" && statusFilter === "all" ? "active" : ""}`} type="button" onClick={() => selectView("all", "all")}>Ver todos <b>{shipments.length}</b></button>
    </div>
    <div className="logistics-status-line">{checkedAt ? `Actualizado ${dateLabel(checkedAt)} · ${shipments.length} envíos para ${day === "today" ? "hoy" : "mañana"}` : "Consultando envíos..."}{loading ? " · Actualizando" : ""}</div>
    {incomplete && <div className="message info">Mercado Libre no respondió el estado de algunos envíos. Reintentá actualizar; la lista puede estar incompleta.</div>}
    {message && <div className="message info" role="status">{message}</div>}
    <div className="logistics-toolbar"><label className="logistics-search"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); setSelected([]); }} placeholder="Buscar pedido, envío, cliente, SKU o producto" /></label><div className="logistics-actions"><button className="button ghost" type="button" onClick={() => printLabels(selectedLabelIds, "zebra")} disabled={!selectedLabelIds.length || printing}><Printer size={16} /> {reprintView ? "Reimprimir" : "Imprimir"} seleccionadas ({selectedLabelIds.length})</button><button className="button ghost" type="button" onClick={() => printLabels(labelIdsOnPage, "zebra")} disabled={!labelIdsOnPage.length || printing}><Printer size={16} /> {reprintView ? "Reimprimir" : "Imprimir"} página ({labelIdsOnPage.length})</button><button className="button ghost" type="button" onClick={() => void createBatchFromPrinted()} disabled={!selectedPrintedOnPage.length || printing}>Crear lote de impresas ({selectedPrintedOnPage.length})</button><button className="button ghost" type="button" onClick={() => printFlexControl(flexControlItems)} disabled={!flexControlItems.length || printing}><ClipboardList size={16} /> Hoja Flex + localidad</button><button className="button ghost" type="button" onClick={() => printLabels(selectedLabelIds.length ? selectedLabelIds : labelIdsOnPage, "control")} disabled={!labelIdsOnPage.length || printing}><ClipboardList size={16} /> Hoja de control ML</button><button className="button ghost" type="button" onClick={() => printPickList(pageItems)} disabled={!pageItems.length}><ClipboardList size={16} /> Hoja de preparación</button><button className="button ghost" type="button" onClick={() => printLabels(selectedLabelIds.length ? selectedLabelIds : labelIdsOnPage, "zpl")} disabled={!labelIdsOnPage.length || printing}><Download size={16} /> Descargar ZPL</button></div></div>
    <div className="logistics-select-row"><label><input type="checkbox" checked={selectableIds.length > 0 && selectedSelectable.length === selectableIds.length} onChange={() => setSelected(selectedSelectable.length === selectableIds.length ? [] : selectableIds)} disabled={!selectableIds.length} /> {statusFilter === "printed" ? "Seleccionar listas para despachar" : "Seleccionar etiquetas por imprimir"} de esta página ({selectableIds.length})</label><span>Máximo 50 por lote</span></div>
    <div className="logistics-list">{pageItems.map((shipment) => <article className="logistics-order logistics-ml-order" key={shipment.id}>
      <div className="logistics-ml-order-top"><label><input type="checkbox" checked={selected.includes(shipment.id)} onChange={() => toggle(shipment.id)} disabled={shipment.status === "other"} /> <strong>#{shipment.orderIds.join(", ")}</strong></label><span>{shipment.orderDate ? dateLabel(shipment.orderDate) : ""}</span><span className="logistics-ml-buyer">{shipment.buyer}</span><span>{modeLabel(shipment.mode)}</span></div>
      <div className="logistics-ml-order-body"><div><strong className={shipment.status === "ready_to_print" ? "unprinted" : "printed"}>{shipment.status === "ready_to_print" ? "Etiqueta lista para imprimir" : shipment.status === "printed" ? "Lista para despachar" : "Verificar estado en Mercado Libre"}</strong><small>{shipment.mode === "cross_docking" ? "Prepará el paquete para la colecta." : "Prepará el paquete para Flex."} Despacho límite: {dateLabel(shipment.dispatchAt)}</small></div>{shipment.status !== "other" && <button className="button" type="button" onClick={() => printLabels([shipment.id], "zebra")} disabled={printing}><Printer size={15} /> {shipment.status === "printed" ? "Reimprimir etiqueta" : "Imprimir etiqueta"}</button>}</div>
      <div className="logistics-ml-products">{shipment.items.map((item, index) => <div key={`${item.orderId}-${item.itemId}-${index}`}><div className="logistics-ml-thumb">{item.image ? <img src={item.image} alt="" /> : <span>📦</span>}</div><span className="logistics-ml-product-name">{item.title}<small>SKU: {item.sku || "Sin SKU"}</small></span><span>{money(item.unitPrice)}</span><span>{item.quantity} {item.quantity === 1 ? "unidad" : "unidades"}</span></div>)}</div>
    </article>)}{!pageItems.length && !loading && <div className="empty-state">{incomplete ? "No se pudo confirmar que no haya envíos. Reintentá actualizar." : `No hay envíos ${day === "today" ? "para hoy" : "para mañana"} con este filtro.`}</div>}</div>
    <PricingPagination page={currentPage} total={filtered.length} size={PAGE_SIZE} onPage={(next) => { setPage(next); setSelected([]); }} />
    </>}
  </main>;
}
