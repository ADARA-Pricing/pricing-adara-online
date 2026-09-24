import { normalizeFilter } from "@/lib/pricingData";

const aliases: Record<string, string> = {
  impresoras: "Impresoras",
};

export function canonicalCategory(value: string | null | undefined, existing: string[]) {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  if (!label) return null;
  const normalized = normalizeFilter(label);
  const alias = aliases[normalized];
  if (alias) return alias;
  return existing.find((category) => normalizeFilter(category) === normalized) || label;
}
