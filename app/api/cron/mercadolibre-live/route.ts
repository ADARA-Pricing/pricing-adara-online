import { NextRequest, NextResponse } from "next/server";
import { POST as syncSales } from "@/app/api/mercadolibre/sync-sales/route";

export const maxDuration = 60;

// Vercel puede reintentar un cron o superponer ejecuciones durante una respuesta
// lenta de ML/Supabase. Este candado evita duplicar la misma sync en la instancia
// activa; la próxima ventana de 15 minutos vuelve a intentarlo normalmente.
const cronState = globalThis as typeof globalThis & { __adaraMeliSalesSync?: Promise<Response> };

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  return Boolean(secret) && authorization === `Bearer ${secret}`;
}

// Vercel Cron invoca esta ruta con Authorization: Bearer $CRON_SECRET.
// Consulta sólo el delta desde la última carga guardada, con solapamiento de
// seguridad dentro de sync-sales para capturar pagos o envíos que ML completa
// algunos minutos después de crear la orden.
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (cronState.__adaraMeliSalesSync) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Sincronización anterior todavía en curso." });
  }
  cronState.__adaraMeliSalesSync = (async () => {
    const syncRequest = new NextRequest(new URL("/api/mercadolibre/sync-sales", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incrementalToday: true, chunkDays: 1 }),
    });
    return syncSales(syncRequest);
  })();
  let response: Response;
  try { response = await cronState.__adaraMeliSalesSync; }
  finally { cronState.__adaraMeliSalesSync = undefined; }
  const data = await response.json().catch(() => null);

  return NextResponse.json(
    { ok: response.ok, scope: "novedades de hoy", sales: data },
    { status: response.status },
  );
}
