import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { requireApiUser } from "@/lib/serverAuth";

type PublicationRow = {
  id: string;
  meli_item_id: string | null;
  meli_installments_text: string | null;
  meli_listing_type_id: string | null;
  notes: string | null;
};

type MeliItem = {
  id?: string;
  variations?: Array<{ id?: number | string | null }>;
};

function installmentsForPublication(publication: PublicationRow) {
  const text = `${publication.meli_installments_text || ""} ${publication.notes || ""} ${publication.meli_listing_type_id || ""}`.toLowerCase();
  if (text.includes("sin cuotas") || text.includes("1 pago") || text.includes("clasica")) return 1;
  const match = text.match(/(\d{1,2})\s*(x|cuotas?|installments?)/i);
  if (match?.[1]) return Number(match[1]);
  if (text.includes("gold_pro") || text.includes("premium")) return 6;
  return null;
}

async function automatedItemIds(userId: number, account: Awaited<ReturnType<typeof getConnectedMeliAccount>>) {
  const itemIds = new Set<string>();
  let offset = 0;
  let total = 0;

  do {
    const response = await meliFetch(
      `/pricing-automation/users/${userId}/items?offset=${offset}&limit=100`,
      account!,
    ) as { items?: string[]; paging?: { total?: number } };
    for (const itemId of response.items || []) itemIds.add(String(itemId).toUpperCase());
    total = Number(response.paging?.total || 0);
    offset += 100;
  } while (offset < total);

  return itemIds;
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) {
      return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    }

    await requireApiUser();
    const body = await request.json().catch(() => null) as {
      sku?: string;
      installmentCount?: number;
      price?: number;
    } | null;
    const sku = String(body?.sku || "").trim();
    const installmentCount = Number(body?.installmentCount);
    const price = Number(body?.price);

    if (!sku || !Number.isInteger(installmentCount) || installmentCount < 1 || !Number.isFinite(price) || price <= 0 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) {
      return NextResponse.json({ error: "SKU, cuota y precio válido son obligatorios." }, { status: 400 });
    }

    const account = await getConnectedMeliAccount();
    if (!account) return NextResponse.json({ error: "Primero conectá MercadoLibre." }, { status: 400 });

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("mercadolibre_shipping_costs")
      .select("id, meli_item_id, meli_installments_text, meli_listing_type_id, notes")
      .eq("sku", sku)
      .eq("active", true)
      .eq("meli_status", "active");
    if (error) throw new Error(error.message);

    const targets = ((data || []) as PublicationRow[]).filter((publication) =>
      /^MLA\d+$/i.test(String(publication.meli_item_id || "")) && installmentsForPublication(publication) === installmentCount,
    );
    if (!targets.length) {
      // En la carga masiva una cuota sin publicación no debe convertir toda la
      // operación en error. La UI la informa como omitida.
      return NextResponse.json({
        ok: true,
        price,
        updated: [],
        skipped: [{ itemId: sku, reason: `No hay publicaciones activas para ${installmentCount === 1 ? "Clásica / 1 pago" : `${installmentCount} cuotas`}.` }],
      });
    }

    // Mercado Libre bloquea PUT /items/{id} cuando la automatización de precios está activa.
    // La consulta es obligatoria antes de escribir para no informar un cambio que ML ignoró.
    const automated = await automatedItemIds(account.meli_user_id, account);
    const updated: string[] = [];
    const skipped: Array<{ itemId: string; reason: string }> = [];
    for (const publication of targets) {
      const itemId = String(publication.meli_item_id).toUpperCase();
      if (automated.has(itemId)) {
        skipped.push({ itemId, reason: "Tiene automatización de precios activa en Mercado Libre." });
        continue;
      }

      try {
        const item = await meliFetch(`/items/${itemId}`, account) as MeliItem;
        const variations = Array.isArray(item.variations) ? item.variations.filter((variation) => variation.id !== null && variation.id !== undefined) : [];
        const payload = variations.length
          ? { variations: variations.map((variation) => ({ id: variation.id, price })) }
          : { price };
        const updatedItem = await meliFetch(`/items/${itemId}`, account, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }) as MeliItem;

        await supabase
          .from("mercadolibre_shipping_costs")
          .update({ meli_price: price, meli_last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", publication.id);
        updated.push(String(updatedItem.id || itemId));
      } catch (error) {
        skipped.push({ itemId, reason: error instanceof Error ? error.message : "No se pudo actualizar." });
      }
    }

    return NextResponse.json({ ok: updated.length > 0, price, updated, skipped });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el precio en MercadoLibre.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
