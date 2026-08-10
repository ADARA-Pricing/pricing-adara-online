import { createAdminClient } from "@/lib/supabaseAdmin";

export type MercadoLibreAccount = {
  id?: string;
  meli_user_id: number;
  nickname?: string | null;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  token_type?: string | null;
  scope?: string | null;
};

type TokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  user_id: number;
  refresh_token?: string;
};

export function meliAppConfig() {
  const clientId = process.env.MELI_CLIENT_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;
  const redirectUri = process.env.MELI_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Faltan MELI_CLIENT_ID, MELI_CLIENT_SECRET o MELI_REDIRECT_URI");
  }

  return { clientId, clientSecret, redirectUri };
}

export function meliAuthUrl() {
  const { clientId, redirectUri } = meliAppConfig();
  const url = new URL("https://auth.mercadolibre.com.ar/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

export async function exchangeCodeForToken(code: string) {
  const { clientId, clientSecret, redirectUri } = meliAppConfig();

  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error_description || "No se pudo conectar MercadoLibre.");
  }

  return data as TokenResponse;
}

export async function refreshAccessToken(account: MercadoLibreAccount) {
  if (!account.refresh_token) return account;

  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  const shouldRefresh = !expiresAt || expiresAt - Date.now() < 5 * 60 * 1000;
  if (!shouldRefresh) return account;

  const { clientId, clientSecret } = meliAppConfig();
  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error_description || "No se pudo renovar el token de MercadoLibre.");
  }

  const token = data as TokenResponse;
  const expiresAtIso = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : account.expires_at || null;

  const updated = {
    ...account,
    access_token: token.access_token,
    refresh_token: token.refresh_token || account.refresh_token,
    expires_at: expiresAtIso,
    token_type: token.token_type || account.token_type || "Bearer",
    scope: token.scope || account.scope || null,
  };

  const supabase = createAdminClient();
  await supabase
    .from("mercadolibre_accounts")
    .update({
      access_token: updated.access_token,
      refresh_token: updated.refresh_token,
      expires_at: updated.expires_at,
      token_type: updated.token_type,
      scope: updated.scope,
      updated_at: new Date().toISOString(),
    })
    .eq("meli_user_id", updated.meli_user_id);

  return updated;
}

export async function meliFetch(path: string, account: MercadoLibreAccount, init?: RequestInit) {
  const refreshed = await refreshAccessToken(account);
  const url = path.startsWith("http") ? path : `https://api.mercadolibre.com${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: init?.signal || controller.signal,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${refreshed.access_token}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Timeout MercadoLibre: ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.code || data?.error;
    const message = data?.message || data?.error_description || data?.error || `Error MercadoLibre ${response.status}`;
    throw new Error(`${response.status}${code ? ` ${code}` : ""}: ${message}`);
  }

  return data;
}

export async function getConnectedMeliAccount() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mercadolibre_accounts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as MercadoLibreAccount | null;
}
