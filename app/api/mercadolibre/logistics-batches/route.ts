import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/serverAuth";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, refreshAccessToken } from "@/lib/mercadolibre";
import { controlPath, fetchOfficialControl, LOGISTICS_CONTROLS_BUCKET } from "@/lib/logisticsControlArchive";

export const runtime = "nodejs";

type Item = { sku: string; quantity: number; title: string; image?: string | null };
type Shipment = { id: string; mode: "cross_docking" | "self_service"; dispatchAt: string; orderIds: string[]; buyer: string; items: Item[] };
type Batch = { id: string; status: "printed" | "collecting" | "packing" | "completed"; shipments: Shipment[]; staged: Record<string, number>; packed: Record<string, Record<string, number>> };

function argentinaDayKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo actualizar el lote.";
  return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
}

function required(shipments: Shipment[]) {
  const result: Record<string, number> = {};
  for (const shipment of shipments) for (const item of shipment.items) {
    if (item.sku && item.quantity > 0) result[item.sku] = (result[item.sku] || 0) + item.quantity;
  }
  return result;
}

function complete(actual: Record<string, number>, expected: Record<string, number>) {
  return Object.entries(expected).every(([sku, quantity]) => (actual[sku] || 0) >= quantity);
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    const { data, error } = await createAdminClient().from("logistics_batches").select("*").eq("dispatch_day", argentinaDayKey()).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ batches: data || [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { shipments?: Shipment[] };
    const shipments = body.shipments || [];
    if (!Array.isArray(shipments) || !shipments.length || shipments.length > 50 ||
      shipments.some((shipment) => !/^\d{5,25}$/.test(shipment.id) || !Array.isArray(shipment.items) || !shipment.items.length ||
        shipment.items.some((item) => !item.sku || !Number.isSafeInteger(item.quantity) || item.quantity < 1)) ||
      new Set(shipments.map((shipment) => shipment.id)).size !== shipments.length ||
      new Set(shipments.map((shipment) => shipment.mode)).size !== 1) {
      return NextResponse.json({ error: "El lote necesita entre 1 y 50 envíos de una misma modalidad, todos con SKU y cantidad válidos." }, { status: 400 });
    }
    const dispatchDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(shipments[0].dispatchAt));
    const admin = createAdminClient();
    const { data: existing, error: existingError } = await admin.from("logistics_batches").select("id,shipments").limit(1000);
    if (existingError) throw existingError;
    const alreadyBatched = new Set((existing || []).flatMap((batch) => (batch.shipments as Shipment[]).map((shipment) => shipment.id)));
    const repeated = shipments.find((shipment) => alreadyBatched.has(shipment.id));
    if (repeated) {
      const existingBatch = (existing || []).find((batch) => (batch.shipments as Shipment[]).some((shipment) => shipment.id === repeated.id));
      const requestedIds = new Set(shipments.map((shipment) => shipment.id));
      const existingIds = new Set(((existingBatch?.shipments || []) as Shipment[]).map((shipment) => shipment.id));
      if (existingBatch && requestedIds.size === existingIds.size && [...requestedIds].every((id) => existingIds.has(id))) {
        return NextResponse.json({ batch: existingBatch, existing: true });
      }
      return NextResponse.json({ error: `El envío ${repeated.id} ya pertenece a otro lote. Abrí ese lote o actualizá la pestaña.` }, { status: 409 });
    }
    const { data, error } = await admin.from("logistics_batches").insert({
      mode: shipments[0].mode, dispatch_day: dispatchDay, shipments,
      created_by: user.id,
    }).select("*").single();
    if (error) throw error;
    let warning: string | undefined;
    try {
      const connected = await getConnectedMeliAccount();
      if (!connected) throw new Error("No hay una cuenta de Mercado Libre conectada.");
      const account = await refreshAccessToken(connected);
      const pdf = await fetchOfficialControl(shipments.map((shipment) => shipment.id), account);
      const { error: uploadError } = await admin.storage.from(LOGISTICS_CONTROLS_BUCKET).upload(controlPath(data.id), pdf, {
        contentType: "application/pdf", upsert: false,
      });
      if (uploadError) throw uploadError;
    } catch (archiveError) {
      warning = `El lote se creó, pero no se pudo guardar la hoja oficial: ${archiveError instanceof Error ? archiveError.message : "error desconocido"}. Descargala desde Ventas mientras Mercado Libre todavía la permita.`;
    }
    return NextResponse.json({ batch: data, warning }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { batchId?: string; action?: string; code?: string; shipmentId?: string; sku?: string };
    if (!/^[0-9a-f-]{36}$/i.test(body.batchId || "")) return NextResponse.json({ error: "Lote inválido." }, { status: 400 });
    const admin = createAdminClient();
    const { data, error } = await admin.from("logistics_batches").select("*").eq("id", body.batchId).single();
    if (error || !data) return NextResponse.json({ error: "No se encontró el lote." }, { status: 404 });
    const batch = data as Batch;
    const expected = required(batch.shipments);
    const code = (body.code || "").trim();
    let update: Record<string, unknown> = {};
    if (body.action === "start" && batch.status === "printed") update = { status: "collecting" };
    else if (body.action === "packing" && batch.status === "collecting") {
      if (!complete(batch.staged, expected)) return NextResponse.json({ error: "Todavía faltan productos por verificar en el paso 1." }, { status: 409 });
      update = { status: "packing" };
    } else if (body.action === "assign_ean") {
      if (!/^[0-9]{8,14}$/.test(code) || !body.sku || !expected[body.sku]) return NextResponse.json({ error: "EAN o SKU inválido para este lote." }, { status: 400 });
      const { data: product } = await admin.from("products").select("sku,ean").eq("sku", body.sku).maybeSingle();
      if (!product) return NextResponse.json({ error: "Ese SKU no existe en Productos." }, { status: 404 });
      const { error: insertError } = await admin.from("product_eans").insert({ ean: code, sku: body.sku, created_by: user.id });
      if (insertError) return NextResponse.json({ error: "Ese EAN ya está asignado o no se pudo guardar. Revisá el producto." }, { status: 409 });
      if (!product.ean) await admin.from("products").update({ ean: code }).eq("sku", body.sku).is("ean", null);
      return NextResponse.json({ batch, assigned: { ean: code, sku: body.sku } });
    } else if (body.action === "stage" && batch.status === "collecting") {
      const { data: match } = await admin.from("product_eans").select("sku").eq("ean", code).maybeSingle();
      if (!match) return NextResponse.json({ error: "EAN desconocido. Asignalo a un SKU de este lote.", unknownEan: code }, { status: 409 });
      if (!expected[match.sku]) return NextResponse.json({ error: `El SKU ${match.sku} no pertenece a este lote.` }, { status: 409 });
      if ((batch.staged[match.sku] || 0) >= expected[match.sku]) return NextResponse.json({ error: `Ya se verificaron todas las unidades de ${match.sku}.` }, { status: 409 });
      update = { staged: { ...batch.staged, [match.sku]: (batch.staged[match.sku] || 0) + 1 } };
    } else if (body.action === "pack" && batch.status === "packing") {
      const shipment = batch.shipments.find((item) => item.id === body.shipmentId);
      if (!shipment) return NextResponse.json({ error: "Primero escaneá una etiqueta de este lote." }, { status: 409 });
      const { data: match } = await admin.from("product_eans").select("sku").eq("ean", code).maybeSingle();
      if (!match) return NextResponse.json({ error: "EAN desconocido. Asignalo a un SKU de este lote.", unknownEan: code }, { status: 409 });
      const needed = required([shipment]);
      if (!needed[match.sku]) return NextResponse.json({ error: `Producto incorrecto: ${match.sku} no corresponde a esta etiqueta.` }, { status: 409 });
      const current = batch.packed[shipment.id] || {};
      if ((current[match.sku] || 0) >= needed[match.sku]) return NextResponse.json({ error: "Ese producto ya está completo para esta etiqueta." }, { status: 409 });
      const packed = { ...batch.packed, [shipment.id]: { ...current, [match.sku]: (current[match.sku] || 0) + 1 } };
      update = { packed };
      if (batch.shipments.every((item) => complete(packed[item.id] || {}, required([item])))) update.status = "completed";
    } else return NextResponse.json({ error: "Acción no válida para el estado actual del lote." }, { status: 409 });
    const { data: updated, error: updateError } = await admin.from("logistics_batches").update({ ...update, updated_at: new Date().toISOString() }).eq("id", batch.id).select("*").single();
    if (updateError) throw updateError;
    return NextResponse.json({ batch: updated });
  } catch (error) { return errorResponse(error); }
}
