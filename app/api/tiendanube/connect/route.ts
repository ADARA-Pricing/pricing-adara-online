import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/serverAuth";
import { tiendanubeAuthUrl } from "@/lib/tiendanube";

export async function GET() {
  try {
    await requireApiUser();
    return NextResponse.redirect(tiendanubeAuthUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar Tienda Nube.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
