import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/serverAuth";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, refreshAccessToken } from "@/lib/mercadolibre";
import { controlPath, fetchOfficialControl, LOGISTICS_CONTROLS_BUCKET } from "@/lib/logisticsControlArchive";
import { archiveBatchToDrive } from "@/lib/googleDriveArchive";
import { batchPdf } from "@/lib/logisticsBatchPdf";

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

async function withInternalProductNames<T extends { shipments: Shipment[] }>(admin: ReturnType<typeof createAdminClient>, batch: T): Promise<T> {
  const skus = [...new Set(batch.shipments.flatMap((shipment) => shipment.items.map((item) => item.sku)).filter(Boolean))];
  if (!skus.length) return batch;
  const { data, error } = await admin.from("products").select("sku,name").in("sku", skus);
  if (error) throw error;
  const names = new Map((data || []).map((product) => [product.sku, product.name]));
  return {
    ...batch,
    shipments: batch.shipments.map((shipment) => ({
      ...shipment,
      items: shipment.items.map((item) => ({ ...item, title: names.get(item.sku) || item.title })),
    })),
  } as T;
}

function barcodeProblem(code: string) {
  return !/^\d{8}$|^\d{12,14}$/.test(code)
    ? "Código rechazado: no tiene el formato de un EAN/UPC válido. Parece un número de serie u otro identificador; escaneá el código de barras del producto."
    : null;
}

async function skuForEan(admin: ReturnType<typeof createAdminClient>, ean: string) {
  // El EAN principal de Productos es la fuente vigente: puede corregirse aun
  // después de haber creado un lote. La tabla auxiliar conserva EAN adicionales.
  const { data: product } = await admin.from("products").select("sku").eq("ean", ean).maybeSingle();
  if (product?.sku) return product.sku;
  const { data: extraEan } = await admin.from("product_eans").select("sku").eq("ean", ean).maybeSingle();
  return extraEan?.sku || null;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    const { data, error } = await createAdminClient().from("logistics_batches").select("*").eq("dispatch_day", argentinaDayKey()).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    const batches = data || [];
    const skus = [...new Set(batches.flatMap((batch) => ((batch.shipments || []) as Shipment[]).flatMap((shipment) => shipment.items.map((item) => item.sku)).filter(Boolean)))];
    const { data: products, error: productsError } = skus.length
      ? await createAdminClient().from("products").select("sku,name,description").in("sku", skus)
      : { data: [] as Array<{ sku: string; name: string; description: string | null }>, error: null };
    if (productsError) throw productsError;
    const productBySku = new Map((products || []).map((product) => [product.sku, product]));
    const withInternalNames = batches.map((batch) => ({ ...batch, shipments: ((batch.shipments || []) as Shipment[]).map((shipment) => ({ ...shipment, items: shipment.items.map((item) => ({ ...item, title: productBySku.get(item.sku)?.name || item.title })) })) }));
    return NextResponse.json({ batches: withInternalNames }, { headers: { "Cache-Control": "private, no-store" } });
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
    if (body.action === "archive") {
      if (batch.status !== "completed") return NextResponse.json({ error: "El lote debe estar completado antes de archivarlo." }, { status: 409 });
      const finished = data as unknown as { id: string; mode: string; dispatch_day: string; shipments: Shipment[]; created_at?: string };
      const prepared = await withInternalProductNames(admin, finished);
      const files = [
        { name: "hoja-preparacion.pdf", bytes: await batchPdf(prepared, "preparation"), mimeType: "application/pdf" },
        { name: "resumen-lote.pdf", bytes: await batchPdf(prepared, "summary"), mimeType: "application/pdf" },
      ];
      const { data: official } = await admin.storage.from(LOGISTICS_CONTROLS_BUCKET).download(controlPath(finished.id));
      if (official) files.push({ name: "hoja-control-mercado-libre.pdf", bytes: new Uint8Array(await official.arrayBuffer()), mimeType: "application/pdf" });
      const saved = await archiveBatchToDrive(finished, files);
      if (!saved) return NextResponse.json({ error: "Falta configurar Google Drive en Vercel." }, { status: 503 });
      return NextResponse.json({ batch: data, archived: true });
    } else if (body.action === "start" && batch.status === "printed") update = { status: "collecting" };
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
      const invalidBarcode = barcodeProblem(code);
      if (invalidBarcode) return NextResponse.json({ error: invalidBarcode }, { status: 409 });
      const sku = await skuForEan(admin, code);
      if (!sku) return NextResponse.json({ error: "Código no reconocido. Puede ser un número de serie: usá el EAN/UPC del producto o asignalo manualmente.", unknownEan: code }, { status: 409 });
      if (!expected[sku]) return NextResponse.json({ error: `El SKU ${sku} no pertenece a este lote.` }, { status: 409 });
      if ((batch.staged[sku] || 0) >= expected[sku]) return NextResponse.json({ error: `Ya se verificaron todas las unidades de ${sku}.` }, { status: 409 });
      update = { staged: { ...batch.staged, [sku]: (batch.staged[sku] || 0) + 1 } };
    } else if (body.action === "pack" && batch.status === "packing") {
      const shipment = batch.shipments.find((item) => item.id === body.shipmentId);
      if (!shipment) return NextResponse.json({ error: "Primero escaneá una etiqueta de este lote." }, { status: 409 });
      const invalidBarcode = barcodeProblem(code);
      if (invalidBarcode) return NextResponse.json({ error: invalidBarcode }, { status: 409 });
      const sku = await skuForEan(admin, code);
      if (!sku) return NextResponse.json({ error: "Código no reconocido. Puede ser un número de serie: usá el EAN/UPC del producto o asignalo manualmente.", unknownEan: code }, { status: 409 });
      const needed = required([shipment]);
      if (!needed[sku]) return NextResponse.json({ error: `Producto incorrecto: ${sku} no corresponde a esta etiqueta.` }, { status: 409 });
      const current = batch.packed[shipment.id] || {};
      if ((current[sku] || 0) >= needed[sku]) return NextResponse.json({ error: "Ese producto ya está completo para esta etiqueta." }, { status: 409 });
      const packed = { ...batch.packed, [shipment.id]: { ...current, [sku]: (current[sku] || 0) + 1 } };
      update = { packed };
      if (batch.shipments.every((item) => complete(packed[item.id] || {}, required([item])))) update.status = "completed";
    } else return NextResponse.json({ error: "Acción no válida para el estado actual del lote." }, { status: 409 });
    const { data: updated, error: updateError } = await admin.from("logistics_batches").update({ ...update, updated_at: new Date().toISOString() }).eq("id", batch.id).select("*").single();
    if (updateError) throw updateError;
    let archiveWarning: string | undefined;
    if (updated.status === "completed") {
      try {
        const finished = updated as unknown as { id: string; mode: string; dispatch_day: string; shipments: Shipment[]; created_at?: string };
        const prepared = await withInternalProductNames(admin, finished);
        const files = [
          { name: "hoja-preparacion.pdf", bytes: await batchPdf(prepared, "preparation"), mimeType: "application/pdf" },
          { name: "resumen-lote.pdf", bytes: await batchPdf(prepared, "summary"), mimeType: "application/pdf" },
        ];
        const { data: official } = await admin.storage.from(LOGISTICS_CONTROLS_BUCKET).download(controlPath(finished.id));
        if (official) files.push({ name: "hoja-control-mercado-libre.pdf", bytes: new Uint8Array(await official.arrayBuffer()), mimeType: "application/pdf" });
        await archiveBatchToDrive(finished, files);
      } catch (archiveError) { archiveWarning = `El lote se completó, pero no se pudo archivar en Drive: ${archiveError instanceof Error ? archiveError.message : "error desconocido"}`; }
    }
    return NextResponse.json({ batch: updated, archiveWarning });
  } catch (error) { return errorResponse(error); }
}
