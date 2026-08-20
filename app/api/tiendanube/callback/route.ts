import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";
import { exchangeTiendanubeCodeForToken } from "@/lib/tiendanube";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/tienda-nube?tn_error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/tienda-nube?tn_error=missing_code", request.url));
  }

  try {
    await requireApiUser();
    const token = await exchangeTiendanubeCodeForToken(code);
    const supabase = createAdminClient();
    const { error: upsertError } = await supabase.from("tiendanube_accounts").upsert(
      {
        store_id: token.user_id,
        access_token: token.access_token,
        token_type: token.token_type || "bearer",
        scope: token.scope || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" },
    );

    if (upsertError) throw new Error(upsertError.message);

    return NextResponse.redirect(new URL("/tienda-nube?tn_connected=1", request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo conectar Tienda Nube.";
    return NextResponse.redirect(new URL(`/tienda-nube?tn_error=${encodeURIComponent(message)}`, request.url));
  }
}
