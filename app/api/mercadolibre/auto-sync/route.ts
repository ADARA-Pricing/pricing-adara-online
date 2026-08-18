import { NextRequest, NextResponse } from "next/server";
import { POST as syncMercadoLibre } from "../sync-shipping/route";

function isAuthorized(request: NextRequest) {
  const expected = process.env.MELI_AUTO_SYNC_TOKEN || process.env.CRON_SECRET;
  if (!expected) return false;

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : request.nextUrl.searchParams.get("token") || "";

  return token === expected;
}

async function runAutoSync(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const syncRequest = new NextRequest(new URL("/api/mercadolibre/sync-shipping", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "all" }),
  });

  return syncMercadoLibre(syncRequest);
}

export async function GET(request: NextRequest) {
  return runAutoSync(request);
}

export async function POST(request: NextRequest) {
  return runAutoSync(request);
}
