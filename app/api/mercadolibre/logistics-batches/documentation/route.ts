import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireApiUser } from "@/lib/serverAuth";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, meliFetch, refreshAccessToken } from "@/lib/mercadolibre";
import { controlPath, LOGISTICS_CONTROLS_BUCKET } from "@/lib/logisticsControlArchive";
import { batchPdf } from "@/lib/logisticsBatchPdf";

export const runtime = "nodejs";
export const maxDuration = 60;

type Item = { sku: string; title: string; quantity: number };
type Shipment = { id: string; orderIds: string[]; buyer: string; items: Item[] };
type Batch = { id: string; status: string; mode: string; dispatch_day: string; shipments: Shipment[] };

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    await requireApiUser(request);
    const body = await request.json() as { batchId?: string };
    if (!/^[0-9a-f-]{36}$/i.test(body.batchId || "")) return NextResponse.json({ error: "Lote inválido." }, { status: 400 });
    const admin = createAdminClient();
    const { data, error } = await admin.from("logistics_batches").select("id,status,mode,dispatch_day,shipments").eq("id", body.batchId).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "No se encontró el lote." }, { status: 404 });
    const batch = data as Batch;
    if (batch.status !== "completed") return NextResponse.json({ error: "Primero completá la verificación del lote." }, { status: 409 });
    const ids = batch.shipments.map((shipment) => shipment.id);
    if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.some((id) => !/^\d{5,25}$/.test(id))) {
      return NextResponse.json({ error: "Los envíos del lote no son válidos." }, { status: 409 });
    }
    const archive = new JSZip();
    let officialControl = false;
    const { data: savedControl, error: savedError } = await admin.storage.from(LOGISTICS_CONTROLS_BUCKET).download(controlPath(batch.id));
    if (savedControl && !savedError) {
      archive.file("control-mercado-libre.pdf", await savedControl.arrayBuffer());
      officialControl = true;
    } else {
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
    }
    if (!officialControl) archive.file("control-adara.pdf", await batchPdf(batch, "control"));
    archive.file("resumen-pedidos.pdf", await batchPdf(batch, "summary"));
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
