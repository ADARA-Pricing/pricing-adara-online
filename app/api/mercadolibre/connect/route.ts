import { NextResponse } from "next/server";
import { meliAuthUrl } from "@/lib/mercadolibre";

export async function GET() {
  try {
    return NextResponse.redirect(meliAuthUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al iniciar conexión.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
