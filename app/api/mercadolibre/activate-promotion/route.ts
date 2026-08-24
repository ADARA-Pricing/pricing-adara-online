import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { requireApiUser } from "@/lib/serverAuth";

const SUPPORTED_PROMOTION_TYPES = new Set(["SMART"]);

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
    } | null;

    const itemId = String(body?.itemId || "").trim().toUpperCase();
    const promotionId = String(body?.promotionId || "").trim();
    const promotionType = String(body?.promotionType || "").trim().toUpperCase();
    const offerId = String(body?.offerId || "").trim();

    if (!/^MLA\d+$/.test(itemId)) {
      return NextResponse.json({ error: "ID de publicacion invalido." }, { status: 400 });
    }

    if (!promotionId || !promotionType || !offerId) {
      return NextResponse.json({ error: "Faltan datos de la promocion." }, { status: 400 });
    }

    if (!SUPPORTED_PROMOTION_TYPES.has(promotionType)) {
      return NextResponse.json({ error: "Por ahora solo se pueden activar promociones SMART desde la app." }, { status: 400 });
    }

    if (!offerId.startsWith(`CANDIDATE-${itemId}-`)) {
      return NextResponse.json({ error: "La promocion no tiene un offer_id candidato activable para esta publicacion." }, { status: 400 });
    }

    const account = await getConnectedMeliAccount();
    if (!account) {
      return NextResponse.json({ error: "MercadoLibre no esta conectado." }, { status: 400 });
    }

    const result = await meliFetch(`/seller-promotions/items/${itemId}?app_version=v2`, account, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promotion_id: promotionId,
        promotion_type: promotionType,
        offer_id: offerId,
      }),
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo activar la promocion.";
    return NextResponse.json(
      { error: message },
      { status: message === "No autorizado." ? 401 : 500 },
    );
  }
}
