import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireApiUser } from "@/lib/serverAuth";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, meliFetch, refreshAccessToken } from "@/lib/mercadolibre";

export const runtime = "nodejs";
export const maxDuration = 60;

type Item = { sku: string; title: string; quantity: number };
type Shipment = { id: string; orderIds: string[]; buyer: string; items: Item[] };
type Batch = { id: string; status: string; mode: string; dispatch_day: string; shipments: Shipment[] };

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function orderSummary(batch: Batch) {
  const rows = batch.shipments.flatMap((shipment) => shipment.items.map((item) =>
    `<tr><td>${escapeHtml(shipment.id)}</td><td>${escapeHtml(shipment.orderIds.join(", "))}</td><td>${escapeHtml(shipment.buyer)}</td><td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.quantity)}</td></tr>`)).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Resumen de pedidos · lote ${escapeHtml(batch.id)}</title><style>body{font:13px Arial,sans-serif;margin:25mm;color:#111}h1{font-size:22px}p{line-height:1.5}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:7px;border:1px solid #aaa;text-align:left;vertical-align:top}th{background:#eee}@media print{body{margin:12mm}}</style></head><body><h1>Resumen de pedidos</h1><p>Lote: ${escapeHtml(batch.id)}<br>Modalidad: ${batch.mode === "self_service" ? "Flex" : "Colecta"}<br>Despacho: ${escapeHtml(batch.dispatch_day)}<br>Envíos verificados: ${batch.shipments.length}</p><table><thead><tr><th>Envío</th><th>Venta</th><th>Cliente</th><th>SKU</th><th>Producto</th><th>Cantidad</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function adaraControl(batch: Batch) {
  const rows = batch.shipments.flatMap((shipment) => shipment.items.map((item) =>
    `<tr><td>☐</td><td><strong>${escapeHtml(shipment.id)}</strong><br>Venta: ${escapeHtml(shipment.orderIds.join(", "))}<br>${escapeHtml(shipment.buyer)}</td><td>${escapeHtml(item.title)}<br>SKU: ${escapeHtml(item.sku)} · Cantidad: ${escapeHtml(item.quantity)}</td></tr>`)).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Control ADARA · lote ${escapeHtml(batch.id)}</title><style>body{font:12px Arial,sans-serif;margin:20mm;color:#111}h1{font-size:20px}p{line-height:1.5}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:8px;border-bottom:1px solid #bbb;text-align:left;vertical-align:top}th{background:#ddd}@media print{body{margin:12mm}}</style></head><body><h1>Hoja de control ADARA</h1><p>No es la hoja oficial de Mercado Libre. Mercado Libre ya no permite descargarla cuando los envíos figuran como despachados.<br>Lote: ${escapeHtml(batch.id)} · Despacho: ${escapeHtml(batch.dispatch_day)} · ${batch.shipments.length} envíos</p><table><thead><tr><th>✓</th><th>Identificación</th><th>Producto</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    await requireApiUser(request);
    const body = await request.json() as { batchId?: string };
    if (!/^[0-9a-f-]{36}$/i.test(body.batchId || "")) return NextResponse.json({ error: "Lote inválido." }, { status: 400 });
    const { data, error } = await createAdminClient().from("logistics_batches").select("id,status,mode,dispatch_day,shipments").eq("id", body.batchId).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "No se encontró el lote." }, { status: 404 });
    const batch = data as Batch;
    if (batch.status !== "completed") return NextResponse.json({ error: "Primero completá la verificación del lote." }, { status: 409 });
    const ids = batch.shipments.map((shipment) => shipment.id);
    if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.some((id) => !/^\d{5,25}$/.test(id))) {
      return NextResponse.json({ error: "Los envíos del lote no son válidos." }, { status: 409 });
    }
    const connected = await getConnectedMeliAccount();
    if (!connected) return NextResponse.json({ error: "No hay una cuenta de Mercado Libre conectada." }, { status: 400 });
    const account = await refreshAccessToken(connected);
    for (let index = 0; index < ids.length; index += 10) {
      const shipments = await Promise.all(ids.slice(index, index + 10).map((id) => meliFetch(`/shipments/${id}`, account, { headers: { "x-format-new": "true" } }) as Promise<{ sender_id?: string | number; origin?: { sender_id?: string | number } }>));
      if (shipments.some((shipment) => String(shipment.sender_id || shipment.origin?.sender_id || "") !== String(account.meli_user_id))) {
        return NextResponse.json({ error: "Un envío no pertenece a la cuenta conectada." }, { status: 403 });
      }
    }
    const params = new URLSearchParams({ shipment_ids: ids.join(","), response_type: "zpl2" });
    const response = await fetch(`https://api.mercadolibre.com/shipment_labels?${params}`, {
      headers: { Authorization: `Bearer ${account.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(60000),
    });
    const archive = new JSZip();
    let officialControl = false;
    if (response.ok) {
      const raw = Buffer.from(await response.arrayBuffer());
      if (raw.subarray(0, 2).toString() === "PK") {
        const source = await JSZip.loadAsync(raw);
        const control = Object.values(source.files).find((file) => !file.dir && /\.pdf$/i.test(file.name));
        if (control) {
          archive.file("control-mercado-libre.pdf", await control.async("uint8array"));
          officialControl = true;
        }
      }
    } else {
      const detail = await response.json().catch(() => null) as { failed_shipments?: Array<{ cause?: string }> } | null;
      const notPrintable = response.status === 400 && detail?.failed_shipments?.length === ids.length &&
        detail.failed_shipments.every((shipment) => shipment.cause === "NOT_PRINTABLE_STATUS");
      if (!notPrintable) return NextResponse.json({ error: `Mercado Libre no pudo generar la hoja de control (${response.status}).` }, { status: 502 });
    }
    if (!officialControl) archive.file("control-adara.html", adaraControl(batch));
    archive.file("resumen-pedidos.html", orderSummary(batch));
    const zip = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return new NextResponse(Uint8Array.from(zip).buffer, { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="documentacion-${batch.mode === "self_service" ? "flex" : "colecta"}-${batch.dispatch_day}-${batch.id.slice(0, 8)}.zip"`,
      "X-Control-Source": officialControl ? "mercado-libre" : "adara",
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo descargar la documentación.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
