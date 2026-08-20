import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";
import { getConnectedTiendanubeAccount, tiendanubeFetch } from "@/lib/tiendanube";

export async function POST(request: NextRequest) {
  try {
    await requireApiUser();
    const { productId, variantId, price } = await request.json();
    const parsedProductId = Number(productId);
    const parsedVariantId = Number(variantId);
    const parsedPrice = Number(price);

    if (!parsedProductId || !parsedVariantId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      return NextResponse.json({ error: "Producto, variante y precio son obligatorios." }, { status: 400 });
    }

    const account = await getConnectedTiendanubeAccount();
    if (!account) return NextResponse.json({ error: "Primero conecta Tienda Nube." }, { status: 400 });

    const data = await tiendanubeFetch(`/products/${parsedProductId}/variants/${parsedVariantId}`, account, {
      method: "PUT",
      body: JSON.stringify({ price: String(Math.round(parsedPrice)) }),
    });

    const supabase = createAdminClient();
    const now = new Date().toISOString();
    await supabase
      .from("tiendanube_publications")
      .update({
        price: parsedPrice,
        raw: data,
        tn_last_sync_at: now,
        updated_at: now,
      })
      .eq("tiendanube_store_id", account.store_id)
      .eq("tiendanube_variant_id", parsedVariantId);

    return NextResponse.json({ ok: true, publication: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el precio.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
