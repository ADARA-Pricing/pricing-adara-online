import JSZip from "jszip";
import type { MercadoLibreAccount } from "@/lib/mercadolibre";

export const LOGISTICS_CONTROLS_BUCKET = "logistics-controls";

export function controlPath(batchId: string) {
  return `${batchId}/control-mercado-libre.pdf`;
}

export async function fetchOfficialControl(ids: string[], account: MercadoLibreAccount) {
  const params = new URLSearchParams({ shipment_ids: ids.join(","), response_type: "zpl2" });
  const response = await fetch(`https://api.mercadolibre.com/shipment_labels?${params}`, {
    headers: { Authorization: `Bearer ${account.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Mercado Libre rechazó la hoja de control (${response.status}).`);
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.subarray(0, 2).toString() !== "PK") throw new Error("Mercado Libre devolvió un archivo de control inesperado.");
  const source = await JSZip.loadAsync(raw);
  const control = Object.values(source.files).find((file) => !file.dir && /\.pdf$/i.test(file.name));
  if (!control) throw new Error("Mercado Libre no incluyó la hoja de control PDF.");
  return Buffer.from(await control.async("uint8array"));
}
