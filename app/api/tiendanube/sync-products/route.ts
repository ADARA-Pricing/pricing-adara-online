import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";
import { getConnectedTiendanubeAccount, tiendanubeFetch } from "@/lib/tiendanube";
import type { Product } from "@/lib/types";

type TnLocalized = string | Record<string, string | null | undefined> | null | undefined;
type TnVariant = {
  id?: number;
  product_id?: number;
  price?: string | number | null;
  promotional_price?: string | number | null;
  stock?: number | null;
  stock_management?: boolean | null;
  sku?: string | null;
  values?: Array<Record<string, string | null | undefined>>;
};
type TnProduct = {
  id: number;
  name?: TnLocalized;
  handle?: TnLocalized;
  variants?: TnVariant[];
  images?: Array<{ src?: string | null }>;
  categories?: unknown;
  published?: boolean | null;
  visibility?: string | null;
  canonical_url?: string | null;
};

function localizedText(value: TnLocalized) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.es || value.pt || value.en || Object.values(value).find(Boolean) || "";
}

function normalizeSku(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function variantName(variant: TnVariant) {
  const values = Array.isArray(variant.values)
    ? variant.values.map((item) => localizedText(item)).filter(Boolean)
    : [];
  return values.join(" / ") || null;
}

async function getAllProducts(account: NonNullable<Awaited<ReturnType<typeof getConnectedTiendanubeAccount>>>) {
  const perPage = 200;
  const products: TnProduct[] = [];

  for (let page = 1; page <= 100; page += 1) {
    const data = await tiendanubeFetch(`/products?page=${page}&per_page=${perPage}`, account);
    const rows = Array.isArray(data) ? data : [];
    products.push(...(rows as TnProduct[]));
    if (rows.length < perPage) break;
  }

  return products;
}

export async function POST() {
  try {
    await requireApiUser();
    const supabase = createAdminClient();
    const account = await getConnectedTiendanubeAccount();
    if (!account) return NextResponse.json({ error: "Primero conecta Tienda Nube." }, { status: 400 });

    const [{ data: products, error: productsError }, tnProducts] = await Promise.all([
      supabase.from("products").select("*"),
      getAllProducts(account),
    ]);
    if (productsError) throw new Error(productsError.message);

    const productBySku = new Map<string, Product & { id: string }>();
    (products || []).forEach((product: Product & { id: string }) => {
      productBySku.set(normalizeSku(product.sku), product);
    });

    const syncAt = new Date().toISOString();
    const rows = tnProducts.flatMap((product) => {
      const variants = Array.isArray(product.variants) && product.variants.length
        ? product.variants
        : ([{ id: product.id, product_id: product.id }] as TnVariant[]);
      const title = localizedText(product.name) || `Producto ${product.id}`;
      const handle = localizedText(product.handle) || null;
      const imageUrl = product.images?.find((image) => Boolean(image.src))?.src || null;

      return variants
        .filter((variant) => variant.id)
        .map((variant) => {
          const sku = normalizeSku(variant.sku);
          const localProduct = sku ? productBySku.get(sku) || null : null;
          return {
            tiendanube_store_id: account.store_id,
            tiendanube_product_id: product.id,
            tiendanube_variant_id: Number(variant.id),
            product_id: localProduct?.id || null,
            sku: sku || null,
            title,
            variant_name: variantName(variant),
            handle,
            permalink: product.canonical_url || null,
            price: numberOrNull(variant.price),
            promotional_price: numberOrNull(variant.promotional_price),
            currency: "ARS",
            stock: numberOrNull(variant.stock),
            stock_management: variant.stock_management ?? null,
            visibility: product.visibility || null,
            published: product.published ?? null,
            categories: product.categories || null,
            image_url: imageUrl,
            raw: { product, variant },
            active: product.visibility !== "hidden",
            tn_last_sync_at: syncAt,
            updated_at: syncAt,
          };
        });
    });

    const { error: inactiveError } = await supabase
      .from("tiendanube_publications")
      .update({ active: false, updated_at: syncAt })
      .eq("tiendanube_store_id", account.store_id);
    if (inactiveError) throw new Error(inactiveError.message);

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("tiendanube_publications")
        .upsert(chunk, { onConflict: "tiendanube_store_id,tiendanube_variant_id" });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({
      synced: rows.length,
      products: tnProducts.length,
      linked: rows.filter((row) => row.product_id).length,
      missingSku: rows.filter((row) => !row.sku).length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar Tienda Nube.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
