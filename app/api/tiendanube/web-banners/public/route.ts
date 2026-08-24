import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=30, s-maxage=30",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  try {
    const now = new Date().toISOString();
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("tiendanube_web_banners")
      .select("id, position, title, subtitle, image_url, mobile_image_url, link_url, button_label, show_text, text_width_desktop, text_color, overlay_opacity, starts_at, ends_at, updated_at")
      .eq("active", true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gte.${now}`)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return NextResponse.json({ banners: data || [], updated_at: now }, { headers: corsHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron leer los banners.";
    return NextResponse.json({ error: message, banners: [] }, { status: 500, headers: corsHeaders() });
  }
}
