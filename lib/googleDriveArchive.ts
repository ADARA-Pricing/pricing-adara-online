import { createSign, randomUUID } from "crypto";

type Batch = { id: string; mode: string; dispatch_day: string; created_at?: string; shipments: unknown[] };

function config() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const parent = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!raw || !parent) return null;
  const service = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  return { service, parent };
}
function base64url(value: string | Buffer) { return Buffer.from(value).toString("base64url"); }
async function token(service: { client_email: string; private_key: string; token_uri?: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: service.client_email, scope: "https://www.googleapis.com/auth/drive", aud: service.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256"); signer.update(`${header}.${claims}`); signer.end();
  const assertion = `${header}.${claims}.${signer.sign(service.private_key, "base64url")}`;
  const response = await fetch(service.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  if (!response.ok) throw new Error(`Google OAuth: ${await response.text()}`);
  return (await response.json() as { access_token: string }).access_token;
}
async function request(accessToken: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`Google Drive: ${await response.text()}`);
  return response;
}
async function folder(accessToken: string, name: string, parent: string) {
  const q = `'${parent}' in parents and name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = await request(accessToken, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  const files = (await found.json() as { files?: Array<{ id: string }> }).files || [];
  if (files[0]) return files[0].id;
  const created = await request(accessToken, "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) });
  return (await created.json() as { id: string }).id;
}
async function upload(accessToken: string, parent: string, name: string, bytes: Uint8Array, mimeType: string) {
  const boundary = `adara-drive-${randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [parent] });
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const suffix = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(prefix), Buffer.from(bytes), Buffer.from(suffix)]);
  await request(accessToken, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}
const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export async function archiveBatchToDrive(batch: Batch, files: Array<{ name: string; bytes: Uint8Array; mimeType: string }>) {
  const setup = config(); if (!setup) return false;
  const accessToken = await token(setup.service);
  const source = new Date(batch.created_at || Date.now());
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(source);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  const year = get("year"), month = Number(get("month")), day = get("day"), hour = get("hour"), minute = get("minute");
  const yearFolder = await folder(accessToken, year, setup.parent);
  const monthFolder = await folder(accessToken, `${String(month).padStart(2, "0")}_${months[month - 1]}`, yearFolder);
  const dayFolder = await folder(accessToken, day, monthFolder);
  const batchFolder = await folder(accessToken, `${hour}-${minute} · ${batch.mode === "self_service" ? "Flex" : "Colecta"} · Lote ${batch.id.slice(0, 8)}`, dayFolder);
  for (const file of files) await upload(accessToken, batchFolder, file.name, file.bytes, file.mimeType);
  return true;
}
