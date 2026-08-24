import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { requireApiUser } from "@/lib/serverAuth";

const OFFER_PROMOTION_TYPES = new Set(["SMART", "PRICE_MATCHING", "PRE_NEGOTIATED", "UNHEALTHY_STOCK"]);
const PRICE_PROMOTION_TYPES = new Set(["DEAL", "SELLER_CAMPAIGN"]);
const STOCK_PRICE_PROMOTION_TYPES = new Set(["LIGHTNING"]);
const SUPPORTED_PROMOTION_TYPES = new Set([
  ...OFFER_PROMOTION_TYPES,
  ...PRICE_PROMOTION_TYPES,
  ...STOCK_PRICE_PROMOTION_TYPES,
]);

function positiveNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function findActivatedPromotion(data: unknown, promotionId: string, offerId?: string) {
  const rows = Array.isArray(data) ? data : [];
  return rows.find((item) => {
    const promo = item as { id?: string | null; ref_id?: string | null; status?: string | null };
    if (offerId && promo.ref_id === offerId) return true;
    return promo.id === promotionId && /started|active|pending|programmed/i.test(String(promo.status || ""));
  }) || null;
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) {
      return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    }

    await requireApiUser();

    const body = await request.json().catch(() => null) as {
      itemId?: string;
      promotionId?: string;
      promotionType?: string;
      offerId?: string;
      dealPrice?: number;
      stock?: number;
      expectedPrice?: number;
    } | null;

    const itemId = String(body?.itemId || "").trim().toUpperCase();
    const promotionId = String(body?.promotionId || "").trim();
    const promotionType = String(body?.promotionType || "").trim().toUpperCase();
    const offerId = String(body?.offerId || "").trim();
    const dealPrice = positiveNumber(body?.dealPrice);
    const stock = positiveNumber(body?.stock);
    const expectedPrice = positiveNumber(body?.expectedPrice);

    if (!/^MLA\d+$/.test(itemId)) {
      return NextResponse.json({ error: "ID de publicacion invalido." }, { status: 400 });
    }

    if (!promotionId || !promotionType) {
      return NextResponse.json({ error: "Faltan datos de la promocion." }, { status: 400 });
    }

    if (!SUPPORTED_PROMOTION_TYPES.has(promotionType)) {
      return NextResponse.json({ error: "Este tipo de promocion todavia no se puede activar desde la app." }, { status: 400 });
    }

    if (OFFER_PROMOTION_TYPES.has(promotionType) && !offerId) {
      return NextResponse.json({ error: "La promocion no tiene offer_id activable para esta publicacion." }, { status: 400 });
    }

    if (PRICE_PROMOTION_TYPES.has(promotionType) && !dealPrice) {
      return NextResponse.json({ error: "La promocion no tiene precio promocional para enviar a MercadoLibre." }, { status: 400 });
    }

    if (STOCK_PRICE_PROMOTION_TYPES.has(promotionType) && (!dealPrice || !stock)) {
      return NextResponse.json({ error: "La oferta relampago necesita precio promocional y stock reservado." }, { status: 400 });
    }

    const account = await getConnectedMeliAccount();
    if (!account) {
      return NextResponse.json({ error: "MercadoLibre no esta conectado." }, { status: 400 });
    }

    const activationBody: Record<string, string | number> = {
      promotion_id: promotionId,
      promotion_type: promotionType,
    };

    if (OFFER_PROMOTION_TYPES.has(promotionType)) {
      activationBody.offer_id = offerId;
    }

    if (PRICE_PROMOTION_TYPES.has(promotionType) || STOCK_PRICE_PROMOTION_TYPES.has(promotionType)) {
      activationBody.deal_price = dealPrice as number;
    }

    if (STOCK_PRICE_PROMOTION_TYPES.has(promotionType)) {
      activationBody.stock = stock as number;
    }

    const result = await meliFetch(`/seller-promotions/items/${itemId}?app_version=v2`, account, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activationBody),
    });

    const currentPromotions = await meliFetch(`/seller-promotions/items/${itemId}?app_version=v2`, account);
    const activated = findActivatedPromotion(currentPromotions, promotionId, result?.offer_id || offerId) as {
      price?: number | null;
      status?: string | null;
      ref_id?: string | null;
      meli_percentage?: number | null;
      seller_percentage?: number | null;
    } | null;
    const actualPrice = positiveNumber(activated?.price) || positiveNumber(result?.price);
    const expected = expectedPrice || dealPrice || null;
    const priceDifference = expected && actualPrice ? actualPrice - expected : null;
    const priceDifferenceRate = expected && priceDifference !== null ? (priceDifference / expected) * 100 : null;

    return NextResponse.json({
      ok: true,
      result,
      verification: {
        expectedPrice: expected,
        actualPrice,
        priceDifference,
        priceDifferenceRate,
        status: activated?.status || null,
        offerId: activated?.ref_id || result?.offer_id || offerId || null,
        meliPercentage: activated?.meli_percentage || null,
        sellerPercentage: activated?.seller_percentage || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo activar la promocion.";
    const status = message === "No autorizado."
      ? 401
      : message.startsWith("403")
        ? 403
        : 500;
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
