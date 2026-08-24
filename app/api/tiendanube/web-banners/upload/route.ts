import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";

const BUCKET = "tiendanube-web-banners";
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function cleanName(value: unknown) {
  return String(value || "banner")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "banner";
}

export async function POST(request: NextRequest) {
  try {
    await requireApiUser();
    const body = await request.json();
    const contentType = String(body.contentType || "").toLowerCase();
    const extension = MIME_EXTENSIONS[contentType];
    if (!extension) {
      return NextResponse.json({ error: "Formato no soportado. Usá JPG, PNG, WEBP o GIF." }, { status: 400 });
    }

    const base64 = String(body.data || "");
    if (!base64) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) return NextResponse.json({ error: "Archivo vacío." }, { status: 400 });
    if (buffer.length > MAX_BYTES) return NextResponse.json({ error: "La imagen supera 8 MB." }, { status: 400 });

    const variant = body.variant === "mobile" ? "mobile" : "desktop";
    const safeName = cleanName(body.fileName);
    const path = `${variant}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safeName}.${extension}`;
    const supabase = createAdminClient();
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    });

    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ ok: true, path, url: data.publicUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo subir la imagen.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
