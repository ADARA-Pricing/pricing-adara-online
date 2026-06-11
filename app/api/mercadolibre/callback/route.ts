import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { exchangeCodeForToken } from "@/lib/mercadolibre";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/envios-meli?meli_error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/envios-meli?meli_error=missing_code", request.url));
  }

  try {
    const token = await exchangeCodeForToken(code);
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;

    const userResponse = await fetch("https://api.mercadolibre.com/users/me", {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/json",
      },
    });
    const user = await userResponse.json();

    const supabase = createAdminClient();
    const { error: upsertError } = await supabase.from("mercadolibre_accounts").upsert(
      {
        meli_user_id: token.user_id,
        nickname: user?.nickname || user?.first_name || null,
        access_token: token.access_token,
        refresh_token: token.refresh_token || null,
        token_type: token.token_type || "Bearer",
        scope: token.scope || null,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "meli_user_id" },
    );

    if (upsertError) throw new Error(upsertError.message);

    return NextResponse.redirect(new URL("/envios-meli?meli_connected=1", request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo conectar MercadoLibre.";
    return NextResponse.redirect(new URL(`/envios-meli?meli_error=${encodeURIComponent(message)}`, request.url));
  }
}
