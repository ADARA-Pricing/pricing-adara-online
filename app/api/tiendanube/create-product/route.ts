import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";
import { getConnectedTiendanubeAccount, tiendanubeFetch } from "@/lib/tiendanube";
import type { MercadoLibreShippingCost, Product } from "@/lib/types";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { downloadProductImage, mercadoLibreImageUrls, type MeliImageItem } from "@/lib/tiendanubeProductImages";

export const runtime = "nodejs";
export const maxDuration = 300;

type TnLocalized = string | Record<string, string | null | undefined> | null | undefined;
type TnCategory = {
  id: number;
  name?: TnLocalized;
  handle?: TnLocalized;
  parent?: number | null;
};

function numberOrZero(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localizedText(value: TnLocalized) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.es || value.pt || value.en || Object.values(value).find(Boolean) || "";
}

function normalizeText(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanText(value?: string | null) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function moneylessNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function latestSyncedPublications(publications: MercadoLibreShippingCost[]) {
  const synced = publications
    .map((publication) => ({
      publication,
      time: new Date(publication.meli_last_sync_at || publication.updated_at || 0).getTime(),
    }))
    .filter((item) => Number.isFinite(item.time) && item.time > 0);
  if (!synced.length) return publications;

  const latest = Math.max(...synced.map((item) => item.time));
  const syncWindowMs = 10 * 60 * 1000;
  return synced
    .filter((item) => latest - item.time <= syncWindowMs)
    .map((item) => item.publication);
}

function stockFromMercadoLibre(publications: MercadoLibreShippingCost[], fallback: unknown) {
  const latest = latestSyncedPublications(publications);
  const active = latest.filter((publication) => publication.meli_status === "active");
  const stockSource = active.length ? active : latest;
  return stockSource.length
    ? Math.max(...stockSource.map((publication) => numberOrZero(publication.meli_stock)))
    : numberOrZero(fallback);
}

async function imagesFromMercadoLibre(publications: MercadoLibreShippingCost[], sku: string) {
  const account = await getConnectedMeliAccount();
  if (!account) throw new Error("Conectá Mercado Libre para importar todas las fotos.");
  const candidates = [...publications].sort((a, b) =>
    Number(b.meli_status === "active") - Number(a.meli_status === "active")
    || String(b.meli_last_sync_at || "").localeCompare(String(a.meli_last_sync_at || "")),
  );
  const itemIds = [...new Set(candidates.map((row) => row.meli_item_id).filter((id): id is string => /^MLA\d+$/.test(id || "")))];
  let lastError = "No se encontró una publicación de Mercado Libre con fotos.";
  for (const itemId of itemIds) {
    try {
      const item = await meliFetch(`/items/${itemId}?include_attributes=all`, account) as MeliImageItem;
      const urls = mercadoLibreImageUrls(item, sku);
      if (urls.length) return { itemId, urls };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

function standardProductName(product: Product) {
  return cleanText(product.name || product.sku);
}

function productDescription(product: Product) {
  const intro = cleanText(product.description) || standardProductName(product);
  const specs = [
    ["Marca", product.brand],
    ["Modelo", product.model],
    ["SKU", product.sku],
    ["Categoría", product.category],
    ["EAN", product.ean],
    ["Garantía", product.warranty_months ? `${product.warranty_months} meses` : null],
    ["Peso", moneylessNumber(product.weight_kg) ? `${product.weight_kg} kg` : null],
    [
      "Dimensiones",
      [product.height_cm, product.width_cm, product.depth_cm].some((value) => moneylessNumber(value))
        ? `${product.height_cm || "-"} x ${product.width_cm || "-"} x ${product.depth_cm || "-"} cm`
        : null,
    ],
  ].filter(([, value]) => cleanText(String(value || "")));

  const list = specs
    .map(([label, value]) => `<li><strong>${label}:</strong> ${cleanText(String(value))}</li>`)
    .join("");

  return `<p>${intro}</p>${list ? `<h3>Especificaciones</h3><ul>${list}</ul>` : ""}`;
}

async function getAllCategories(account: NonNullable<Awaited<ReturnType<typeof getConnectedTiendanubeAccount>>>) {
  const perPage = 200;
  const categories: TnCategory[] = [];

  for (let page = 1; page <= 50; page += 1) {
    const data = await tiendanubeFetch(`/categories?page=${page}&per_page=${perPage}`, account);
    const rows = Array.isArray(data) ? data : [];
    categories.push(...(rows as TnCategory[]));
    if (rows.length < perPage) break;
  }

  return categories;
}

function findCategoryId(categories: TnCategory[], productCategory?: string | null) {
  const normalized = normalizeText(productCategory);
  if (!normalized) return null;

  const exact = categories.find((category) => normalizeText(localizedText(category.name)) === normalized);
  if (exact?.id) return exact.id;

  const partial = categories.find((category) => {
    const name = normalizeText(localizedText(category.name));
    return name && (name.includes(normalized) || normalized.includes(name));
  });
  return partial?.id || null;
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
    const [{ data: meliPublications, error: meliError }, categoriesResult] = await Promise.all([
      supabase
        .from("mercadolibre_shipping_costs")
        .select("*")
        .eq("active", true)
        .ilike("sku", normalizedSku),
      getAllCategories(account).then((categories) => ({ categories, error: null as string | null })).catch((error) => ({
        categories: [] as TnCategory[],
        error: error instanceof Error ? error.message : "No se pudieron leer categorias.",
      })),
    ]);
    if (meliError) throw new Error(meliError.message);

    const mlRows = (meliPublications || []) as MercadoLibreShippingCost[];
    const categoryId = findCategoryId(categoriesResult.categories, localProduct.category);
    const sourceImages = await imagesFromMercadoLibre(mlRows, normalizedSku);
    // Preparar toda la galería antes de crear evita productos incompletos por
    // errores de descarga o procesamiento. Concurrencia acotada para la memoria.
    const images: Buffer[] = [];
    for (let offset = 0; offset < sourceImages.urls.length; offset += 3) {
      images.push(...await Promise.all(sourceImages.urls.slice(offset, offset + 3).map(downloadProductImage)));
    }
    const stock = stockFromMercadoLibre(mlRows, localProduct.stock);
    const payload = {
      name: { es: standardProductName(localProduct) },
      description: { es: productDescription(localProduct) },
      visibility,
      categories: categoryId ? [categoryId] : undefined,
      variants: [
        {
          price: String(Math.round(parsedPrice)),
          stock_management: true,
          stock,
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

    const imageWarnings: string[] = [];
    let imagesUploaded = 0;
    let imageUrl: string | null = null;
    const createdId = Number((created as { id?: number | string | null })?.id);
    if (!Number.isFinite(createdId) || createdId <= 0) throw new Error("Tiendanube no devolvió el ID del producto creado.");
    for (const [index, image] of images.entries()) {
      try {
        const uploaded = await tiendanubeFetch(`/products/${createdId}/images`, account, {
          method: "POST",
          body: JSON.stringify({
            attachment: image.toString("base64"),
            filename: `${normalizedSku.replace(/[^a-zA-Z0-9_-]/g, "-")}-${index + 1}.jpg`,
            position: index + 1,
          }),
        });
        imagesUploaded += 1;
        imageUrl ||= uploaded?.src || null;
      } catch (imageError) {
        imageWarnings.push(`Foto ${index + 1}: ${imageError instanceof Error ? imageError.message : "No se pudo cargar."}`);
      }
    }

    return NextResponse.json({
      ok: true,
      product: created,
      categoryId,
      imageUrl,
      imagesUploaded,
      imagesTotal: images.length,
      sourceItemId: sourceImages.itemId,
      stock,
      warning: [categoriesResult.error, ...imageWarnings].filter(Boolean).join(" · ") || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el producto.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
