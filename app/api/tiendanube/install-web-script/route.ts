import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { requireApiUser } from "@/lib/serverAuth";
import { getConnectedTiendanubeAccount, tiendanubeAppConfig } from "@/lib/tiendanube";

function scriptId() {
  return Number(process.env.TIENDANUBE_WEB_BANNER_SCRIPT_ID || process.env.TIENDANUBE_SCRIPT_ID || 0);
}

function hasScriptsScope(scope?: string | null) {
  const scopes = String(scope || "")
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return scopes.includes("scripts") || scopes.includes("write_scripts");
}

async function tiendanubeScriptsFetch(path: string, account: NonNullable<Awaited<ReturnType<typeof getConnectedTiendanubeAccount>>>, init?: RequestInit) {
  const { userAgent } = tiendanubeAppConfig();
  const response = await fetch(`https://api.tiendanube.com/v1/${account.store_id}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${account.access_token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.description || data?.error || `Error Tienda Nube ${response.status}`;
    throw new Error(`${response.status}: ${message}`);
  }
  return data;
}

async function visibleBannerCounts() {
  const now = new Date().toISOString();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tiendanube_web_banners")
    .select("placement")
    .eq("active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`);

  if (error) throw new Error(error.message);
  const banners = data || [];
  const main = banners.filter((banner) => banner.placement !== "promo_strip").length;
  const promo = banners.filter((banner) => banner.placement === "promo_strip").length;
  return { main, promo, total: banners.length, checked_at: now };
}

export async function GET() {
  try {
    await requireApiUser();
    const account = await getConnectedTiendanubeAccount();
    const counts = await visibleBannerCounts();
    const configuredScriptId = scriptId();

    if (!account) {
      return NextResponse.json({
        ok: true,
        connected: false,
        canInstall: false,
        installed: false,
        scriptId: configuredScriptId || null,
        bannerCounts: counts,
        message: "Primero conectá Tienda Nube.",
      });
    }

    const hasScope = hasScriptsScope(account.scope);
    let installed = false;
    let scriptError: string | null = null;

    if (hasScope && configuredScriptId) {
      try {
        const existing = await tiendanubeScriptsFetch("/scripts", account);
        installed = Array.isArray(existing?.result)
          ? existing.result.some((item: { id?: number }) => Number(item.id) === configuredScriptId)
          : false;
      } catch (error) {
        scriptError = error instanceof Error ? error.message : "No se pudo consultar la instalación.";
      }
    }

    const message = !hasScope
      ? "La conexión actual no tiene permiso scripts. Reconectá Tienda Nube con ese permiso."
      : !configuredScriptId
        ? "Falta configurar TIENDANUBE_WEB_BANNER_SCRIPT_ID."
        : installed
          ? "Script instalado en Tienda Nube."
          : "Script no detectado en Tienda Nube.";

    return NextResponse.json({
      ok: true,
      connected: true,
      canInstall: hasScope && Boolean(configuredScriptId),
      installed,
      hasScriptsScope: hasScope,
      currentScope: account.scope || null,
      scriptId: configuredScriptId || null,
      bannerCounts: counts,
      scriptError,
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo diagnosticar el script.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}

export async function POST() {
  try {
    await requireApiUser();
    const account = await getConnectedTiendanubeAccount();
    if (!account) return NextResponse.json({ error: "Primero conectá Tienda Nube." }, { status: 400 });

    if (!hasScriptsScope(account.scope)) {
      return NextResponse.json({
        error: "La conexión actual no tiene permiso scripts. Agregá el scope scripts en la app de Tienda Nube y reconectá la tienda.",
        needsReconnect: true,
        currentScope: account.scope || null,
      }, { status: 400 });
    }

    const configuredScriptId = scriptId();
    if (!configuredScriptId) {
      return NextResponse.json({
        error: "Falta configurar TIENDANUBE_WEB_BANNER_SCRIPT_ID con el ID del script creado en Partners.",
        needsScriptId: true,
      }, { status: 400 });
    }

    const existing = await tiendanubeScriptsFetch("/scripts", account).catch(() => null);
    const existingScript = Array.isArray(existing?.result)
      ? existing.result.find((item: { id?: number }) => Number(item.id) === configuredScriptId)
      : null;

    if (existingScript) {
      return NextResponse.json({ ok: true, installed: true, script: existingScript, message: "El script ya estaba instalado." });
    }

    const script = await tiendanubeScriptsFetch("/scripts", account, {
      method: "POST",
      body: JSON.stringify({
        script_id: configuredScriptId,
        query_params: "{}",
      }),
    });

    return NextResponse.json({ ok: true, installed: true, script });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo instalar el script.";
    return NextResponse.json({ error: message }, { status: message === "No autorizado." ? 401 : 500 });
  }
}
