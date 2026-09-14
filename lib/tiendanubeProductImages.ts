import sharp from "sharp";

type MeliPicture = { id?: string; secure_url?: string; url?: string };
type MeliVariation = {
  seller_custom_field?: string | null;
  attributes?: Array<{ id?: string; value_name?: string | null }>;
  picture_ids?: string[];
};
export type MeliImageItem = {
  pictures?: MeliPicture[];
  variations?: MeliVariation[];
};

export function mercadoLibreImageUrls(item: MeliImageItem, sku: string) {
  const normalize = (value?: string | null) => (value || "").trim().toUpperCase();
  const variations = item.variations || [];
  const matching = variations.filter((variation) =>
    [variation.seller_custom_field, ...(variation.attributes || [])
      .filter((attribute) => attribute.id === "SELLER_SKU")
      .map((attribute) => attribute.value_name)].some((value) => normalize(value) === normalize(sku)),
  );
  if (variations.length > 1 && !matching.length) {
    throw new Error("No se pudo identificar la variante del SKU para copiar sus fotos.");
  }
  const selected = matching.length ? matching : variations;
  const pictureIds = [...new Set(selected.flatMap((variation) => variation.picture_ids || []))];
  if (variations.length > 1 && !pictureIds.length) {
    throw new Error("La variante del SKU no tiene fotos identificadas.");
  }
  const pictures = item.pictures || [];
  const ordered = pictureIds.length
    ? pictureIds.map((id) => {
      const picture = pictures.find((entry) => entry.id === id);
      if (!picture) throw new Error("Mercado Libre no devolvió todas las fotos de la variante.");
      return picture;
    })
    : pictures;
  return [...new Set(ordered.map((picture) => {
    const url = new URL((picture.secure_url || picture.url || "").replace(/^http:/i, "https:"));
    if (url.protocol !== "https:" || !url.hostname.endsWith(".mlstatic.com") || url.port || url.username || url.password) {
      throw new Error("La foto no tiene una URL válida de Mercado Libre.");
    }
    return url.href;
  }))];
}

export async function squareProductImage(input: Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha()
    .resize(1024, 1024, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Conservar los recortes que ya tienen transparencia. Para fotos opacas,
  // quitar solo blancos casi neutros conectados al borde, no blancos interiores.
  let hasTransparency = false;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] < 255) { hasTransparency = true; break; }
  }
  if (!hasTransparency) {
    const { width, height } = info;
    const visited = new Uint8Array(width * height);
    const queue = new Uint32Array(width * height);
    let head = 0;
    let tail = 0;
    const visit = (pixel: number) => {
      if (visited[pixel]) return;
      visited[pixel] = 1;
      const offset = pixel * 4;
      const low = Math.min(data[offset], data[offset + 1], data[offset + 2]);
      const high = Math.max(data[offset], data[offset + 1], data[offset + 2]);
      if (low >= 245 && high - low <= 10) queue[tail++] = pixel;
    };
    for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
    while (head < tail) {
      const pixel = queue[head++];
      data[pixel * 4 + 3] = 0;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x > 0) visit(pixel - 1);
      if (x + 1 < width) visit(pixel + 1);
      if (y > 0) visit(pixel - width);
      if (y + 1 < height) visit(pixel + width);
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(1024, 1024, { fit: "contain", position: "centre", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

export async function downloadProductImage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "error" });
  if (!response.ok || !response.body) throw new Error(`No se pudo descargar la foto (${response.status}).`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 20 * 1024 * 1024) throw new Error("La foto supera los 20 MB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return squareProductImage(Buffer.concat(chunks));
}
