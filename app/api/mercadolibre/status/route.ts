import { NextResponse } from "next/server";
import { getConnectedMeliAccount } from "@/lib/mercadolibre";

export async function GET() {
  try {
    const account = await getConnectedMeliAccount();
    return NextResponse.json({
      connected: Boolean(account),
      account: account
        ? {
            meli_user_id: account.meli_user_id,
            nickname: account.nickname,
            expires_at: account.expires_at,
            updated_at: (account as any).updated_at,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar MercadoLibre.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
