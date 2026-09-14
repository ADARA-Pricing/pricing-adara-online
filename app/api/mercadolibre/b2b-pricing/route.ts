import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";

type Publication = {
  meli_item_id: string | null;
  meli_price: number | string | null;
  meli_currency_id: string | null;
  meli_installments_text: string | null;
  meli_listing_type_id: string | null;
  meli_stock: number | string | null;
  meli_logistic_type: string | null;
  meli_promo_price: number | string | null;
  meli_promo_meli_amount: number | string | null;
  meli_promo_meli_rate: number | string | null;
  meli_promo_seller_rate: number | string | null;
  meli_original_price: number | string | null;
  notes: string | null;
};

type MeliPrice = {
  type?: string | null;
  amount?: number | null;
  percentage?: number | null;
  conditions?: { context_restrictions?: string[] | null; min_purchase_unit?: number | null; eligible?: boolean | null } | null;
};

function isOnePaymentPublication(publication: Publication) {
  const source = `${publication.meli_installments_text || ""} ${publication.meli_listing_type_id || ""} ${publication.notes || ""}`.toLowerCase();
  return source.includes("sin cuotas") || source.includes("1 pago") || source.includes("clásica") || source.includes("clasica");
}

function meliPromoContribution(publication: Publication, customerPrice: number) {
  const promoPrice = Number(publication.meli_promo_price || 0);
  // Solo aplicamos el aporte guardado si corresponde al precio que hoy recibe
  // el comprador. Así una promo vieja no altera el cálculo mayorista.
  if (!promoPrice || Math.abs(promoPrice - customerPrice) > 1) return 0;

  const explicitAmount = Number(publication.meli_promo_meli_amount || 0);
  if (explicitAmount > 0) return explicitAmount;

  const originalPrice = Number(publication.meli_original_price || publication.meli_price || 0);
  const meliRate = Number(publication.meli_promo_meli_rate || 0);
  const sellerRate = Number(publication.meli_promo_seller_rate || 0);
  const totalDiscount = Math.max(originalPrice - customerPrice, 0);
  return totalDiscount > 0 && meliRate > 0 && meliRate + sellerRate > 0
    ? (totalDiscount * meliRate) / (meliRate + sellerRate)
    : 0;
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) {
      return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    }

    await requireApiUser(request);
    const body = await request.json().catch(() => null) as { sku?: string; quantities?: unknown } | null;
    const sku = String(body?.sku || "").trim().toUpperCase();
    const quantities = Array.isArray(body?.quantities)
      ? [...new Set(body.quantities.map(Number).filter((value) => Number.isInteger(value) && value > 1 && value <= 100))].slice(0, 5)
      : [2, 5, 10];
    if (!sku) return NextResponse.json({ error: "SKU obligatorio." }, { status: 400 });

    const account = await getConnectedMeliAccount();
    if (!account) return NextResponse.json({ error: "Primero conectá MercadoLibre." }, { status: 400 });

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("mercadolibre_shipping_costs")
      .select("meli_item_id, meli_price, meli_currency_id, meli_installments_text, meli_listing_type_id, meli_stock, meli_logistic_type, meli_promo_price, meli_promo_meli_amount, meli_promo_meli_rate, meli_promo_seller_rate, meli_original_price, notes")
      .eq("sku", sku)
      .eq("active", true)
      .eq("meli_status", "active");
    if (error) throw new Error(error.message);

    const publications = ((data || []) as Publication[])
      .filter((publication) => /^MLA\d+$/i.test(String(publication.meli_item_id || "")))
      .filter(isOnePaymentPublication)
      // Negocios se calcula sobre una condición de venta. Para evitar repetir
      // el mismo SKU en MLA espejo, las ordenamos por stock y Full. Se devuelven
      // todas porque cada publicación puede tener su propio envío y propuesta.
      .sort((a, b) =>
        Number(b.meli_stock || 0) - Number(a.meli_stock || 0)
        || Number(b.meli_logistic_type === "fulfillment") - Number(a.meli_logistic_type === "fulfillment")
        || String(a.meli_item_id || "").localeCompare(String(b.meli_item_id || "")),
      );

    if (!publications.length) {
      return NextResponse.json({ error: "No hay una publicación activa de 1 pago para este SKU." }, { status: 404 });
    }

    const results = await Promise.all(publications.map(async (publication) => {
      const itemId = String(publication.meli_item_id).toUpperCase();
      try {
        const priceData = await meliFetch(`/items/${itemId}/prices?display_version=true`, account, {
          headers: { "show-all-prices": "true" },
        }) as { version?: number | null; prices?: MeliPrice[] | null };
        const prices = Array.isArray(priceData.prices) ? priceData.prices : [];
        const standardAmount = Number(prices.find((price) => price.type === "standard")?.amount || publication.meli_price || 0);
        const currency = publication.meli_currency_id || "ARS";
        if (standardAmount <= 0) throw new Error("MercadoLibre no devolvió el precio estándar.");

        const recommendation = await meliFetch("/prices-per-quantity/v1/recommendations", account, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item_id: itemId,
            range_item_quantities: quantities.length ? quantities : [2, 5, 10],
            price: { standard_amount: standardAmount, currency },
          }),
        }) as {
          price?: { sale_price_amount?: number | null; standard_amount?: number | null; currency?: string | null } | null;
          recommendations?: Array<{
            quantity?: number | null;
            amount?: number | null;
            is_incoherent_quantity?: boolean | null;
            discount?: { amount?: number | null; percentage?: number | null } | null;
            shipping?: {
              original_cost?: number | null;
              cost?: number | null;
              discount?: { amount?: number | null; percentage?: number | null } | null;
            } | null;
          }> | null;
        };

        const existingRanges = prices
          .filter((price) => price.conditions?.context_restrictions?.includes("user_type_business"))
          .map((price) => ({
            type: price.type || null,
            amount: Number(price.amount || 0),
            percentage: Number(price.percentage || 0),
            conditions: price.conditions || null,
          }));

        const salePriceAmount = Number(recommendation.price?.sale_price_amount || standardAmount);
        return {
          itemId,
          version: priceData.version || null,
          standardAmount,
          salePriceAmount,
          meliPromoContributionAmount: meliPromoContribution(publication, salePriceAmount),
          currency: recommendation.price?.currency || currency,
          existingRanges,
          recommendations: recommendation.recommendations || [],
        };
      } catch (requestError) {
        return { itemId, error: requestError instanceof Error ? requestError.message : "No se pudo consultar Negocios." };
      }
    }));

    return NextResponse.json({ ok: true, sku, quantities, publications: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron consultar precios de Mercado Libre Negocios.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
