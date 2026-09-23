import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch, refreshAccessToken } from "@/lib/mercadolibre";
import { requireApiUser } from "@/lib/serverAuth";
import { logisticsLabelState } from "@/lib/logisticsShipmentState";
import JSZip from "jszip";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) {
      return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    }
    await requireApiUser(request);

    const body = await request.json() as { shipmentIds?: unknown; format?: unknown };
    const rawIds = Array.isArray(body.shipmentIds) ? body.shipmentIds : [];
    const ids = rawIds.length
      ? [...new Set(rawIds.map(String).filter((id) => /^\d{5,25}$/.test(id)))]
      : [];
    if (!ids.length || ids.length > 50 || ids.length !== rawIds.length) {
      return NextResponse.json({ error: "Seleccioná entre 1 y 50 envíos válidos, sin duplicados." }, { status: 400 });
    }
    const format = body.format === "zpl" || body.format === "control" ? "zpl2" : body.format === "pdf" ? "pdf" : null;
    if (!format) return NextResponse.json({ error: "Formato no válido." }, { status: 400 });

    const connected = await getConnectedMeliAccount();
    if (!connected) return NextResponse.json({ error: "No hay una cuenta de Mercado Libre conectada." }, { status: 400 });
    const account = await refreshAccessToken(connected);
    for (let index = 0; index < ids.length; index += 10) {
      const batch = await Promise.all(ids.slice(index, index + 10).map((id) => meliFetch(`/shipments/${id}`, account, { headers: { "x-format-new": "true" } }) as Promise<{
        sender_id?: number | string;
        origin?: { sender_id?: number | string };
        status?: string;
        substatus?: string;
        logistic_type?: string;
        logistic?: { type?: string };
      }>));
      for (const shipment of batch) {
        const sellerId = shipment.sender_id || shipment.origin?.sender_id;
        if ((sellerId && String(sellerId) !== String(account.meli_user_id)) ||
          !logisticsLabelState(shipment)) {
          return NextResponse.json({ error: "Una de las etiquetas ya no está disponible para imprimir. Actualizá el panel." }, { status: 409 });
        }
      }
    }
    const params = new URLSearchParams({ shipment_ids: ids.join(","), response_type: format });
    const response = await fetch(`https://api.mercadolibre.com/shipment_labels?${params}`, {
      headers: { Authorization: `Bearer ${account.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const message = await response.text();
      return NextResponse.json({ error: `Mercado Libre no pudo generar las etiquetas (${response.status}). ${message.slice(0, 300)}` }, { status: response.status });
    }
    if (format === "zpl2") {
      const bytes = Buffer.from(await response.arrayBuffer());
      let payload: Buffer;
      if (bytes.subarray(0, 2).toString() === "PK") {
        const archive = await JSZip.loadAsync(bytes);
        const files = Object.values(archive.files).filter((file) => !file.dir);
        const matches = files.filter((entry) => body.format === "control" ? /\.pdf$/i.test(entry.name) : /\.(txt|zpl)$/i.test(entry.name));
        if (!matches.length) return NextResponse.json({ error: body.format === "control" ? "Mercado Libre no incluyó la hoja de control en el archivo." : "Mercado Libre no incluyó etiquetas ZPL en el archivo." }, { status: 502 });
        payload = body.format === "control"
          ? Buffer.from(await matches[0].async("uint8array"))
          : Buffer.concat(await Promise.all(matches.map(async (file) => Buffer.from(await file.async("uint8array")))));
      } else if (body.format === "zpl" && bytes.toString("utf8", 0, 100).includes("^XA")) {
        payload = bytes;
      } else {
        return NextResponse.json({ error: "Mercado Libre devolvió un formato de etiquetas inesperado." }, { status: 502 });
      }
      return new NextResponse(Uint8Array.from(payload).buffer, { headers: {
        "Content-Type": body.format === "control" ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="${body.format === "control" ? "control-ml.pdf" : "etiquetas-ml.zpl"}"`,
        "Cache-Control": "private, no-store",
      } });
    }
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="etiquetas-ml-${ids.length}.${format === "pdf" ? "pdf" : "zpl"}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron descargar las etiquetas.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
