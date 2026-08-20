import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/serverAuth";
import { getConnectedTiendanubeAccount, tiendanubeConfigStatus } from "@/lib/tiendanube";

export async function GET() {
  try {
    await requireApiUser();
    const config = tiendanubeConfigStatus();
    const account = await getConnectedTiendanubeAccount();
    return NextResponse.json({
      connected: Boolean(account),
      configured: config.configured,
      missingConfig: config.missing,
      account: account
        ? {
            store_id: account.store_id,
            store_name: account.store_name,
            scope: account.scope,
            updated_at: account.updated_at,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar Tienda Nube.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
