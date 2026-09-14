import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";

type MeliPrice = {
  type?: string | null;
  amount?: number | null;
  percentage?: number | null;
  conditions?: {
    context_restrictions?: string[] | null;
    min_purchase_unit?: number | null;
    eligible?: boolean | null;
  } | null;
};

type RequestedRange = { quantity?: number; price?: number };

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) {
      return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    }
    await requireApiUser();

    const body = await request.json().catch(() => null) as {
      sku?: string;
      itemId?: string;
      ranges?: RequestedRange[];
    } | null;
    const sku = String(body?.sku || "").trim().toUpperCase();
    const itemId = String(body?.itemId || "").trim().toUpperCase();
    const requestedRanges = (body?.ranges || [])
      .map((range) => ({ quantity: Number(range.quantity), price: Number(range.price) }))
      .filter((range) => Number.isInteger(range.quantity) && range.quantity > 1 && range.quantity <= 100 && Number.isFinite(range.price) && range.price > 0);
    if (!sku || !/^MLA\d+$/i.test(itemId) || !requestedRanges.length) {
      return NextResponse.json({ error: "SKU, publicación y al menos un rango válido son obligatorios." }, { status: 400 });
    }

    const account = await getConnectedMeliAccount();
    if (!account) return NextResponse.json({ error: "Primero conectá MercadoLibre." }, { status: 400 });
    const supabase = createAdminClient();
    const { data: ownedPublication, error: ownedPublicationError } = await supabase
      .from("mercadolibre_shipping_costs")
      .select("meli_item_id, meli_currency_id")
      .eq("sku", sku)
      .eq("meli_item_id", itemId)
      .eq("active", true)
      .eq("meli_status", "active")
      .maybeSingle();
    if (ownedPublicationError) throw new Error(ownedPublicationError.message);
    if (!ownedPublication) return NextResponse.json({ error: "La publicación no pertenece a este SKU o ya no está activa." }, { status: 404 });

    const priceData = await meliFetch(`/items/${itemId}/prices?display_version=true`, account, {
      headers: { "show-all-prices": "true" },
    }) as { version?: number | null; prices?: MeliPrice[] | null };
    const prices = Array.isArray(priceData.prices) ? priceData.prices : [];
    const standardAmount = Number(prices.find((price) => price.type === "standard")?.amount || 0);
    if (!priceData.version || standardAmount <= 0) {
      return NextResponse.json({ error: "MercadoLibre no devolvió versión o precio estándar para esta publicación." }, { status: 422 });
    }

    const recommendation = await meliFetch("/prices-per-quantity/v1/recommendations", account, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: itemId,
        range_item_quantities: requestedRanges.map((range) => range.quantity),
        price: { standard_amount: standardAmount, currency: ownedPublication.meli_currency_id || "ARS" },
      }),
    }) as { recommendations?: Array<{ quantity?: number | null; amount?: number | null; is_incoherent_quantity?: boolean | null }> | null };
    const recommendedByQuantity = new Map((recommendation.recommendations || []).map((entry) => [Number(entry.quantity || 0), entry]));

    for (const range of requestedRanges) {
      const allowed = recommendedByQuantity.get(range.quantity);
      if (!allowed || allowed.is_incoherent_quantity) {
        return NextResponse.json({ error: `MercadoLibre no permite el rango de ${range.quantity} unidades.` }, { status: 422 });
      }
      if (range.price > Number(allowed.amount || 0) + 0.01) {
        return NextResponse.json({ error: `El precio de ${range.quantity} unidades supera el máximo recomendado por MercadoLibre (${Number(allowed.amount || 0).toFixed(2)}).` }, { status: 422 });
      }
    }

    const nextRanges = new Map<number, {
      type: string;
      percentage: number;
      conditions: { context_restrictions: string[]; min_purchase_unit: number; eligible: boolean };
    }>();
    prices.forEach((price) => {
      const quantity = Number(price.conditions?.min_purchase_unit || 0);
      if (!price.conditions?.context_restrictions?.includes("user_type_business") || quantity <= 1) return;
      const percentage = Number(price.percentage || 0);
      if (percentage <= 0 || percentage >= 100) return;
      nextRanges.set(quantity, {
        type: "discount_percentage",
        percentage,
        conditions: {
          context_restrictions: ["channel_marketplace", "user_type_business"],
          min_purchase_unit: quantity,
          eligible: true,
        },
      });
    });
    requestedRanges.forEach((range) => {
      nextRanges.set(range.quantity, {
        type: "discount_percentage",
        percentage: Number(((1 - range.price / standardAmount) * 100).toFixed(4)),
        conditions: {
          context_restrictions: ["channel_marketplace", "user_type_business"],
          min_purchase_unit: range.quantity,
          eligible: true,
        },
      });
    });

    const pricePerQuantity = [...nextRanges.values()].sort(
      (a, b) => a.conditions.min_purchase_unit - b.conditions.min_purchase_unit,
    );
    if (pricePerQuantity.length > 5) {
      return NextResponse.json({ error: "MercadoLibre permite hasta 5 rangos mayoristas por publicación." }, { status: 422 });
    }

    await meliFetch(`/items/${itemId}/prices/price-per-quantity`, account, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Version": String(priceData.version) },
      body: JSON.stringify({ price_per_quantity: pricePerQuantity }),
    });

    return NextResponse.json({ ok: true, itemId, ranges: pricePerQuantity });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron activar los precios mayoristas.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
