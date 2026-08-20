import { createAdminClient } from "@/lib/supabaseAdmin";

export type TiendanubeAccount = {
  id?: string;
  store_id: number;
  store_name?: string | null;
  access_token: string;
  token_type?: string | null;
  scope?: string | null;
  updated_at?: string;
};

type TiendanubeTokenResponse = {
  access_token: string;
  token_type?: string;
  scope?: string;
  user_id: number;
};

export function tiendanubeAppConfig() {
  const appId = process.env.TIENDANUBE_APP_ID || process.env.TIENDANUBE_CLIENT_ID;
  const clientSecret = process.env.TIENDANUBE_CLIENT_SECRET;
  const userAgent = process.env.TIENDANUBE_USER_AGENT || "ADARA Pricing (sistemas@adaragroup.com.ar)";
  const { missing } = tiendanubeConfigStatus();

  if (missing.length) throw new Error(`Faltan ${missing.join(" y ")}.`);

  return { appId: appId as string, clientSecret: clientSecret as string, userAgent };
}

export function tiendanubeConfigStatus() {
  const appId = process.env.TIENDANUBE_APP_ID || process.env.TIENDANUBE_CLIENT_ID;
  const clientSecret = process.env.TIENDANUBE_CLIENT_SECRET;
  const missing = [
    !appId ? "TIENDANUBE_APP_ID" : "",
    !clientSecret ? "TIENDANUBE_CLIENT_SECRET" : "",
  ].filter(Boolean);

  return {
    configured: missing.length === 0,
    missing,
  };
}

export function tiendanubeAuthUrl() {
  const { appId } = tiendanubeAppConfig();
  return `https://www.tiendanube.com/apps/${encodeURIComponent(appId)}/authorize`;
}

export async function exchangeTiendanubeCodeForToken(code: string) {
  const { appId, clientSecret } = tiendanubeAppConfig();
  const response = await fetch("https://www.tiendanube.com/apps/authorize/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error_description || data?.error || "No se pudo conectar Tienda Nube.");
  }

  return data as TiendanubeTokenResponse;
}

export async function tiendanubeFetch(path: string, account: TiendanubeAccount, init?: RequestInit) {
  const { userAgent } = tiendanubeAppConfig();
  const url = path.startsWith("http") ? path : `https://api.tiendanube.com/v1/${account.store_id}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: init?.signal || controller.signal,
      headers: {
        ...(init?.headers || {}),
        Authentication: `bearer ${account.access_token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": userAgent,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Timeout Tienda Nube: ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.description || data?.error || `Error Tienda Nube ${response.status}`;
    throw new Error(`${response.status}: ${message}`);
  }

  return data;
}

export async function getConnectedTiendanubeAccount() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tiendanube_accounts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as TiendanubeAccount | null;
}
