import { NextResponse } from "next/server";

// Mercado Libre reintenta las notificaciones que no reciben 200. Por ahora la
// pantalla de Preguntas consulta la API al abrirse; este receptor confirma la
// entrega y evita una tormenta de reintentos mientras deja listo el punto de
// entrada para sincronización en tiempo real.
export async function POST() {
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
