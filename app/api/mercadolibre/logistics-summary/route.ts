import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch, refreshAccessToken } from "@/lib/mercadolibre";
import { requireApiUser } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

type Order = { id?: string | number; shipping?: { id?: string | number | null } | null };
type Shipment = {
  id?: string | number;
  status?: string | null;
  substatus?: string | null;
  logistic_type?: string | null;
  logistic?: { type?: string | null } | null;
  status_history?: { date_shipped?: string | null } | null;
  receiver_address?: { city?: { name?: string | null } | null; state?: { name?: string | null } | null } | null;
  destination?: { shipping_address?: { city?: { name?: string | null } | null; state?: { name?: string | null } | null } | null } | null;
};

function dayKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    const connected = await getConnectedMeliAccount();
    if (!connected) return NextResponse.json({ error: "No hay una cuenta de Mercado Libre conectada." }, { status: 400 });
    const account = await refreshAccessToken(connected);
    const target = request.nextUrl.searchParams.get("day") || dayKey(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
    // Incluye ventas anteriores cuyo despacho efectivo o previsto cae en el día.
    const fromDate = new Date(`${target}T12:00:00-03:00`);
    fromDate.setUTCDate(fromDate.getUTCDate() - 30);
    const from = `${dayKey(fromDate)}T00:00:00.000-03:00`;
    const to = `${target}T23:59:59.999-03:00`;
    const ids = new Set<string>();
    const limit = 50;
    let total = 0;
    for (let offset = 0; offset < 1000; offset += limit) {
      const params = new URLSearchParams({ seller: String(account.meli_user_id), "order.date_created.from": from, "order.date_created.to": to, sort: "date_desc", limit: String(limit), offset: String(offset) });
      const result = await meliFetch(`/orders/search?${params}`, account) as { results?: Order[]; paging?: { total?: number } };
      total = Number(result.paging?.total || 0);
      for (const order of result.results || []) {
        const id = String(order.shipping?.id || "");
        if (/^\d{5,25}$/.test(id)) ids.add(id);
      }
      if (!result.results?.length || offset + limit >= total) break;
    }
    if (total > 1000) return NextResponse.json({ error: "Hay más de 1000 ventas en el período de búsqueda. No se muestra un resumen parcial; hace falta ampliar la consulta." }, { status: 422 });

    const entries: Array<{ id: string; mode: string; locality: string; province: string; source: "actual" | "scheduled" }> = [];
    let unresolved = 0;
    const allIds = [...ids];
    for (let offset = 0; offset < allIds.length; offset += 10) {
      const batch = await Promise.all(allIds.slice(offset, offset + 10).map(async (id) => {
        let shipment: Shipment;
        try {
          try { shipment = await meliFetch(`/shipments/${id}?views=destination`, account, { headers: { "x-format-new": "true" } }) as Shipment; }
          catch { shipment = await meliFetch(`/shipments/${id}`, account, { headers: { "x-format-new": "true" } }) as Shipment; }
        } catch { return { unresolved: true as const }; }
        if (shipment.status === "cancelled") return { ignored: true as const };
        const mode = shipment.logistic?.type || shipment.logistic_type || "";
        if (!["self_service", "cross_docking", "fulfillment"].includes(mode)) return { ignored: true as const };
        const address = shipment.destination?.shipping_address || shipment.receiver_address;
        const locality = address?.city?.name?.trim() || "Sin localidad";
        const province = address?.state?.name?.trim() || "";
        let shippedAt = shipment.status_history?.date_shipped || null;
        const dispatched = ["shipped", "delivered"].includes(shipment.status || "") || ["picked_up", "authorized_by_carrier"].includes(shipment.substatus || "");
        if (!shippedAt && dispatched) {
          try {
            const history = await meliFetch(`/shipments/${id}/history`, account, { headers: { "x-format-new": "true" } }) as Array<{ status?: string; substatus?: string | null; date?: string | null }>;
            const event = history.find((item) => mode === "cross_docking"
              ? item.status === "ready_to_ship" && ["picked_up", "authorized_by_carrier"].includes(item.substatus || "")
              : item.status === "shipped") || history.find((item) => item.status === "shipped");
            shippedAt = event?.date || null;
          } catch { return { unresolved: true as const }; }
          if (!shippedAt) return { unresolved: true as const };
        }
        if (shippedAt) {
          if (dayKey(shippedAt) !== target) return { ignored: true as const };
          return { entry: { id, mode, locality, province, source: "actual" as const } };
        }
        if (mode === "fulfillment") return { ignored: true as const };
        try {
          const sla = await meliFetch(`/shipments/${id}/sla`, account) as { expected_date?: string | null };
          if (!sla.expected_date) return { unresolved: true as const };
          if (dayKey(sla.expected_date) !== target) return { ignored: true as const };
          return { entry: { id, mode, locality, province, source: "scheduled" as const } };
        } catch { return { unresolved: true as const }; }
      }));
      for (const result of batch) {
        if ("entry" in result && result.entry) entries.push(result.entry);
        else if ("unresolved" in result) unresolved++;
      }
    }
    const flexByLocality = new Map<string, { locality: string; province: string; count: number }>();
    for (const entry of entries.filter((item) => item.mode === "self_service")) {
      const key = `${entry.locality}|${entry.province}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const current = flexByLocality.get(key) || { locality: entry.locality, province: entry.province, count: 0 };
      current.count++;
      flexByLocality.set(key, current);
    }
    return NextResponse.json({
      day: target,
      checkedAt: new Date().toISOString(),
      counts: { flex: entries.filter((item) => item.mode === "self_service").length, collection: entries.filter((item) => item.mode === "cross_docking").length, full: entries.filter((item) => item.mode === "fulfillment").length },
      flexByLocality: [...flexByLocality.values()].sort((a, b) => b.count - a.count || a.locality.localeCompare(b.locality, "es-AR")),
      unresolved,
      coverageDays: 30,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el resumen.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
