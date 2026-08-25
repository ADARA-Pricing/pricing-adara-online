import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanOptionalText(value: unknown) {
  const text = cleanText(value);
  return text || null;
}

function cleanUrl(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  if (text.startsWith("/") || /^https?:\/\//i.test(text)) return text;
  throw new Error("Las URLs deben empezar con http://, https:// o /.");
}

function cleanPlacement(value: unknown) {
  const placement = cleanText(value) || "main_carousel";
  return placement === "promo_strip" ? "promo_strip" : "main_carousel";
}

function cleanColor(value: unknown) {
  const text = cleanText(value) || "#ffffff";
  if (!/^#[0-9a-f]{6}$/i.test(text)) throw new Error("El color debe tener formato #RRGGBB.");
  return text;
}

function cleanOpacity(value: unknown) {
  const number = Number(value ?? 0.28);
  if (!Number.isFinite(number)) return 0.28;
  return Math.max(0, Math.min(0.75, number));
}

function cleanTextWidth(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cleanDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha inválida.");
  return date.toISOString();
}

async function listBanners() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tiendanube_web_banners")
    .select("*")
    .order("placement", { ascending: true })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function GET() {
  try {
    await requireApiUser();
    return NextResponse.json({ banners: await listBanners() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron leer los banners.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const body = await request.json();
    const title = cleanText(body.title);
    const imageUrl = cleanUrl(body.image_url);
    if (!title) return NextResponse.json({ error: "El título es obligatorio." }, { status: 400 });
    if (!imageUrl) return NextResponse.json({ error: "La imagen es obligatoria." }, { status: 400 });

    const supabase = createAdminClient();
    const payload = {
      placement: cleanPlacement(body.placement),
      position: Number.isFinite(Number(body.position)) ? Number(body.position) : 0,
      title,
      subtitle: cleanOptionalText(body.subtitle),
      image_url: imageUrl,
      mobile_image_url: cleanUrl(body.mobile_image_url),
      link_url: cleanUrl(body.link_url),
      button_label: cleanOptionalText(body.button_label),
      show_text: Boolean(body.show_text ?? true),
      text_width_desktop: cleanTextWidth(body.text_width_desktop, 46, 24, 70),
      text_width_mobile: cleanTextWidth(body.text_width_mobile, 86, 55, 100),
      text_color: cleanColor(body.text_color),
      overlay_opacity: cleanOpacity(body.overlay_opacity),
      active: Boolean(body.active ?? true),
      starts_at: cleanDate(body.starts_at),
      ends_at: cleanDate(body.ends_at),
      created_by: user.id,
      updated_by: user.id,
    };

    const { data, error } = await supabase
      .from("tiendanube_web_banners")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, banner: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el banner.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const body = await request.json();
    const id = cleanText(body.id);
    const title = cleanText(body.title);
    const imageUrl = cleanUrl(body.image_url);
    if (!id) return NextResponse.json({ error: "Falta el ID del banner." }, { status: 400 });
    if (!title) return NextResponse.json({ error: "El título es obligatorio." }, { status: 400 });
    if (!imageUrl) return NextResponse.json({ error: "La imagen es obligatoria." }, { status: 400 });

    const supabase = createAdminClient();
    const payload = {
      placement: cleanPlacement(body.placement),
      position: Number.isFinite(Number(body.position)) ? Number(body.position) : 0,
      title,
      subtitle: cleanOptionalText(body.subtitle),
      image_url: imageUrl,
      mobile_image_url: cleanUrl(body.mobile_image_url),
      link_url: cleanUrl(body.link_url),
      button_label: cleanOptionalText(body.button_label),
      show_text: Boolean(body.show_text ?? true),
      text_width_desktop: cleanTextWidth(body.text_width_desktop, 46, 24, 70),
      text_width_mobile: cleanTextWidth(body.text_width_mobile, 86, 55, 100),
      text_color: cleanColor(body.text_color),
      overlay_opacity: cleanOpacity(body.overlay_opacity),
      active: Boolean(body.active),
      starts_at: cleanDate(body.starts_at),
      ends_at: cleanDate(body.ends_at),
      updated_by: user.id,
    };

    const { data, error } = await supabase
      .from("tiendanube_web_banners")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, banner: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el banner.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const body = await request.json();
    const orderedIds = Array.isArray(body.ordered_ids)
      ? body.ordered_ids.map((id) => cleanText(id)).filter(Boolean)
      : [];

    if (!orderedIds.length) {
      return NextResponse.json({ error: "Falta el orden de banners." }, { status: 400 });
    }

    const supabase = createAdminClient();
    const updates = orderedIds.map((id, position) =>
      supabase
        .from("tiendanube_web_banners")
        .update({ position, updated_by: user.id })
        .eq("id", id)
    );
    const results = await Promise.all(updates);
    const error = results.find((result) => result.error)?.error;
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, banners: await listBanners() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo reordenar los banners.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireApiUser();
    const id = cleanText(new URL(request.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "Falta el ID del banner." }, { status: 400 });

    const supabase = createAdminClient();
    const { error } = await supabase.from("tiendanube_web_banners").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar el banner.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
