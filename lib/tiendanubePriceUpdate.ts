type Variant = { price?: string | number | null; promotional_price?: string | number | null; [key: string]: unknown };

export async function updateVerifiedTiendanubePrice(
  fetchVariant: (init?: RequestInit) => Promise<Variant>,
  price: number,
) {
  // Un null puede ser ignorado por TN. La cadena vacía borra la oferta.
  await fetchVariant({ method: "PUT", body: JSON.stringify({ price: String(Math.round(price)), promotional_price: "" }) });
  const actual = await fetchVariant();
  if (Number(actual.price) !== Math.round(price) || Number(actual.promotional_price || 0) > 0) {
    throw new Error("Tiendanube no confirmó el precio solicitado o conservó una promoción anterior. Actualizá los datos y revisá la publicación.");
  }
  return actual;
}
