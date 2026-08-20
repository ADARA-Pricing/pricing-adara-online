import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";
import { getConnectedTiendanubeAccount, tiendanubeFetch } from "@/lib/tiendanube";
import type { Product } from "@/lib/types";

function numberOrZero(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(request: NextRequest) {
  try {
    await requireApiUser();
    const { sku, price, visibility = "hidden" } = await request.json();
    const normalizedSku = String(sku || "").trim().toUpperCase();
    const parsedPrice = Number(price);
    if (!normalizedSku || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      return NextResponse.json({ error: "SKU y precio son obligatorios." }, { status: 400 });
    }

    const account = await getConnectedTiendanubeAccount();
    if (!account) return NextResponse.json({ error: "Primero conecta Tienda Nube." }, { status: 400 });

    const supabase = createAdminClient();
    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .ilike("sku", normalizedSku)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!product) return NextResponse.json({ error: "No encontré el producto local." }, { status: 404 });

    const localProduct = product as Product & { id: string };
    const payload = {
      name: { es: localProduct.name },
      description: { es: localProduct.description || localProduct.name },
      visibility,
      variants: [
        {
          price: String(Math.round(parsedPrice)),
          stock_management: true,
          stock: numberOrZero(localProduct.stock),
          sku: localProduct.sku,
          weight: localProduct.weight_kg ? String(localProduct.weight_kg) : undefined,
          width: localProduct.width_cm ? String(localProduct.width_cm) : undefined,
          height: localProduct.height_cm ? String(localProduct.height_cm) : undefined,
          depth: localProduct.depth_cm ? String(localProduct.depth_cm) : undefined,
          cost: String(Math.round(numberOrZero(localProduct.cost_with_vat || localProduct.cost_without_vat))),
        },
      ],
    };

    const created = await tiendanubeFetch("/products", account, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return NextResponse.json({ ok: true, product: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el producto.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
