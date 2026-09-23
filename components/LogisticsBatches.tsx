"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const batch = batches.find((item) => item.id === activeId);
  const products = useMemo(() => batch ? totals(batch.shipments) : [], [batch]);
  const selectedShipment = batch?.shipments.find((item) => item.id === shipmentId);
  const stagedComplete = products.length > 0 && products.every((item) => (batch?.staged[item.sku] || 0) >= item.quantity);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const response = await fetch("/api/mercadolibre/logistics-batches", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
    const result = await response.json();
    if (response.ok) setBatches(result.batches || []);
    else setMessage(result.error || "No se pudieron cargar los lotes.");
  }, [supabase]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function action(name: string, code?: string, sku?: string) {
    if (!batch || busy) return;
    setBusy(true); setMessage("");
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
      if (name === "assign_ean") { setUnknownEan(""); setAssignSku(""); setMessage(`EAN ${code} asignado a ${sku}. Volvé a escanearlo para registrar la unidad.`); }
      else if (name === "stage" || name === "pack") setMessage(name === "stage" ? "Producto correcto ✓" : "Producto correcto para esta etiqueta ✓");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error al escanear."); }
    finally { setBusy(false); scanRef.current?.focus(); }
  }

  return <section className="logistics-batches">
    <div className="logistics-batch-head"><div><h2>Lotes de empaquetado</h2><p>Cada tanda impresa y confirmada queda separada. Los envíos nuevos generan otro lote.</p></div><button className="button ghost" onClick={() => void load()} type="button">Actualizar lotes</button></div>
    {message && <div className="message info" role="status">{message}</div>}
    <div className="logistics-batch-layout">
      <div className="logistics-batch-list">{batches.map((item) => <button key={item.id} type="button" className={`logistics-batch-card ${activeId === item.id ? "active" : ""}`} onClick={() => { setActiveId(item.id); setShipmentId(null); setMessage(""); }}><strong>{item.mode === "self_service" ? "Flex" : "Colecta"} · {item.shipments.length} {item.shipments.length === 1 ? "envío" : "envíos"}</strong><span>{statusLabel[item.status]}</span><small>Despacho {item.dispatch_day} · creado {new Date(item.created_at).toLocaleString("es-AR")}</small></button>)}{!batches.length && <p>Todavía no hay lotes. Imprimí etiquetas en Ventas y confirmá la tanda.</p>}</div>
      {batch && <div className="logistics-batch-work"><h3>{batch.mode === "self_service" ? "Flex" : "Colecta"} · {batch.shipments.length} envíos</h3><p>Estado: {statusLabel[batch.status]}</p>
        {batch.status === "printed" && <button className="button" onClick={() => void action("start")} disabled={busy}>Comenzar preparación</button>}
        {batch.status === "collecting" && <><h4>Paso 1 · Verificar productos traídos del depósito</h4><p>Escaneá el EAN de cada unidad. El sistema marca faltantes y rechaza productos que no pertenecen al lote.</p>
          <form onSubmit={(event) => { event.preventDefault(); void action("stage", scan.trim()); }}><input ref={scanRef} autoFocus value={scan} onChange={(event) => setScan(event.target.value)} placeholder="Escanear EAN y Enter" aria-label="EAN del producto" /><button className="button" disabled={!scan.trim() || busy}>Verificar</button></form>
          <div className="logistics-batch-products">{products.map((item) => <div key={item.sku}><span>{item.image && <img src={item.image} alt="" />}<b>{item.sku}</b> · {item.title}</span><strong>{batch.staged[item.sku] || 0} / {item.quantity}</strong></div>)}</div>
          <button className="button" disabled={!stagedComplete || busy} onClick={() => void action("packing")}>Pasar al paso 2 · Empaquetar</button></>}
        {batch.status === "packing" && <><h4>Paso 2 · Etiqueta y producto de cada bolsa</h4><p>Escaneá la etiqueta de ML; luego cada EAN que va en ese paquete.</p>
          <form onSubmit={(event) => { event.preventDefault(); const match = matchLabel(labelScan, batch.shipments); if (!match) setMessage("Ese QR no corresponde a un envío de este lote. No empaquetes esta venta."); else { setShipmentId(match.id); setLabelScan(""); setMessage(`Etiqueta ${match.id} reconocida.`); } }}><input value={labelScan} onChange={(event) => setLabelScan(event.target.value)} placeholder="Escanear QR o número de envío" aria-label="Etiqueta de Mercado Libre" /><button className="button" disabled={!labelScan.trim()}>Elegir etiqueta</button></form>
          {selectedShipment && <div className="logistics-batch-selected"><h4>Envío #{selectedShipment.id} · {selectedShipment.buyer}</h4>{selectedShipment.items.map((item, index) => <div key={`${item.sku}-${index}`}>{item.image && <img src={item.image} alt="" />}<span><b>{item.sku}</b> · {item.title}</span><strong>{batch.packed[selectedShipment.id]?.[item.sku] || 0} / {item.quantity}</strong></div>)}<form onSubmit={(event) => { event.preventDefault(); void action("pack", scan.trim()); }}><input ref={scanRef} autoFocus value={scan} onChange={(event) => setScan(event.target.value)} placeholder="Escanear EAN del producto para esta bolsa" aria-label="EAN para empaquetar" /><button className="button" disabled={!scan.trim() || busy}>Verificar y guardar</button></form></div>}
          <p>Paquetes completos: {batch.shipments.filter((shipment) => totals([shipment]).every((item) => (batch.packed[shipment.id]?.[item.sku] || 0) >= item.quantity)).length} / {batch.shipments.length}</p></>}
        {batch.status === "completed" && <p>Todos los paquetes fueron verificados. Listos para despachar.</p>}
        {unknownEan && <div className="logistics-ean-dialog" role="dialog" aria-label="Asignar EAN desconocido"><h4>EAN {unknownEan} no registrado</h4><p>Asignalo a un SKU existente de este lote. Un SKU puede tener varios EAN.</p><select value={assignSku} onChange={(event) => setAssignSku(event.target.value)}><option value="">Elegir SKU</option>{products.map((item) => <option key={item.sku} value={item.sku}>{item.sku} · {item.title}</option>)}</select><button className="button" disabled={!assignSku || busy} onClick={() => void action("assign_ean", unknownEan, assignSku)}>Guardar EAN</button><button className="button ghost" onClick={() => setUnknownEan("")}>Cancelar</button></div>}
      </div>}
    </div>
  </section>;
}
