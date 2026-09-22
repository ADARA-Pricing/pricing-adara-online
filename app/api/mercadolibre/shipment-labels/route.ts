import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, refreshAccessToken } from "@/lib/mercadolibre";
import { requireApiUser } from "@/lib/serverAuth";

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

    const { data, error } = await createAdminClient()
      .from("mercadolibre_order_items")
      .select("shipment_id,shipping_logistic_type,status")
      .in("shipment_id", ids);
    if (error) throw new Error(error.message);
    const known = new Set((data || [])
      .filter((row) => row.status !== "cancelled" && ["cross_docking", "self_service"].includes(row.shipping_logistic_type || ""))
      .map((row) => String(row.shipment_id)));
    if (ids.some((id) => !known.has(id))) {
      return NextResponse.json({ error: "Hay envíos que no pertenecen a ventas activas de Colecta o Flex sincronizadas." }, { status: 400 });
    }

    const connected = await getConnectedMeliAccount();
    if (!connected) return NextResponse.json({ error: "No hay una cuenta de Mercado Libre conectada." }, { status: 400 });
    const account = await refreshAccessToken(connected);
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
