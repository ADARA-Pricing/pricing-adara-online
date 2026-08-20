import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

function jsonOk(body: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...body });
}

function verifySignature(rawBody: string, signature: string | null) {
  const secret = process.env.TIENDANUBE_CLIENT_SECRET;
  if (!signature || !secret) return { verified: false, skipped: !signature };

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signature.trim();
  if (expected.length !== received.length) return { verified: false, skipped: false };

  return {
    verified: timingSafeEqual(Buffer.from(expected), Buffer.from(received)),
    skipped: false,
  };
}

function eventFromPayload(payload: any) {
  return String(payload?.event || payload?.topic || payload?.type || "").toLowerCase();
}

async function redactStore(storeId: number) {
  const supabase = createAdminClient();
  await supabase.from("tiendanube_publications").delete().eq("tiendanube_store_id", storeId);
  await supabase.from("tiendanube_accounts").delete().eq("store_id", storeId);
}

export async function GET() {
  return jsonOk({ endpoint: "tiendanube/privacy" });
}

export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "GET,HEAD,OPTIONS,POST",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-linkedstore-hmac-sha256");
    const signatureStatus = verifySignature(rawBody, signature);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const storeId = Number(payload?.store_id || 0);
    const event = eventFromPayload(payload);
    const isStoreRedact = event === "store/redact" || Boolean(storeId && !payload?.customer && !payload?.orders_to_redact && !payload?.data_request);

    if (!signatureStatus.skipped && !signatureStatus.verified) {
      return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
    }

    if (isStoreRedact && storeId && signatureStatus.verified) {
      await redactStore(storeId);
      return jsonOk({ handled: "store/redact", store_id: storeId });
    }

    return jsonOk({
      handled: event || "privacy_webhook",
      store_id: storeId || null,
      note: "No customer personal data is stored by this app.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar privacidad Tienda Nube.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
