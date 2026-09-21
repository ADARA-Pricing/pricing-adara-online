import { NextRequest, NextResponse } from "next/server";
import { POST as syncSales } from "@/app/api/mercadolibre/sync-sales/route";

export const maxDuration = 60;

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  return Boolean(secret) && authorization === `Bearer ${secret}`;
}

// Vercel Cron invoca esta ruta con Authorization: Bearer $CRON_SECRET.
// Se limita a la última jornada para no repetir una sincronización histórica
// completa cada cinco minutos.
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const syncRequest = new NextRequest(new URL("/api/mercadolibre/sync-sales", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days: 1, chunkDays: 1 }),
  });
  const response = await syncSales(syncRequest);
  const data = await response.json().catch(() => null);

  return NextResponse.json(
    { ok: response.ok, scope: "últimas 24 horas", sales: data },
    { status: response.status },
  );
}
