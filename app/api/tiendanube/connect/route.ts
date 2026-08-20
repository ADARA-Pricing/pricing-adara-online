import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/serverAuth";
import { tiendanubeAuthUrl } from "@/lib/tiendanube";

export async function GET(request: NextRequest) {
  try {
    await requireApiUser();
    return NextResponse.redirect(tiendanubeAuthUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar Tienda Nube.";
    const target = message === "No autorizado."
      ? "/login"
      : `/tienda-nube?tn_error=${encodeURIComponent(message)}&tn_setup=1`;
    return NextResponse.redirect(new URL(target, request.url));
  }
}
