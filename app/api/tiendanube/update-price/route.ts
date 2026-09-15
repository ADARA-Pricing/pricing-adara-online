import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";
import { getConnectedTiendanubeAccount, tiendanubeFetch } from "@/lib/tiendanube";
import { updateVerifiedTiendanubePrice } from "@/lib/tiendanubePriceUpdate";

export async function POST(request: NextRequest) {
  try {
    await requireApiUser();
    const { productId, variantId, price, desiredMargin } = await request.json();
    const parsedProductId = Number(productId);
    const parsedVariantId = Number(variantId);
    const parsedPrice = Number(price);
    if (desiredMargin !== undefined && (!Number.isFinite(Number(desiredMargin)) || Number(desiredMargin) < 0 || Number(desiredMargin) >= 100)) {
      return NextResponse.json({ error: "El objetivo debe estar entre 0 y menos de 100%." }, { status: 400 });
    }

    if (!parsedProductId || !parsedVariantId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      return NextResponse.json({ error: "Producto, variante y precio son obligatorios." }, { status: 400 });
    }

    const account = await getConnectedTiendanubeAccount();
    if (!account) return NextResponse.json({ error: "Primero conecta Tienda Nube." }, { status: 400 });

    const data = await updateVerifiedTiendanubePrice(
      (init) => tiendanubeFetch(`/products/${parsedProductId}/variants/${parsedVariantId}`, account, init), parsedPrice,
    );

    const supabase = createAdminClient();
    const now = new Date().toISOString();
    const { data: saved, error: saveError } = await supabase
      .from("tiendanube_publications")
      .update({
        price: Number(data.price),
        promotional_price: null,
        raw: data,
        tn_last_sync_at: now,
        updated_at: now,
      })
      .eq("tiendanube_store_id", account.store_id)
      .eq("tiendanube_variant_id", parsedVariantId)
      .select("product_id, sku")
      .maybeSingle();
    if (saveError) throw new Error(`Precio actualizado en Tiendanube, pero no se pudo guardar localmente: ${saveError.message}`);
    if (desiredMargin !== undefined && saved?.product_id) {
      const { error: marginError } = await supabase.from("product_channel_margins").upsert({
        product_id: saved.product_id, sku: saved.sku, channel_code: "TN",
        desired_margin_rate: Number(desiredMargin), desired_net_profit: null, updated_at: now,
      }, { onConflict: "product_id,channel_code" });
      if (marginError) throw new Error(`Precio actualizado, pero no se pudo guardar el objetivo: ${marginError.message}`);
    }

    return NextResponse.json({ ok: true, publication: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el precio.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
