import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch, refreshAccessToken } from "@/lib/mercadolibre";
import { requireApiUser } from "@/lib/serverAuth";
import { createAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type MeliOrder = {
  id?: number | string;
  date_created?: string;
  pack_id?: number | string | null;
  shipping?: { id?: number | string | null } | null;
  buyer?: { first_name?: string | null; last_name?: string | null; nickname?: string | null } | null;
  order_items?: Array<{ item?: { id?: string; title?: string; seller_sku?: string | null }; quantity?: number; unit_price?: number }>;
};
type MeliShipment = {
  id?: number | string;
  status?: string | null;
  substatus?: string | null;
  date_first_printed?: string | null;
  logistic_type?: string | null;
  logistic?: { type?: string | null } | null;
};
type MeliSla = { expected_date?: string | null };

function dayKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    const connected = await getConnectedMeliAccount();
    if (!connected) return NextResponse.json({ error: "No hay una cuenta de Mercado Libre conectada." }, { status: 400 });
    const account = await refreshAccessToken(connected);
    const target = request.nextUrl.searchParams.get("day") === "tomorrow" ? "tomorrow" : "today";
    const targetDate = new Date();
    if (target === "tomorrow") targetDate.setDate(targetDate.getDate() + 1);
    const targetKey = dayKey(targetDate);

    const orders: MeliOrder[] = [];
    let total = 0;
    const limit = 50;
    for (let offset = 0; offset < 1000; offset += limit) {
      const params = new URLSearchParams({ seller: String(account.meli_user_id), "shipping.status": "ready_to_ship", sort: "date_desc", limit: String(limit), offset: String(offset) });
      const result = await meliFetch(`/orders/search?${params}`, account) as { results?: MeliOrder[]; paging?: { total?: number } };
      total = Number(result.paging?.total || 0);
      orders.push(...(result.results || []));
      if (!result.results?.length || offset + limit >= total) break;
    }
    if (total > orders.length) {
      return NextResponse.json({ error: `Mercado Libre devolvió ${total} envíos pendientes, más que el máximo verificable de 1000. Aplicá un filtro en Mercado Libre antes de usar este panel.` }, { status: 422 });
    }

    const byShipment = new Map<string, MeliOrder[]>();
    for (const order of orders) {
      const id = String(order.shipping?.id || "");
      if (!/^\d+$/.test(id)) continue;
      byShipment.set(id, [...(byShipment.get(id) || []), order]);
    }
    const ids = [...byShipment.keys()];
    const checked: Array<{ id: string; shipment: MeliShipment; sla: MeliSla }> = [];
    for (let index = 0; index < ids.length; index += 10) {
      const batch = await Promise.all(ids.slice(index, index + 10).map(async (id) => {
        try {
          const [shipment, sla] = await Promise.all([
            meliFetch(`/shipments/${id}`, account, { headers: { "x-format-new": "true" } }) as Promise<MeliShipment>,
            meliFetch(`/shipments/${id}/sla`, account) as Promise<MeliSla>,
          ]);
          return { id, shipment, sla };
        } catch { return null; }
      }));
      checked.push(...batch.filter((row): row is NonNullable<typeof row> => row !== null));
    }

    const relevant = checked.filter(({ shipment, sla }) => {
      const logistic = shipment.logistic?.type || shipment.logistic_type;
      return sla.expected_date && dayKey(sla.expected_date) === targetKey &&
        ["cross_docking", "self_service"].includes(logistic || "") &&
        shipment.status === "ready_to_ship" &&
        ["ready_to_print", "printed"].includes(shipment.substatus || "");
    });
    // La búsqueda puede omitir el nombre del comprador. Completamos sólo los
    // pedidos del día seleccionado, nunca todo el historial de ventas.
    for (let index = 0; index < relevant.length; index += 10) {
      await Promise.all(relevant.slice(index, index + 10).map(async ({ id }) => {
        const rows = byShipment.get(id) || [];
        for (let orderIndex = 0; orderIndex < rows.length; orderIndex++) {
          const order = rows[orderIndex];
          if (order.buyer?.first_name || order.buyer?.nickname || !order.id) continue;
          try { rows[orderIndex] = await meliFetch(`/orders/${order.id}`, account) as MeliOrder; } catch { /* El pedido sigue visible sin nombre. */ }
        }
      }));
    }
    const itemIds = [...new Set(relevant.flatMap(({ id }) => (byShipment.get(id) || []).flatMap((order) => (order.order_items || []).map((item) => item.item?.id).filter(Boolean))))] as string[];
    const { data: publications, error: publicationError } = itemIds.length
      ? await createAdminClient().from("mercadolibre_shipping_costs").select("meli_item_id,meli_thumbnail,sku").in("meli_item_id", itemIds)
      : { data: [] as Array<{ meli_item_id: string; meli_thumbnail: string | null; sku: string | null }>, error: null };
    if (publicationError) throw new Error(publicationError.message);
    const imageByItem = new Map((publications || []).map((row) => [row.meli_item_id, row]));

    const shipments = relevant.map(({ id, shipment, sla }) => {
      const ordersForShipment = byShipment.get(id) || [];
      const logistic = shipment.logistic?.type || shipment.logistic_type;
      const printed = shipment.substatus === "printed" || Boolean(shipment.date_first_printed);
      return {
        id,
        mode: logistic,
        status: printed ? "printed" : shipment.substatus === "ready_to_print" ? "ready_to_print" : "other",
        substatus: shipment.substatus || null,
        dispatchAt: sla.expected_date,
        orderIds: ordersForShipment.map((order) => String(order.id)),
        orderDate: ordersForShipment.map((order) => order.date_created || "").sort().at(0) || "",
        buyer: ordersForShipment.map((order) => [order.buyer?.first_name, order.buyer?.last_name].filter(Boolean).join(" ") || order.buyer?.nickname || "").find(Boolean) || "Cliente no informado",
        items: ordersForShipment.flatMap((order) => (order.order_items || []).map((item) => ({
          orderId: String(order.id),
          itemId: item.item?.id || "",
          sku: item.item?.seller_sku || imageByItem.get(item.item?.id || "")?.sku || "",
          title: item.item?.title || "Producto",
          image: imageByItem.get(item.item?.id || "")?.meli_thumbnail || null,
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.unit_price || 0),
        }))),
      };
    }).sort((a, b) => String(a.dispatchAt).localeCompare(String(b.dispatchAt)));
    return NextResponse.json({ day: targetKey, shipments, checkedAt: new Date().toISOString(), incomplete: checked.length !== ids.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar la logística.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
