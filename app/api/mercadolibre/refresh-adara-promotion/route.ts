import { NextRequest, NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { requireApiUser } from "@/lib/serverAuth";

type Entry = { itemId?: string; listPrice?: number; dealPrice?: number };

export async function POST(request: NextRequest) {
  try {
    await requireApiUser();
    const body = await request.json() as { entries?: Entry[] };
    const entries = (body.entries || []).map((entry) => ({
      itemId: String(entry.itemId || "").toUpperCase(),
      listPrice: Math.round(Number(entry.listPrice || 0)),
      dealPrice: Math.round(Number(entry.dealPrice || 0)),
    })).filter((entry) => /^MLA\d+$/.test(entry.itemId) && entry.listPrice > 0 && entry.dealPrice > 0);
    if (!entries.length) return NextResponse.json({ error: "No hay publicaciones ni precios válidos para la campaña." }, { status: 400 });

    const account = await getConnectedMeliAccount();
    if (!account) return NextResponse.json({ error: "Primero conectá Mercado Libre." }, { status: 400 });
    const campaignsResponse = await meliFetch(`/seller-promotions/users/${account.meli_user_id}?app_version=v2`, account) as { results?: Array<{ id?: string; name?: string; type?: string; status?: string }> };
    const campaign = (Array.isArray(campaignsResponse?.results) ? campaignsResponse.results : []).find((item) =>
      item.type === "SELLER_CAMPAIGN" && /^adara\b/i.test(String(item.name || "")) && /started|active|pending/i.test(String(item.status || "")),
    );
    if (!campaign?.id) return NextResponse.json({ error: "No encontré una campaña mensual activa llamada Adara." }, { status: 404 });

    const updated: string[] = [];
    const failed: Array<{ itemId: string; reason: string }> = [];
    for (const entry of entries) {
      try {
        const current = await meliFetch(`/seller-promotions/items/${entry.itemId}?app_version=v2`, account) as Array<{ id?: string; status?: string }>;
        const active = (Array.isArray(current) ? current : []).some((promo) => promo.id === campaign.id && /started|active|pending/i.test(String(promo.status || "")));
        if (active) await meliFetch(`/seller-promotions/items/${entry.itemId}?promotion_type=SELLER_CAMPAIGN&promotion_id=${encodeURIComponent(campaign.id)}&app_version=v2`, account, { method: "DELETE" });
        await meliFetch(`/items/${entry.itemId}`, account, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ price: entry.listPrice }) });
        await meliFetch(`/seller-promotions/items/${entry.itemId}?app_version=v2`, account, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promotion_id: campaign.id, promotion_type: "SELLER_CAMPAIGN", deal_price: entry.dealPrice }) });
        updated.push(entry.itemId);
      } catch (error) { failed.push({ itemId: entry.itemId, reason: error instanceof Error ? error.message : "No se pudo actualizar." }); }
    }
    return NextResponse.json({ ok: updated.length > 0, campaign: campaign.name, updated, failed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la promo Adara." }, { status: 500 });
  }
}
