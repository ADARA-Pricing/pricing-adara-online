"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, PackageCheck, ScanBarcode } from "lucide-react";
import { createClient } from "@/lib/supabase";

type Item = { sku: string; title: string; image?: string | null; quantity: number };
type Shipment = { id: string; orderIds: string[]; buyer: string; items: Item[] };
type Batch = { id: string; mode: "cross_docking" | "self_service"; dispatch_day: string; status: "printed" | "collecting" | "packing" | "completed"; created_at: string; shipments: Shipment[]; staged: Record<string, number>; packed: Record<string, Record<string, number>> };
const statusLabel = { printed: "Pendiente de preparación", collecting: "Verificando productos", packing: "Empaquetando", completed: "Completado" };

function totals(shipments: Shipment[]) {
  const map = new Map<string, { sku: string; title: string; quantity: number; image: string | null }>();
  shipments.forEach((shipment) => shipment.items.forEach((item) => {
    const current = map.get(item.sku) || { sku: item.sku, title: item.title, quantity: 0, image: item.image || null };
    current.quantity += item.quantity;
    map.set(item.sku, current);
  }));
  return [...map.values()];
}

function shipmentComplete(shipment: Shipment, packed: Record<string, Record<string, number>>) {
  return totals([shipment]).every((item) => (packed[shipment.id]?.[item.sku] || 0) >= item.quantity);
}

function matchLabel(code: string, shipments: Shipment[]) {
  const trimmed = code.trim().replace(/^LA,/, "");
  try {
    const parsed = JSON.parse(trimmed) as { id?: unknown };
    if (typeof parsed.id === "string" || typeof parsed.id === "number") {
      const shipment = shipments.find((item) => item.id === String(parsed.id));
      if (shipment) return shipment;
    }
  } catch { /* Algunas etiquetas o lectores entregan sólo el número. */ }
  const exact = shipments.find((shipment) => shipment.id === trimmed || shipment.orderIds.includes(trimmed));
  if (exact) return exact;
  const embedded = shipments.filter((shipment) => new RegExp(`(^|\\D)${shipment.id}(\\D|$)`).test(trimmed));
  return embedded.length === 1 ? embedded[0] : null;
}

export function LogisticsBatches({ refreshKey }: { refreshKey: number }) {
  const supabase = createClient();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [labelScan, setLabelScan] = useState("");
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [unknownEan, setUnknownEan] = useState("");
  const [assignSku, setAssignSku] = useState("");
  const [message, setMessage] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error" | "info">("info");
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const batch = batches.find((item) => item.id === activeId);
  const products = useMemo(() => batch ? totals(batch.shipments) : [], [batch]);
  const selectedShipment = batch?.shipments.find((item) => item.id === shipmentId);
  const stagedComplete = products.length > 0 && products.every((item) => (batch?.staged[item.sku] || 0) >= item.quantity);
  useEffect(() => { if (batch?.status === "packing" && !shipmentId) labelRef.current?.focus(); }, [activeId, batch?.status, shipmentId]);
  useEffect(() => {
    if (!message || feedbackTone === "info") return;
    const timeout = window.setTimeout(() => setMessage(""), 3800);
    return () => window.clearTimeout(timeout);
  }, [message, feedbackTone]);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const response = await fetch("/api/mercadolibre/logistics-batches", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
    const result = await response.json();
    if (response.ok) setBatches(result.batches || []);
    else { setFeedbackTone("error"); setMessage(result.error || "No se pudieron cargar los lotes."); }
  }, [supabase]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function action(name: string, code?: string, sku?: string) {
    if (!batch || busy) return;
    setBusy(true); setMessage(""); setFeedbackTone("info");
    let focusNextLabel = false;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesión vencida.");
      const response = await fetch("/api/mercadolibre/logistics-batches", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ batchId: batch.id, action: name, code, sku, shipmentId }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.unknownEan) setUnknownEan(result.unknownEan);
        throw new Error(result.error || "No se pudo registrar el escaneo.");
      }
      setBatches((current) => current.map((item) => item.id === batch.id ? result.batch : item));
      setScan("");
      if (name === "assign_ean") { setUnknownEan(""); setAssignSku(""); setFeedbackTone("success"); setMessage(`EAN ${code} asignado a ${sku}. Volvé a escanearlo para registrar la unidad.`); }
      else if (name === "pack" && shipmentId) {
        const updated = result.batch as Batch;
        const shipment = updated.shipments.find((item) => item.id === shipmentId);
        if (shipment && shipmentComplete(shipment, updated.packed)) {
          setShipmentId(null);
          setLabelScan("");
          focusNextLabel = true;
          const remaining = updated.shipments.filter((item) => !shipmentComplete(item, updated.packed)).length;
          setFeedbackTone("success"); setMessage(remaining ? `Paquete correcto y completo. Quedan ${remaining}: escaneá el QR del siguiente.` : "Todos los paquetes están completos.");
        } else { setFeedbackTone("success"); setMessage("Producto correcto. Escaneá la siguiente unidad de esta misma etiqueta."); }
      } else if (name === "stage") { setFeedbackTone("success"); setMessage("Producto correcto. Unidad registrada en el lote."); }
    } catch (error) { setScan(""); setFeedbackTone("error"); setMessage(error instanceof Error ? error.message : "Error al escanear."); }
    finally {
      setBusy(false);
      window.setTimeout(() => (focusNextLabel ? labelRef.current : scanRef.current)?.focus(), 0);
    }
  }

  async function downloadDocumentation() {
    if (!batch || busy) return;
    setBusy(true); setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesión vencida.");
      const response = await fetch("/api/mercadolibre/logistics-batches/documentation", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ batchId: batch.id }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "No se pudo descargar la documentación.");
      }
      const officialControl = response.headers.get("X-Control-Source") === "mercado-libre";
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `documentacion-${batch.mode === "self_service" ? "flex" : "colecta"}-${batch.dispatch_day}-${batch.id.slice(0, 8)}.zip`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(officialControl ? "Documentación descargada: hoja de control de Mercado Libre y resumen de pedidos." : "Documentación descargada: Mercado Libre ya no permite generar la hoja oficial de envíos despachados. El ZIP incluye un control ADARA y el resumen de pedidos.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo descargar la documentación."); }
    finally { setBusy(false); }
  }

  function printPreparation() {
    if (!batch) return;
    const tab = window.open("", "_blank");
    if (!tab) { setMessage("Permití las ventanas emergentes para imprimir la hoja de preparación."); return; }
    const doc = tab.document;
    doc.title = `Preparación de ${batch.shipments.length} envíos`;
    const style = doc.createElement("style");
    style.textContent = "body{font:12px Arial,sans-serif;margin:18mm;color:#111}h1{font-size:20px}h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%;margin:10px 0 20px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}";
    doc.head.append(style);
    const heading = doc.createElement("h1"); heading.textContent = `Hoja de preparación · ${batch.shipments.length} envíos`; doc.body.append(heading);
    const subtitle = doc.createElement("h2"); subtitle.textContent = "Buscar en depósito · total por producto"; doc.body.append(subtitle);
    const table = doc.createElement("table");
    const header = doc.createElement("tr"); ["✓", "SKU", "Producto", "Cantidad"].forEach((text) => { const cell = doc.createElement("th"); cell.textContent = text; header.append(cell); }); table.append(header);
    for (const item of totals(batch.shipments).sort((a, b) => a.sku.localeCompare(b.sku))) {
      const row = doc.createElement("tr"); ["☐", item.sku, item.title, String(item.quantity)].forEach((text) => { const cell = doc.createElement("td"); cell.textContent = text; row.append(cell); }); table.append(row);
    }
    doc.body.append(table);
    tab.setTimeout(() => tab.print(), 300);
  }

  async function downloadControl() {
    if (!batch || busy) return;
    setBusy(true); setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesión vencida.");
      const response = await fetch("/api/mercadolibre/shipment-labels", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ shipmentIds: batch.shipments.map((shipment) => shipment.id), format: "control" }),
      });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "No se pudo descargar la hoja de control de Mercado Libre."); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `hoja-control-ml-${batch.dispatch_day}.pdf`; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage("Hoja de control de Mercado Libre descargada.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo descargar la hoja de control."); }
    finally { setBusy(false); }
  }

  async function downloadZpl() {
    if (!batch || busy) return;
    setBusy(true); setMessage(""); setFeedbackTone("info");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesión vencida.");
      const response = await fetch("/api/mercadolibre/shipment-labels", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ shipmentIds: batch.shipments.map((shipment) => shipment.id), format: "zpl" }),
      });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "Mercado Libre no pudo volver a generar las etiquetas ZPL."); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `etiquetas-${batch.mode === "self_service" ? "flex" : "colecta"}-${batch.dispatch_day}.zpl`; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage("Etiquetas ZPL descargadas.");
    } catch (error) { setFeedbackTone("error"); setMessage(error instanceof Error ? error.message : "No se pudieron descargar las etiquetas ZPL."); }
    finally { setBusy(false); }
  }

  return <section className="logistics-batches">
    <div className="logistics-batch-head"><div><h2>Lotes de empaquetado</h2><p>Cada tanda impresa y confirmada queda separada. Los envíos nuevos generan otro lote.</p></div><button className="button ghost" onClick={() => void load()} type="button">Actualizar lotes</button></div>
    {message && <div className={`logistics-scan-feedback ${feedbackTone}`} role="status">{feedbackTone === "success" ? <CheckCircle2 /> : feedbackTone === "error" ? <AlertTriangle /> : <ScanBarcode />}<span>{message}</span></div>}
    {message && feedbackTone !== "info" && <div className={`logistics-scan-popup ${feedbackTone}`} role="alert">{feedbackTone === "success" ? <CheckCircle2 /> : <AlertTriangle />}<div><strong>{feedbackTone === "success" ? "¡CORRECTO!" : "ATENCIÓN"}</strong><span>{message}</span></div></div>}
    <div className="logistics-batch-layout">
      <div className="logistics-batch-list">{batches.map((item) => <button key={item.id} type="button" className={`logistics-batch-card ${activeId === item.id ? "active" : ""}`} onClick={() => { setActiveId(item.id); setShipmentId(null); setMessage(""); }}><strong>{item.mode === "self_service" ? "Flex" : "Colecta"} · {item.shipments.length} {item.shipments.length === 1 ? "envío" : "envíos"}</strong><span>{statusLabel[item.status]}</span><small>Despacho {item.dispatch_day} · creado {new Date(item.created_at).toLocaleString("es-AR")}</small></button>)}{!batches.length && <p>Todavía no hay lotes. Imprimí etiquetas en Ventas y confirmá la tanda.</p>}</div>
      {batch && <div className="logistics-batch-work"><h3>{batch.mode === "self_service" ? "Flex" : "Colecta"} · {batch.shipments.length} envíos</h3><p>Estado: {statusLabel[batch.status]}</p>
        <div className="logistics-batch-actions">
          {batch.status === "printed" && <button className="button" type="button" onClick={() => void action("start")} disabled={busy}>Comenzar preparación</button>}
          <button className="button ghost" type="button" onClick={printPreparation} disabled={busy}>Reimprimir hoja de preparación</button>
          <button className="button ghost" type="button" onClick={() => void downloadZpl()} disabled={busy}>Descargar etiquetas ZPL</button>
          <button className="button ghost" type="button" onClick={() => void downloadControl()} disabled={busy}>Descargar hoja de control ML</button>
        </div>
        {batch.status === "collecting" && <><h4>Paso 1 · Verificar productos traídos del depósito</h4><p>Escaneá el EAN de cada unidad. El sistema marca faltantes y rechaza productos que no pertenecen al lote.</p>
          <form onSubmit={(event) => { event.preventDefault(); void action("stage", scan.trim()); }}><input ref={scanRef} autoFocus value={scan} onChange={(event) => setScan(event.target.value)} placeholder="Escanear EAN y Enter" aria-label="EAN del producto" /><button className="button" disabled={!scan.trim() || busy}>Verificar</button></form>
          <div className="logistics-batch-products">{products.map((item) => <div key={item.sku}><span>{item.image && <img src={item.image} alt="" />}<b>{item.sku}</b> · {item.title}</span><strong>{batch.staged[item.sku] || 0} / {item.quantity}</strong></div>)}</div>
          <button className="button" disabled={!stagedComplete || busy} onClick={() => void action("packing")}>Pasar al paso 2 · Empaquetar</button></>}
        {batch.status === "packing" && <><h4>Paso 2 · Etiqueta y producto de cada bolsa</h4><p>Primero escaneá la etiqueta. La tarjeta azul muestra exactamente qué producto va dentro.</p>
          <form onSubmit={(event) => { event.preventDefault(); const match = matchLabel(labelScan, batch.shipments); setLabelScan(""); if (!match) { setFeedbackTone("error"); setMessage("ETIQUETA INCORRECTA: no pertenece a este lote. No empaquetes este pedido."); labelRef.current?.focus(); } else if (shipmentComplete(match, batch.packed)) { setShipmentId(null); setFeedbackTone("error"); setMessage(`La etiqueta ${match.id} ya está completa. Escaneá otra etiqueta.`); labelRef.current?.focus(); } else { setShipmentId(match.id); setFeedbackTone("success"); setMessage(`Etiqueta ${match.id} reconocida. Escaneá únicamente el producto que figura abajo.`); window.setTimeout(() => scanRef.current?.focus(), 0); } }}><input ref={labelRef} value={labelScan} onChange={(event) => setLabelScan(event.target.value)} placeholder="1. Escaneá QR o número de etiqueta" aria-label="Etiqueta de Mercado Libre" /><button className="button" disabled={!labelScan.trim()}>Confirmar etiqueta</button></form>
          {selectedShipment && <div className="logistics-batch-selected"><div className="logistics-selected-head"><PackageCheck /><div><span>ETIQUETA CONFIRMADA · ENVÍO #{selectedShipment.id}</span><h4>Producto{selectedShipment.items.length === 1 ? " que va en esta bolsa" : "s que van en esta bolsa"}</h4></div></div>{selectedShipment.items.map((item, index) => <div key={`${item.sku}-${index}`} className="logistics-required-product">{item.image ? <img src={item.image} alt="" /> : <div className="logistics-product-placeholder">📦</div>}<span><b>{item.title}</b><small>SKU: {item.sku}</small></span><strong>{batch.packed[selectedShipment.id]?.[item.sku] || 0} / {item.quantity}</strong></div>)}<form onSubmit={(event) => { event.preventDefault(); void action("pack", scan.trim()); }}><input ref={scanRef} autoFocus value={scan} onChange={(event) => setScan(event.target.value)} placeholder="2. Escaneá el EAN del producto mostrado arriba" aria-label="EAN para empaquetar" /><button className="button" disabled={!scan.trim() || busy}>Verificar producto</button></form></div>}
          <p>Paquetes completos: {batch.shipments.filter((shipment) => shipmentComplete(shipment, batch.packed)).length} / {batch.shipments.length}</p></>}
        {batch.status === "completed" && <><p>Todos los paquetes fueron verificados. Listos para despachar.</p><button className="button" type="button" onClick={() => void downloadDocumentation()} disabled={busy}>{busy ? "Preparando documentación..." : "Descargar documentación"}</button><p>Incluye el resumen de pedidos y la hoja oficial de Mercado Libre si aún está disponible; si no, un control ADARA.</p></>}
        {unknownEan && <div className="logistics-ean-dialog" role="dialog" aria-label="Asignar EAN desconocido"><h4>EAN {unknownEan} no registrado</h4><p>Asignalo a un SKU existente de este lote. Un SKU puede tener varios EAN.</p><select value={assignSku} onChange={(event) => setAssignSku(event.target.value)}><option value="">Elegir SKU</option>{products.map((item) => <option key={item.sku} value={item.sku}>{item.sku} · {item.title}</option>)}</select><button className="button" disabled={!assignSku || busy} onClick={() => void action("assign_ean", unknownEan, assignSku)}>Guardar EAN</button><button className="button ghost" onClick={() => setUnknownEan("")}>Cancelar</button></div>}
      </div>}
    </div>
  </section>;
}
