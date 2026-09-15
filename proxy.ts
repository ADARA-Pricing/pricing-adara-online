import { NextRequest, NextResponse } from "next/server";
export function proxy(request: NextRequest) {
  // Local audit preview must never execute real API integrations, even if a
  // page has a legacy effect or someone presses a synchronization button.
  if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PRICING_FIXTURES === "1" && request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Integraciones bloqueadas en la vista de prueba. No se modificaron datos reales." }, { status: 403 });
  }
  return NextResponse.next();
}
export const config = { matcher: "/api/:path*" };
