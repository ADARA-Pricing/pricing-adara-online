import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch, refreshAccessToken } from "@/lib/mercadolibre";
import { requireApiUser } from "@/lib/serverAuth";
import { logisticsLabelState } from "@/lib/logisticsShipmentState";

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
    const format = body.format === "zpl" ? "zpl2" : body.format === "pdf" ? "pdf" : null;
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
