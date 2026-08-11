"use client";

import { ChangeEvent, FormEvent, Fragment, KeyboardEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useRouter } from "next/navigation";
import { BadgeCheck, ChevronDown, ChevronRight, ChevronUp, CircleCheck, Copy, FileSpreadsheet, Info, Package, PackageMinus, Pencil, Plus, RefreshCw, Search, Tags, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { MercadoLibreShippingCost, Product } from "@/lib/types";
import { money, toNumber } from "@/lib/pricing";
import { PageHero } from "@/components/PageHero";


const importHeaders = [
  "SKU",
  "EAN",
  "Nombre",
  "Marca",
  "Modelo",
  "Categoria",
  "Proveedor",
  "Costo sin IVA",
  "IVA %",
  "Peso kg",
  "Alto cm",
  "Ancho cm",
  "Profundidad cm",
  "Garantia meses",
  "Descripcion",
  "Estado"
];

type ImportRow = {
  rowNumber: number;
  payload: {
    sku: string;
    ean: string | null;
    name: string;
    description: string | null;
    brand: string | null;
    model: string | null;
    category: string | null;
    cost_without_vat: number;
    vat_rate: number;
    weight_kg: number | null;
    height_cm: number | null;
    width_cm: number | null;
    depth_cm: number | null;
    supplier: string | null;
    warranty_months: number | null;
    status: Product["status"];
  };
};

type MeliImportRow = {
  meli_item_id: string;
  sku: string;
  sku_source: "meli" | "item_id";
  title: string;
  price: number;
  currency_id: string;
  status: string | null;
  stock: number;
  thumbnail: string | null;
  permalink: string | null;
  date_created: string | null;
  last_updated: string | null;
  exists: boolean;
  publication_count: number;
  publication_ids: string[];
  duplicate_titles?: string[];
  payload: ImportRow["payload"] & {
    stock?: number | null;
  };
};

type MeliImportPreview = {
  total_items: number;
  total_products: number;
  duplicate_publications: number;
  missing: number;
  existing: number;
  without_sku: number;
  rows: MeliImportRow[];
};

type ProductEditorTab = "manual" | "excel" | "meli";

function isProductRowInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a, input, select, textarea, label, summary, [contenteditable='true'], [data-no-row-toggle]"));
}

function normalizeProductSku(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function uniqueShippingRows(rows: MercadoLibreShippingCost[]) {
  const map = new Map<string, MercadoLibreShippingCost>();

  rows.forEach((row) => {
    const key = row.id
      || [
        row.meli_item_id || "sin-mla",
        row.product_id || "sin-producto",
        normalizeProductSku(row.sku),
        row.meli_listing_type_id || "sin-tipo",
        row.meli_price ?? "sin-precio",
        row.meli_installments_text || "sin-cuotas",
      ].join("|");

    if (!map.has(key)) map.set(key, row);
  });

  return [...map.values()];
}

function formatTechnicalLabel(value?: string | null) {
  if (!value) return "-";
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function productNoteSummary(value?: string | null) {
  if (!value || value === "-") return { label: "-", detail: "" };
  const itemId = value.match(/MLA\d+/i)?.[0]?.toUpperCase();
  if (/mercadolibre/i.test(value) || itemId) {
    return {
      label: itemId ? `MercadoLibre · ${itemId}` : "MercadoLibre",
      detail: value,
    };
  }
  return { label: value, detail: value };
}

function publicationTags(publication: MercadoLibreShippingCost) {
  return Array.isArray(publication.meli_tags) ? publication.meli_tags.map((tag) => String(tag)) : [];
}

function publicationBranchKind(publication: MercadoLibreShippingCost): "catalog_listing" | "seller_listing" {
  return publicationTags(publication).includes("user_product_listing") ? "catalog_listing" : "seller_listing";
}

function publicationBranchLabel(branchKind: "catalog_listing" | "seller_listing") {
  return branchKind === "catalog_listing" ? "Catálogo ML" : "Publicación vendedor";
}

function normalizedPublicationTitle(publication: MercadoLibreShippingCost) {
  return (publication.meli_title || publication.sku || publication.meli_item_id || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(1|3|6|9|12)\s*(x|cuotas?)\b/g, "")
    .replace(/\b(clasica|premium|sin cuotas|con cuotas)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function publicationFamilyKey(publication: MercadoLibreShippingCost) {
  const sku = normalizeProductSku(publication.sku);
  const branchKind = publicationBranchKind(publication);
  const catalogKey = publication.meli_catalog_product_id
    ? `catalog:${publication.meli_catalog_product_id}`
    : `domain:${publication.meli_domain_id || "sin-domain"}:${normalizedPublicationTitle(publication)}`;
  return `${sku || "sin-sku"}|${catalogKey}|${branchKind}`;
}

function groupProductPublications(publications: MercadoLibreShippingCost[]) {
  const groups = new Map<string, {
    key: string;
    title: string;
    branchKind: "catalog_listing" | "seller_listing";
    itemIds: string[];
    hasCatalog: boolean;
    rows: MercadoLibreShippingCost[];
  }>();

  publications.forEach((publication) => {
    const key = publicationFamilyKey(publication) || publication.meli_item_id || publication.sku || "publicacion";
    const current = groups.get(key) || {
      key,
      title: publication.meli_title || publication.meli_item_id || "Publicación ML",
      branchKind: publicationBranchKind(publication),
      itemIds: [],
      hasCatalog: false,
      rows: [],
    };

    if (publication.meli_item_id && !current.itemIds.includes(publication.meli_item_id)) {
      current.itemIds.push(publication.meli_item_id);
    }
    current.hasCatalog = current.hasCatalog || Boolean(publication.meli_catalog_listing);
    current.rows.push(publication);
    groups.set(key, current);
  });

  return [...groups.values()].sort((a, b) => {
    if (a.branchKind !== b.branchKind) return a.branchKind === "catalog_listing" ? -1 : 1;
    return a.title.localeCompare(b.title, "es");
  });
}

function sharedStockFromPublications(publications: MercadoLibreShippingCost[]) {
  const activePublications = publications.filter((publication) => publication.meli_status === "active");
  const stockSourcePublications = activePublications.length ? activePublications : publications;
  const stocks = stockSourcePublications
    .map((publication) => Number(publication.meli_stock || 0))
    .filter((stock) => Number.isFinite(stock) && stock >= 0);
  return stocks.length ? Math.max(...stocks) : 0;
}

function normalizeHeader(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function readCell(row: Record<string, unknown>, labels: string[]) {
  for (const label of labels) {
    const target = normalizeHeader(label);
    const foundKey = Object.keys(row).find((key) => normalizeHeader(key) === target);
    if (foundKey) return row[foundKey];
  }
  return "";
}

function parseMoneyValue(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  let text = String(value).trim();
  if (!text) return 0;

  text = text.replace(/\$/g, "").replace(/%/g, "").replace(/\s/g, "");

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma && hasDot) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    text = text.replace(",", ".");
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseMoneyValue(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStatus(value: unknown): Product["status"] {
  const text = String(value || "active").trim().toLowerCase();
  if (["pausado", "paused"].includes(text)) return "paused";
  if (["discontinuado", "discontinued"].includes(text)) return "discontinued";
  return "active";
}

function buildProductPayload(row: Record<string, unknown>, rowNumber: number): ImportRow {
  const sku = String(readCell(row, ["SKU"]) || "").trim().toUpperCase();
  const name = String(readCell(row, ["Nombre", "Producto"]) || "").trim();
  const vatRaw = parseMoneyValue(readCell(row, ["IVA %", "IVA"]));
  const vat = vatRaw === 10.5 || vatRaw === 10.5 ? 10.5 : 21;

  if (!sku) throw new Error(`Fila ${rowNumber}: falta SKU.`);
  if (!name) throw new Error(`Fila ${rowNumber}: falta Nombre.`);

  return {
    rowNumber,
    payload: {
      sku,
      ean: String(readCell(row, ["EAN"]) || "").trim() || null,
      name,
      description: String(readCell(row, ["Descripcion", "Descripción"]) || "").trim() || null,
      brand: String(readCell(row, ["Marca"]) || "").trim() || null,
      model: String(readCell(row, ["Modelo"]) || "").trim() || null,
      category: String(readCell(row, ["Categoria", "Categoría"]) || "").trim() || null,
      cost_without_vat: parseMoneyValue(readCell(row, ["Costo sin IVA", "Costo s/IVA"])),
      vat_rate: vat,
      weight_kg: parseOptionalNumber(readCell(row, ["Peso kg"])),
      height_cm: parseOptionalNumber(readCell(row, ["Alto cm"])),
      width_cm: parseOptionalNumber(readCell(row, ["Ancho cm"])),
      depth_cm: parseOptionalNumber(readCell(row, ["Profundidad cm"])),
      supplier: String(readCell(row, ["Proveedor"]) || "").trim() || null,
      warranty_months: parseOptionalNumber(readCell(row, ["Garantia meses", "Garantía meses"])),
      status: parseStatus(readCell(row, ["Estado"]))
    }
  };
}

const emptyProduct: Product = {
  sku: "",
  ean: "",
  name: "",
  description: "",
  brand: "",
  model: "",
  category: "",
  cost_without_vat: 0,
  vat_rate: 21,
  weight_kg: null,
  height_cm: null,
  width_cm: null,
  depth_cm: null,
  stock: 0,
  supplier: "",
  warranty_months: null,
  status: "active"
};


function statusLabel(status?: Product["status"]) {
  if (status === "paused") return "Pausado";
  if (status === "discontinued") return "Discontinuado";
  return "Activo";
}

function meliStatusLabel(status?: string | null) {
  if (!status) return "Sin publicar";
  const labels: Record<string, string> = {
    active: "Activa",
    paused: "Pausada",
    closed: "Cerrada",
    under_review: "En revisión",
  };
  return labels[status] || status;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

function dimensions(product: Product) {
  const values = [product.height_cm, product.width_cm, product.depth_cm]
    .map((value) => Number(value || 0))
    .filter((value) => value > 0);
  return values.length ? `${values.join(" × ")} cm` : "-";
}

function productInitial(product: Product) {
  const value = product.brand || product.name || product.sku || "P";
  return value.slice(0, 2).toUpperCase();
}

function productImage(shippings: MercadoLibreShippingCost[]) {
  return shippings.find((shipping) => Boolean(shipping.meli_thumbnail))?.meli_thumbnail || null;
}

function bestMeliPrice(shippings: MercadoLibreShippingCost[]) {
  const activePrices = shippings
    .filter((shipping) => shipping.meli_status === "active")
    .map((shipping) => Number(shipping.meli_price || shipping.meli_promo_price || 0))
    .filter((price) => Number.isFinite(price) && price > 0);
  const prices = activePrices.length
    ? activePrices
    : shippings
        .map((shipping) => Number(shipping.meli_price || shipping.meli_promo_price || 0))
        .filter((price) => Number.isFinite(price) && price > 0);

  return prices.length ? Math.min(...prices) : null;
}

function moneyRange(values: Array<number | null | undefined>) {
  const amounts = values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value) && value > 0);
  if (!amounts.length) return "-";
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  return min === max ? money(min) : `${money(min)} - ${money(max)}`;
}

function installmentCampaignTag(shipping?: MercadoLibreShippingCost | null) {
  if (!shipping?.meli_tags || !Array.isArray(shipping.meli_tags)) return null;
  const tags = shipping.meli_tags.map((tag) => String(tag).toLowerCase());
  if (tags.includes("3x_campaign")) return "3x_campaign";
  if (tags.includes("9x_campaign")) return "9x_campaign";
  if (tags.includes("12x_campaign")) return "12x_campaign";
  return null;
}

function rawInstallmentLabel(shipping?: MercadoLibreShippingCost | null) {
  if (!shipping) return "Sin dato ML";
  const campaignTag = installmentCampaignTag(shipping);
  if (campaignTag === "3x_campaign") return "3 cuotas";
  if (campaignTag === "9x_campaign") return "9 cuotas";
  if (campaignTag === "12x_campaign") return "12 cuotas";

  const saleTerms = Array.isArray(shipping.meli_sale_terms) ? shipping.meli_sale_terms : [];
  const searchable = [
    shipping.meli_listing_type_id,
    shipping.meli_listing_type_name,
    ...(Array.isArray(shipping.meli_tags) ? shipping.meli_tags : []),
    ...saleTerms.flatMap((term: any) => [term?.id, term?.name, term?.value_name, term?.value_id]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const match = searchable.match(/(\d{1,2})\s*(x|cuotas?|installments?)/i);
  if (match?.[1]) return `${match[1]} cuotas`;
  if (searchable.includes("gold_pro") || searchable.includes("premium")) return "6 cuotas";
  if (searchable.includes("gold_special") || searchable.includes("clásica") || searchable.includes("clasica")) return "Clásica / 1 pago";
  if (shipping.meli_installments_text) return shipping.meli_installments_text;
  return "Sin dato ML";
}

function installmentNumberFromLabel(label: string) {
  const normalized = label.toLowerCase();
  const match = normalized.match(/(\d{1,2})\s*cuotas?/i);
  if (match?.[1]) return Number(match[1]);
  if (normalized.includes("1 pago") || normalized.includes("clásica") || normalized.includes("clasica")) return 1;
  return null;
}

function inferredInstallmentNumber(shipping: MercadoLibreShippingCost, _shippings: MercadoLibreShippingCost[]) {
  const rawLabel = rawInstallmentLabel(shipping);
  const explicit = installmentNumberFromLabel(rawLabel);
  if (explicit) return explicit;
  return null;
}

function installmentLabel(shipping: MercadoLibreShippingCost, shippings: MercadoLibreShippingCost[]) {
  const rawLabel = rawInstallmentLabel(shipping);
  if (rawLabel !== "Sin dato ML") return rawLabel;

  const inferred = inferredInstallmentNumber(shipping, shippings);
  if (inferred) return `${inferred === 1 ? "Clásica / 1 pago" : `${inferred} cuotas`}`;

  return rawLabel;
}

function sortPublicationsByInstallments(shippings: MercadoLibreShippingCost[]) {
  return [...shippings].sort((a, b) => {
    const aInstallments = inferredInstallmentNumber(a, shippings) || 999;
    const bInstallments = inferredInstallmentNumber(b, shippings) || 999;
    if (aInstallments !== bInstallments) return aInstallments - bInstallments;

    const aPrice = Number(a.meli_price || 0);
    const bPrice = Number(b.meli_price || 0);
    if (aPrice !== bPrice) return aPrice - bPrice;

    return (a.meli_title || "").localeCompare(b.meli_title || "", "es");
  });
}
export default function ProductsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [shippingCosts, setShippingCosts] = useState<MercadoLibreShippingCost[]>([]);
  const [form, setForm] = useState<Product>(emptyProduct);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [meliStatusFilter, setMeliStatusFilter] = useState("");
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [expandedPublicationGroups, setExpandedPublicationGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [activeProductTab, setActiveProductTab] = useState<ProductEditorTab>("manual");
  const [meliPreview, setMeliPreview] = useState<MeliImportPreview | null>(null);
  const [meliPreviewLoading, setMeliPreviewLoading] = useState(false);
  const [meliImporting, setMeliImporting] = useState(false);
  const [selectedMeliSkus, setSelectedMeliSkus] = useState<string[]>([]);
  const [meliImportSearch, setMeliImportSearch] = useState("");
  const [meliImportStatusFilter, setMeliImportStatusFilter] = useState("");
  const [meliImportCategoryFilter, setMeliImportCategoryFilter] = useState("");
  const [meliImportKindFilter, setMeliImportKindFilter] = useState("missing");
  const [meliImportRecentFilter, setMeliImportRecentFilter] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  const costWithVatPreview = useMemo(() => {
    const cost = Number(form.cost_without_vat || 0);
    const vat = Number(form.vat_rate || 0);
    return cost * (1 + vat / 100);
  }, [form.cost_without_vat, form.vat_rate]);

  const selectedMeliSet = useMemo(() => new Set(selectedMeliSkus), [selectedMeliSkus]);

  const meliImportCategories = useMemo(() => {
    const values = new Set<string>();
    meliPreview?.rows.forEach((row) => {
      const category = row.payload.category?.trim();
      if (category) values.add(category);
    });
    return [...values].sort((a, b) => a.localeCompare(b, "es"));
  }, [meliPreview]);

  const filteredMeliRows = useMemo(() => {
    const search = meliImportSearch.trim().toLowerCase();
    const recentDays = meliImportRecentFilter ? Number(meliImportRecentFilter) : 0;
    const recentCutoff = recentDays ? Date.now() - recentDays * 24 * 60 * 60 * 1000 : 0;

    return (meliPreview?.rows || []).filter((row) => {
      if (meliImportKindFilter === "missing" && row.exists) return false;
      if (meliImportKindFilter === "existing" && !row.exists) return false;
      if (meliImportStatusFilter && row.status !== meliImportStatusFilter) return false;
      if (meliImportCategoryFilter && row.payload.category !== meliImportCategoryFilter) return false;
      if (recentCutoff) {
        const createdAt = row.date_created ? new Date(row.date_created).getTime() : 0;
        if (!createdAt || createdAt < recentCutoff) return false;
      }
      if (search) {
        const haystack = [row.sku, row.title, row.meli_item_id, row.payload.category, row.payload.brand, row.payload.model]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [meliPreview, meliImportSearch, meliImportStatusFilter, meliImportCategoryFilter, meliImportKindFilter, meliImportRecentFilter]);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function loadProducts() {
    setLoading(true);
    setError(null);

    const [productsResponse, shippingResponse] = await Promise.all([
      supabase.from("products").select("*").order("updated_at", { ascending: false }),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true),
    ]);

    setLoading(false);

    if (productsResponse.error) {
      setError(productsResponse.error.message);
      return;
    }

    if (shippingResponse.error) {
      setError(shippingResponse.error.message);
      return;
    }

    setProducts((productsResponse.data || []) as Product[]);
    setShippingCosts((shippingResponse.data || []) as MercadoLibreShippingCost[]);
  }

  useEffect(() => {
    checkSession();
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function update<K extends keyof Product>(key: K, value: Product[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePublicationGroup(key: string) {
    setExpandedPublicationGroups((current) => ({ ...current, [key]: !current[key] }));
  }

  function editProduct(product: Product) {
    setActiveProductTab("manual");
    setEditorOpen(true);
    setForm({ ...emptyProduct, ...product });
    setMessage(`Editando SKU ${product.sku}. Al guardar se actualiza el producto.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function duplicateProduct(product: Product) {
    setActiveProductTab("manual");
    setEditorOpen(true);
    setForm({
      ...emptyProduct,
      ...product,
      id: undefined,
      sku: `${product.sku}-COPY`,
      name: `${product.name} copia`,
    });
    setMessage(`Duplicando SKU ${product.sku}. Revisá el nuevo SKU antes de guardar.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openNewProductModal() {
    setForm(emptyProduct);
    setActiveProductTab("manual");
    setEditorOpen(true);
    setMessage(null);
    setError(null);
  }

  function openImportModal() {
    setActiveProductTab("excel");
    setEditorOpen(true);
    setMessage(null);
    setError(null);
  }

  async function loadMeliImportPreview() {
    setMeliPreviewLoading(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/mercadolibre/import-products", { method: "GET" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo leer MercadoLibre.");
      const preview = data as MeliImportPreview;
      setMeliPreview(preview);
      setSelectedMeliSkus([]);
      setMessage(`MercadoLibre leido: ${preview.total_items || 0} publicaciones agrupadas en ${preview.total_products || preview.rows.length} SKU. ${preview.missing || 0} productos nuevos disponibles.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer MercadoLibre.");
    } finally {
      setMeliPreviewLoading(false);
    }
  }

  function openMeliImportModal() {
    setActiveProductTab("meli");
    setEditorOpen(true);
    setMessage(null);
    setError(null);
    setMeliPreview(null);
    setSelectedMeliSkus([]);
    setMeliImportSearch("");
    setMeliImportStatusFilter("");
    setMeliImportCategoryFilter("");
    setMeliImportKindFilter("missing");
    setMeliImportRecentFilter("");
    loadMeliImportPreview();
  }

  function closeEditorModal() {
    setEditorOpen(false);
  }

  async function deleteProduct(product: Product) {
    const ok = window.confirm(`¿Seguro que querés eliminar el producto ${product.sku} - ${product.name}?`);
    if (!ok) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    const { error } = await supabase.from("products").delete().eq("sku", product.sku);
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (form.sku === product.sku) setForm(emptyProduct);
    setMessage(`Producto eliminado: ${product.sku}`);
    await loadProducts();
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const cleanSku = form.sku.trim().toUpperCase();
    if (!cleanSku) {
      setError("El SKU es obligatorio.");
      setSaving(false);
      return;
    }

    const payload = {
      sku: cleanSku,
      ean: form.ean?.trim() || null,
      name: form.name.trim(),
      description: form.description?.trim() || null,
      brand: form.brand?.trim() || null,
      model: form.model?.trim() || null,
      category: form.category?.trim() || null,
      cost_without_vat: Number(form.cost_without_vat),
      vat_rate: Number(form.vat_rate),
      weight_kg: form.weight_kg ?? null,
      height_cm: form.height_cm ?? null,
      width_cm: form.width_cm ?? null,
      depth_cm: form.depth_cm ?? null,
      supplier: form.supplier?.trim() || null,
      warranty_months: form.warranty_months ?? null,
      status: form.status || "active",
    };

    if (!payload.name) {
      setError("El nombre es obligatorio.");
      setSaving(false);
      return;
    }

    const existing = products.find((product) => product.sku === cleanSku);

    const { error } = await supabase
      .from("products")
      .upsert(payload, { onConflict: "sku" })
      .select()
      .single();

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    let syncMessage = "";
    try {
      const syncResponse = await fetch("/api/mercadolibre/sync-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: [cleanSku] }),
      });
      const syncData = await syncResponse.json();

      if (syncResponse.ok) {
        const matched = Number(syncData?.matched || 0);
        const updated = Number(syncData?.updated || 0);
        const withoutCost = Number(syncData?.no_shipping_cost || 0);

        syncMessage = matched > 0
          ? ` MercadoLibre: ${matched} publicacion(es) vinculada(s), ${updated} envio(s) actualizados${withoutCost ? `, ${withoutCost} sin costo devuelto` : ""}.`
          : " MercadoLibre: no encontramos publicaciones con ese SKU.";
      } else {
        syncMessage = ` MercadoLibre no sincronizado: ${syncData?.error || "no se pudo consultar la cuenta"}.`;
      }
    } catch (err) {
      syncMessage = ` MercadoLibre no sincronizado: ${err instanceof Error ? err.message : "error de conexion"}.`;
    }

    setSaving(false);
    setMessage(`${existing ? `Producto actualizado: ${cleanSku}` : `Producto creado: ${cleanSku}`}.${syncMessage}`);
    setForm(emptyProduct);
    setEditorOpen(false);
    await loadProducts();
  }

  function downloadTemplate() {
    const sample = [
      {
        "SKU": "TVEN043GTV01",
        "EAN": "7790000000000",
        "Nombre": "Smart TV Enova 43 Google TV",
        "Marca": "Enova",
        "Modelo": "43GTV",
        "Categoria": "TV",
        "Proveedor": "Radio Victoria",
        "Costo sin IVA": 241332,
        "IVA %": 21,
        "Peso kg": "",
        "Alto cm": "",
        "Ancho cm": "",
        "Profundidad cm": "",
        "Garantia meses": 12,
        "Descripcion": "",
        "Estado": "active"
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(sample, { header: importHeaders });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Productos");
    XLSX.writeFile(workbook, "plantilla_productos_adara.xlsx");
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setMessage(null);
    setError(null);
    setImportRows([]);
    setImportErrors([]);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });

      if (rows.length === 0) {
        setImportErrors(["El archivo no tiene productos para importar."]);
        return;
      }

      const parsedRows: ImportRow[] = [];
      const errors: string[] = [];

      rows.forEach((row, index) => {
        const hasAnyValue = Object.values(row).some((value) => String(value || "").trim() !== "");
        if (!hasAnyValue) return;
        try {
          parsedRows.push(buildProductPayload(row, index + 2));
        } catch (err) {
          errors.push(err instanceof Error ? err.message : `Fila ${index + 2}: error de lectura.`);
        }
      });

      setImportRows(parsedRows);
      setImportErrors(errors);

      if (parsedRows.length > 0) {
        setMessage(`Archivo leído: ${parsedRows.length} productos listos para importar.`);
      }
    } catch (err) {
      setImportErrors([err instanceof Error ? err.message : "No se pudo leer el archivo."]);
    }
  }

  async function importProducts() {
    if (importRows.length === 0) return;

    setImporting(true);
    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = importRows.map((row) => row.payload);
    const { error } = await supabase.from("products").upsert(payload, { onConflict: "sku" });

    setImporting(false);
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(`Carga masiva finalizada: ${payload.length} productos creados o actualizados.`);
    setImportRows([]);
    setImportErrors([]);
    await loadProducts();
  }

  function toggleMeliSku(sku: string, checked: boolean) {
    setSelectedMeliSkus((current) => {
      if (checked) return current.includes(sku) ? current : [...current, sku];
      return current.filter((item) => item !== sku);
    });
  }

  function selectFilteredMissingMeli() {
    setSelectedMeliSkus(filteredMeliRows.filter((row) => !row.exists).map((row) => row.sku));
  }

  function clearMeliSelection() {
    setSelectedMeliSkus([]);
  }

  async function importMeliProducts() {
    if (selectedMeliSkus.length === 0) {
      setError("Selecciona al menos un producto nuevo para importar.");
      return;
    }

    setMeliImporting(true);
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/mercadolibre/import-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import_existing: false, selected_skus: selectedMeliSkus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo importar desde MercadoLibre.");

      const importedCount = Number(data.imported || 0);
      let syncMessage = "";

      if (importedCount > 0) {
        setMessage(`Importacion MercadoLibre finalizada: ${importedCount} productos nuevos creados. Sincronizando fotos, envios y publicaciones...`);
        const syncResponse = await fetch("/api/mercadolibre/sync-shipping", { method: "POST" });
        const syncData = await syncResponse.json();
        if (!syncResponse.ok) {
          throw new Error(syncData?.error || "Los productos se importaron, pero no se pudo sincronizar MercadoLibre.");
        }

        syncMessage = ` Sincronizacion ML: ${syncData.matched || 0} publicaciones vinculadas, ${syncData.updated || 0} costos de envio actualizados, ${syncData.no_shipping_cost || 0} sin costo devuelto.`;
      }

      setMessage(`Importacion MercadoLibre finalizada: ${importedCount} productos nuevos creados. Existentes omitidos: ${data.skipped_existing || 0}. No seleccionados: ${data.skipped_unselected || 0}.${syncMessage}`);
      setMeliPreview(null);
      await loadProducts();
      await loadMeliImportPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar desde MercadoLibre.");
    } finally {
      setMeliImporting(false);
      setSaving(false);
    }
  }

  const categories = useMemo(() => {
    const values = new Set(products.map((product) => product.category).filter(Boolean) as string[]);
    return [...values].sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);

  const enriched = useMemo(() => {
    const groupedProducts = new Map<string, Product[]>();

    products.forEach((product) => {
      const key = normalizeProductSku(product.sku) || product.id || product.sku;
      const current = groupedProducts.get(key) || [];
      current.push(product);
      groupedProducts.set(key, current);
    });

    return [...groupedProducts.values()].map((groupProducts) => {
      const product = groupProducts[0];
      const productIds = new Set(groupProducts.map((item) => item.id).filter(Boolean) as string[]);
      const productSkus = new Set(groupProducts.map((item) => normalizeProductSku(item.sku)).filter(Boolean));
      const shippings = uniqueShippingRows(
        shippingCosts.filter((item) => {
          const matchesProduct = Boolean(item.product_id && productIds.has(item.product_id));
          const matchesSku = Boolean(item.sku && productSkus.has(normalizeProductSku(item.sku)));
          return matchesProduct || matchesSku;
        }),
      ).sort((a, b) => {
        const aActive = a.meli_status === "active" ? 1 : 0;
        const bActive = b.meli_status === "active" ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return String(b.updated_at || b.meli_last_sync_at || "").localeCompare(String(a.updated_at || a.meli_last_sync_at || ""));
      });

      return { product, products: groupProducts, shippings };
    });
  }, [products, shippingCosts]);

  const filtered = useMemo(() => {
    const normalized = query.toLowerCase().trim();

    return enriched.filter(({ product, shippings }) => {
      const text = [
        product.sku,
        product.ean,
        product.name,
        product.brand,
        product.model,
        product.category,
        ...shippings.flatMap((shipping) => [shipping?.meli_item_id, shipping?.meli_title]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesQuery = !normalized || text.includes(normalized);
      const matchesCategory = !categoryFilter || product.category === categoryFilter;
      const matchesMlStatus = !meliStatusFilter || (meliStatusFilter === "none" ? shippings.length === 0 : shippings.some((shipping) => shipping?.meli_status === meliStatusFilter));
      return matchesQuery && matchesCategory && matchesMlStatus;
    });
  }, [enriched, query, categoryFilter, meliStatusFilter]);

  const metrics = useMemo(() => {
    const total = products.length;
    const withMl = enriched.filter(({ shippings }) => shippings.some((shipping) => Boolean(shipping?.meli_item_id))).length;
    const withoutMl = Math.max(total - withMl, 0);
    const linkedPublications = shippingCosts.filter((shipping) => Boolean(shipping?.meli_item_id));
    const activePublications = linkedPublications.filter((shipping) => shipping.meli_status === "active").length;
    const pausedPublications = linkedPublications.filter((shipping) => shipping.meli_status === "paused").length;
    const latestSync = linkedPublications
      .map((shipping) => shipping.meli_last_sync_at || shipping.updated_at)
      .filter(Boolean)
      .sort()
      .reverse()[0];
    const syncedToday = enriched.filter(({ shippings }) => {
      const now = new Date();
      return shippings.some((shipping) => {
        if (!shipping?.meli_last_sync_at) return false;
        const date = new Date(shipping.meli_last_sync_at);
        return date.toDateString() === now.toDateString();
      });
    }).length;

    return { total, withMl, withoutMl, syncedToday, activePublications, pausedPublications, latestSync };
  }, [products, enriched, shippingCosts]);

  return (
    <main className="container wide products-advanced-page">
      <PageHero
        title="Productos"
        description="Visualizá, filtrá y administrá tu catálogo."
        onRefresh={loadProducts}
        icon={<Package aria-hidden="true" />}
      />

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="products-toolbar-card card">
        <div className="products-toolbar-grid">
          <div className="field">
            <label>Buscar producto</label>
            <label className="search-control">
              <Search aria-hidden="true" />
              <input className="form-control search-field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto..." />
            </label>
          </div>
          <div className="field">
            <label>Categoría</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Todas las categorías</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Estado ML</label>
            <select value={meliStatusFilter} onChange={(e) => setMeliStatusFilter(e.target.value)}>
              <option value="">Todos los estados ML</option>
              <option value="active">Activa</option>
              <option value="paused">Pausada</option>
              <option value="closed">Cerrada</option>
              <option value="none">Sin publicar</option>
            </select>
          </div>
          <div className="products-toolbar-actions">
            <button className="button products-primary-button" type="button" onClick={openNewProductModal}>
              <Plus aria-hidden="true" />
              Nuevo producto
            </button>
            <button className="button ghost products-secondary-button" type="button" onClick={openImportModal}>
              <FileSpreadsheet aria-hidden="true" />
              Importar Excel
            </button>
            <button className="button ghost products-secondary-button" type="button" onClick={openMeliImportModal}>
              <RefreshCw aria-hidden="true" />
              Importar desde ML
            </button>
          </div>
        </div>
      </section>

      <section className="products-kpi-grid">
        <div className="kpi-card product-kpi-card">
          <div>
            <p>Total productos</p>
            <strong>{metrics.total}</strong>
            <small>100% del catálogo</small>
          </div>
        </div>
        <div className="kpi-card product-kpi-card">
          <div>
            <p>Con ML</p>
            <strong>{metrics.withMl}</strong>
            <small>{metrics.total ? `${Math.round((metrics.withMl / metrics.total) * 100)}% del catálogo` : "0% del catálogo"}</small>
          </div>
        </div>
        <div className="kpi-card product-kpi-card">
          <div>
            <p>Activas</p>
            <strong>{metrics.activePublications}</strong>
            <small>{metrics.pausedPublications} pausadas</small>
          </div>
        </div>
        <div className="kpi-card product-kpi-card">
          <div>
            <p>Sin ML</p>
            <strong>{metrics.withoutMl}</strong>
            <small>{metrics.total ? `${Math.round((metrics.withoutMl / metrics.total) * 100)}% del catálogo` : "0% del catálogo"}</small>
          </div>
        </div>
      </section>

      <section className="card products-sync-summary">
        <div className="products-sync-status">
          <CircleCheck aria-hidden="true" />
          <strong>MercadoLibre sincronizado</strong>
          <span>
            Última actualización: {formatDateTime(metrics.latestSync)} · {metrics.syncedToday} productos actualizados · {metrics.activePublications + metrics.pausedPublications} publicaciones vinculadas
          </span>
        </div>
      </section>

      {editorOpen && (
        <div className="modal-backdrop" onClick={closeEditorModal}>
          <section className="modal-card product-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="header product-editor-header" style={{ alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 8 }}>
                  {activeProductTab === "manual"
                    ? "Nuevo / actualizar producto"
                    : activeProductTab === "excel"
                      ? "Carga masiva con Excel"
                      : "Importar productos desde MercadoLibre"}
                </h2>
                <p className="small" style={{ margin: 0 }}>
                  {activeProductTab === "manual"
                    ? "Si el SKU ya existe, la app actualiza el producto. Si no existe, lo crea."
                    : activeProductTab === "excel"
                      ? "Descarga la plantilla, completala en Excel y subila. Si el SKU ya existe, se actualiza; si no existe, se crea."
                      : "Traemos tus publicaciones activas y pausadas de MercadoLibre, las agrupamos por SKU para evitar duplicados, y vos elegis cuales crear."}
                </p>
              </div>
              <div className="actions product-editor-controls" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                <button className={activeProductTab === "manual" ? "button products-primary-button" : "button ghost products-secondary-button"} type="button" onClick={() => setActiveProductTab("manual")}>Carga manual</button>
                <button className={activeProductTab === "excel" ? "button products-primary-button" : "button ghost products-secondary-button"} type="button" onClick={() => setActiveProductTab("excel")}>Carga masiva Excel</button>
                <button className={activeProductTab === "meli" ? "button products-primary-button" : "button ghost products-secondary-button"} type="button" onClick={() => {
                  setActiveProductTab("meli");
                  if (!meliPreview && !meliPreviewLoading) loadMeliImportPreview();
                }}>MercadoLibre</button>
                <button className="button ghost products-secondary-button" type="button" onClick={closeEditorModal}>Cerrar</button>
              </div>
            </div>

            {activeProductTab === "manual" ? (
              <form onSubmit={saveProduct}>
                <div className="grid">
                  <div className="field"><label>SKU *</label><input value={form.sku} onChange={(e) => update("sku", e.target.value)} placeholder="TVEN043GTV01" required /></div>
                  <div className="field"><label>EAN</label><input value={form.ean || ""} onChange={(e) => update("ean", e.target.value)} placeholder="779..." /></div>
                  <div className="field"><label>Nombre *</label><input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Smart TV Enova 43 Google TV" required /></div>
                  <div className="field"><label>Estado</label><select value={form.status} onChange={(e) => update("status", e.target.value as Product["status"])}><option value="active">Activo</option><option value="paused">Pausado</option><option value="discontinued">Discontinuado</option></select></div>
                </div>

                <div className="grid" style={{ marginTop: 12 }}>
                  <div className="field"><label>Marca</label><input value={form.brand || ""} onChange={(e) => update("brand", e.target.value)} placeholder="Enova" /></div>
                  <div className="field"><label>Modelo</label><input value={form.model || ""} onChange={(e) => update("model", e.target.value)} placeholder="43GTV" /></div>
                  <div className="field"><label>Categoría</label><input value={form.category || ""} onChange={(e) => update("category", e.target.value)} placeholder="TV" /></div>
                  <div className="field"><label>Proveedor</label><input value={form.supplier || ""} onChange={(e) => update("supplier", e.target.value)} placeholder="Radio Victoria" /></div>
                </div>

                <div className="grid" style={{ marginTop: 12 }}>
                  <div className="field"><label>Costo sin IVA *</label><input type="number" step="0.01" min="0" value={form.cost_without_vat} onChange={(e) => update("cost_without_vat", Number(e.target.value))} required /></div>
                  <div className="field"><label>IVA % *</label><select value={form.vat_rate} onChange={(e) => update("vat_rate", Number(e.target.value) as 21 | 10.5)}><option value={21}>21%</option><option value={10.5}>10,5%</option></select></div>
                  <div className="field"><label>Costo con IVA automático</label><input value={money(costWithVatPreview)} disabled /></div>
                </div>

                <div className="grid" style={{ marginTop: 12 }}>
                  <div className="field"><label>Peso kg</label><input type="number" step="0.001" value={form.weight_kg ?? ""} onChange={(e) => update("weight_kg", toNumber(e.target.value))} /></div>
                  <div className="field"><label>Alto cm</label><input type="number" step="0.01" value={form.height_cm ?? ""} onChange={(e) => update("height_cm", toNumber(e.target.value))} /></div>
                  <div className="field"><label>Ancho cm</label><input type="number" step="0.01" value={form.width_cm ?? ""} onChange={(e) => update("width_cm", toNumber(e.target.value))} /></div>
                  <div className="field"><label>Profundidad cm</label><input type="number" step="0.01" value={form.depth_cm ?? ""} onChange={(e) => update("depth_cm", toNumber(e.target.value))} /></div>
                </div>

                <div className="grid-2" style={{ marginTop: 12 }}>
                  <div className="field"><label>Garantía meses</label><input type="number" min="0" value={form.warranty_months ?? ""} onChange={(e) => update("warranty_months", toNumber(e.target.value))} /></div>
                  <div className="field"><label>Descripción</label><textarea value={form.description || ""} onChange={(e) => update("description", e.target.value)} placeholder="Descripción interna o comercial" /></div>
                </div>

                <div className="actions" style={{ marginTop: 16 }}>
                  <button className="button products-primary-button" disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar producto"}</button>
                  <button className="button ghost products-secondary-button" type="button" onClick={() => setForm(emptyProduct)}>Limpiar</button>
                </div>
              </form>
            ) : activeProductTab === "excel" ? (
              <div>
                <div className="header" style={{ alignItems: "flex-start", gap: 16 }}>
                  <p className="small" style={{ marginTop: 0 }}>
                    Columnas obligatorias: <strong>SKU</strong>, <strong>Nombre</strong>, <strong>Costo sin IVA</strong> e <strong>IVA %</strong>.
                  </p>
                  <div className="actions">
                    <button className="button ghost products-secondary-button" type="button" onClick={downloadTemplate}>Descargar plantilla</button>
                    <label className="button products-primary-button" style={{ cursor: "pointer" }}>
                      Subir Excel
                      <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ display: "none" }} />
                    </label>
                  </div>
                </div>

                {importErrors.length > 0 && (
                  <div className="message error" style={{ marginTop: 12 }}>
                    {importErrors.slice(0, 8).map((item) => <div key={item}>{item}</div>)}
                    {importErrors.length > 8 && <div>Y {importErrors.length - 8} errores más.</div>}
                  </div>
                )}

                {importRows.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="header" style={{ marginBottom: 10 }}>
                      <div>
                        <strong>{importRows.length} productos listos para importar</strong>
                        <p className="small" style={{ margin: "4px 0 0" }}>Vista previa de los primeros productos del archivo.</p>
                      </div>
                      <div className="actions">
                        <button className="button products-primary-button" type="button" disabled={importing || saving} onClick={importProducts}>{importing ? "Importando..." : "Importar productos"}</button>
                        <button className="button ghost products-secondary-button" type="button" disabled={importing} onClick={() => setImportRows([])}>Cancelar</button>
                      </div>
                    </div>

                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th>Costo s/IVA</th><th>IVA</th><th>Estado</th></tr></thead>
                        <tbody>
                          {importRows.slice(0, 8).map((row) => (
                            <tr key={`${row.rowNumber}-${row.payload.sku}`}>
                              <td>{row.payload.sku}</td>
                              <td><strong>{row.payload.name}</strong><br /><span className="small">{row.payload.brand || ""} {row.payload.model || ""}</span></td>
                              <td>{row.payload.category || "-"}</td>
                              <td>{money(row.payload.cost_without_vat)}</td>
                              <td>{row.payload.vat_rate}%</td>
                              <td><span className="badge">{row.payload.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="header" style={{ alignItems: "flex-start", gap: 16 }}>
                  <div>
                    <strong>Vista previa MercadoLibre</strong>
                    <p className="small" style={{ margin: "4px 0 0" }}>
                      La importacion agrupa publicaciones por SKU para evitar duplicados. Podes elegir exactamente que productos nuevos crear.
                    </p>
                  </div>
                  <div className="actions">
                    <button className="button ghost products-secondary-button" type="button" disabled={meliPreviewLoading || meliImporting} onClick={loadMeliImportPreview}>
                      {meliPreviewLoading ? "Leyendo ML..." : "Actualizar vista previa"}
                    </button>
                    <button className="button ghost products-secondary-button" type="button" disabled={!meliPreview || meliImporting} onClick={selectFilteredMissingMeli}>
                      Seleccionar filtrados
                    </button>
                    <button className="button ghost products-secondary-button" type="button" disabled={!meliPreview || meliImporting} onClick={clearMeliSelection}>
                      Limpiar seleccion
                    </button>
                    <button className="button products-primary-button" type="button" disabled={!meliPreview || selectedMeliSkus.length === 0 || meliImporting || saving} onClick={importMeliProducts}>
                      {meliImporting ? "Importando y sincronizando..." : `Importar seleccionados (${selectedMeliSkus.length})`}
                    </button>
                  </div>
                </div>

                {meliPreviewLoading && <section className="card" style={{ marginTop: 14 }}><p>Leyendo publicaciones de MercadoLibre...</p></section>}

                {meliPreview && (
                  <div style={{ marginTop: 14 }}>
                    <div className="card" style={{ marginBottom: 14 }}>
                      <div className="grid" style={{ alignItems: "end" }}>
                        <div className="field">
                          <label>Buscar</label>
                          <input value={meliImportSearch} onChange={(event) => setMeliImportSearch(event.target.value)} placeholder="SKU, titulo o publicacion" />
                        </div>
                        <div className="field">
                          <label>Tipo</label>
                          <select value={meliImportKindFilter} onChange={(event) => setMeliImportKindFilter(event.target.value)}>
                            <option value="missing">Solo nuevos</option>
                            <option value="all">Todos</option>
                            <option value="existing">Ya existen</option>
                          </select>
                        </div>
                        <div className="field">
                          <label>Estado ML</label>
                          <select value={meliImportStatusFilter} onChange={(event) => setMeliImportStatusFilter(event.target.value)}>
                            <option value="">Todos</option>
                            <option value="active">Activos</option>
                            <option value="paused">Pausados</option>
                          </select>
                        </div>
                        <div className="field">
                          <label>Categoria</label>
                          <select value={meliImportCategoryFilter} onChange={(event) => setMeliImportCategoryFilter(event.target.value)}>
                            <option value="">Todas</option>
                            {meliImportCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                          </select>
                        </div>
                        <div className="field">
                          <label>Recien anadidos</label>
                          <select value={meliImportRecentFilter} onChange={(event) => setMeliImportRecentFilter(event.target.value)}>
                            <option value="">Cualquier fecha</option>
                            <option value="7">Ultimos 7 dias</option>
                            <option value="30">Ultimos 30 dias</option>
                            <option value="90">Ultimos 90 dias</option>
                          </select>
                        </div>
                        <button className="button ghost products-secondary-button" type="button" onClick={() => {
                          setMeliImportSearch("");
                          setMeliImportStatusFilter("");
                          setMeliImportCategoryFilter("");
                          setMeliImportKindFilter("missing");
                          setMeliImportRecentFilter("");
                        }}>Limpiar filtros</button>
                      </div>
                      <p className="small" style={{ margin: "10px 0 0" }}>
                        Mostrando {filteredMeliRows.length} de {meliPreview.rows.length} SKU. Seleccionados para importar: {selectedMeliSkus.length}.
                      </p>
                    </div>

                    <section className="products-kpi-grid" style={{ marginBottom: 14 }}>
                      <div className="card product-kpi-card">
                        <span className="product-kpi-icon"><Package aria-hidden="true" /></span>
                        <div>
                          <p>SKU unicos</p>
                          <strong>{meliPreview.total_products || meliPreview.rows.length}</strong>
                          <small>{meliPreview.total_items} publicaciones ML</small>
                        </div>
                      </div>
                      <div className="card product-kpi-card">
                        <span className="product-kpi-icon green"><Plus aria-hidden="true" /></span>
                        <div>
                          <p>Nuevos para crear</p>
                          <strong>{meliPreview.missing}</strong>
                          <small>No existen en Productos</small>
                        </div>
                      </div>
                      <div className="card product-kpi-card">
                        <span className="product-kpi-icon violet"><BadgeCheck aria-hidden="true" /></span>
                        <div>
                          <p>Ya existentes</p>
                          <strong>{meliPreview.existing}</strong>
                          <small>Se omiten para cuidar costos</small>
                        </div>
                      </div>
                      <div className="card product-kpi-card">
                        <span className="product-kpi-icon amber"><PackageMinus aria-hidden="true" /></span>
                        <div>
                          <p>Publicaciones repetidas</p>
                          <strong>{meliPreview.duplicate_publications || 0}</strong>
                          <small>Filtradas por SKU</small>
                        </div>
                      </div>
                    </section>

                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Elegir</th>
                            <th>Foto</th>
                            <th>SKU</th>
                            <th>Producto ML</th>
                            <th>Categoria</th>
                            <th>Precio ML</th>
                            <th>Stock</th>
                            <th>Accion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMeliRows.slice(0, 120).map((row) => (
                            <tr key={row.sku}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedMeliSet.has(row.sku)}
                                  disabled={row.exists || meliImporting}
                                  onChange={(event) => toggleMeliSku(row.sku, event.target.checked)}
                                  aria-label={`Importar ${row.sku}`}
                                  style={{ width: 18, height: 18 }}
                                />
                              </td>
                              <td>
                                {row.thumbnail ? <img src={row.thumbnail} alt="" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 8, background: "#f4f6f8" }} /> : "-"}
                              </td>
                              <td>
                                <strong>{row.sku}</strong>
                                {row.sku_source === "item_id" && <><br /><span className="small">Sin SKU en ML</span></>}
                              </td>
                              <td>
                                <strong>{row.title}</strong>
                                <br />
                                <span className="small">{row.meli_item_id} · {row.status || "-"}</span>
                              </td>
                              <td>{row.payload.category || "-"}</td>
                              <td>{row.price ? money(row.price) : "-"}</td>
                              <td>{row.stock ?? "-"}</td>
                              <td>
                                <span className={`badge ${row.exists ? "meli-status-active" : "meli-status-none"}`}>
                                  {row.exists ? "Ya existe" : selectedMeliSet.has(row.sku) ? "Crear" : "Omitir"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {filteredMeliRows.length === 0 && (
                      <p className="small" style={{ marginTop: 10 }}>No hay SKU para mostrar con esos filtros.</p>
                    )}

                    {filteredMeliRows.length > 120 && (
                      <p className="small" style={{ marginTop: 10 }}>
                        Mostrando 120 de {filteredMeliRows.length} SKU filtrados. La importacion toma solo los seleccionados.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      <section className="products-list-section">
        <div className="products-list-header">
          <div>
            <h2>Listado avanzado</h2>
            <p className="small">Mostrando {filtered.length} de {products.length} productos</p>
          </div>
        </div>

        {loading ? (
          <section className="card"><p>Cargando productos...</p></section>
        ) : (
          <div className="products-advanced-list">
            <div className="products-list-columns" aria-hidden="true">
              <span />
              <span />
              <span>Producto</span>
              <span>Costo</span>
              <span>Precio</span>
              <span>Envio ML</span>
              <span>Fijo ML</span>
              <span>MLA</span>
              <span>Stock</span>
              <span>Estado</span>
              <span>Accion</span>
            </div>
            {filtered.map(({ product, shippings }) => {
              const expanded = expandedSku === product.sku;
              const publicationCount = shippings.length;
              const activePublications = shippings.filter((item) => item.meli_status === "active").length;
              const pausedPublications = shippings.filter((item) => item.meli_status === "paused").length;
              const publicationGroups = groupProductPublications(shippings);
              const sharedMlStock = sharedStockFromPublications(shippings);
              const latestSync = shippings
                .map((item) => item.meli_last_sync_at || item.updated_at)
                .filter(Boolean)
                .sort()
                .reverse()[0];
              const thumbnail = productImage(shippings);
              const bestPrice = bestMeliPrice(shippings);
              const shippingCostRange = moneyRange(shippings.map((item) => item.shipping_cost_amount));
              const fixedFeeRange = moneyRange(shippings.map((item) => item.fixed_fee_amount));
              const productNotes = product.description || shippings[0]?.notes || "-";
              const noteSummary = productNoteSummary(productNotes);
              const detailId = `product-detail-${String(product.id || product.sku).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
              const toggleProductRow = () => setExpandedSku(expanded ? null : product.sku);
              const handleProductRowClick = (event: MouseEvent<HTMLDivElement>) => {
                if (isProductRowInteractiveTarget(event.target)) return;
                toggleProductRow();
              };
              const handleProductRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
                if (isProductRowInteractiveTarget(event.target)) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                toggleProductRow();
              };
              return (
                <article key={product.id || product.sku} className={`product-row-card ${expanded ? "expanded" : ""}`}>
                  <div
                    className="product-row-main"
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={handleProductRowClick}
                    onKeyDown={handleProductRowKeyDown}
                  >
                    <button className="product-select-box" type="button" aria-label="Seleccionar producto" onClick={(event) => event.stopPropagation()} />
                    <div className="product-thumb">
                      {thumbnail ? <img src={thumbnail} alt="" /> : productInitial(product)}
                    </div>

                    <div className="product-primary">
                      <h3>{product.name}</h3>
                      <p>
                        {product.sku}
                        {product.ean ? <> · <strong>EAN:</strong> {product.ean}</> : null}
                      </p>
                      <p>{product.brand || "-"} · {product.category || "-"}{product.model ? ` · ${product.model}` : ""}</p>
                    </div>

                    <div className="product-row-stat">
                      <span>Costo sin IVA</span>
                      <strong>{money(product.cost_without_vat)}</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>Precio ML</span>
                      <strong>{bestPrice ? money(bestPrice) : "-"}</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>Envio ML</span>
                      <strong>{shippingCostRange}</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>Fijo ML</span>
                      <strong>{fixedFeeRange}</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>Publicaciones ML</span>
                      <strong>{publicationCount || "-"}</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>Stock ML</span>
                      <strong>{publicationCount ? sharedMlStock : "-"}</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>Estado ML</span>
                      <strong>
                        {publicationCount ? (
                          <span className="badge">{activePublications} activas{pausedPublications ? ` · ${pausedPublications} pausadas` : ""}</span>
                        ) : (
                          <span className="badge meli-status-none">Sin publicar</span>
                        )}
                      </strong>
                    </div>
                    <button className="product-expand-button" type="button" aria-label={expanded ? "Cerrar detalle" : "Ver detalle"} onClick={(event) => { event.stopPropagation(); toggleProductRow(); }}>
                      {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                    </button>
                  </div>

                  {expanded && (
                    <div className="product-expanded-panel" id={detailId}>
                      <div className="product-detail-grid">
                        <div className="product-detail-section">
                          <h3>Información del producto</h3>
                          <h4>Dimensiones</h4>
                          <p>{dimensions(product)}</p>
                          <h4>Peso</h4>
                          <p>{product.weight_kg ? `${product.weight_kg} kg` : "-"}</p>
                          <h4>Marca / modelo</h4>
                          <p>{product.brand || "-"} {product.model || ""}</p>
                          <h4>Garantía</h4>
                          <p>{product.warranty_months ? `${product.warranty_months} meses` : "-"}</p>
                        </div>
                        <div className="product-detail-section product-detail-ml">
                          <h3>MercadoLibre</h3>
                          <p><strong>{publicationCount || 0}</strong> publicaciones vinculadas</p>
                          <p><strong>{publicationCount ? sharedMlStock : "-"}</strong> stock compartido</p>
                          <div className="product-detail-badges">
                            <span className="badge meli-status-active">{activePublications} activas</span>
                            <span className="badge meli-status-paused">{pausedPublications} pausadas</span>
                          </div>
                          <p>Última sync: {formatDateTime(latestSync)}</p>
                          <p className="product-stock-note"><Info aria-hidden="true" />El stock corresponde a un inventario compartido entre las publicaciones.</p>
                        </div>
                        <div className="product-detail-section product-detail-notes">
                          <h3>Notas</h3>
                          <p className="product-note-summary" title={noteSummary.detail || productNotes}>
                            <span>Origen</span>
                            <strong>{noteSummary.label}</strong>
                            {noteSummary.detail && noteSummary.detail !== noteSummary.label ? <Info aria-hidden="true" /> : null}
                          </p>
                        </div>
                      </div>

                      {publicationCount > 0 && (
                        <div className="product-publications-section">
                          <div className="product-publications-header">
                            <div>
                              <h3>Publicaciones MercadoLibre</h3>
                              <p>{product.name} · {publicationCount} publicaciones vinculadas · Stock compartido {sharedMlStock}</p>
                            </div>
                          </div>
                          <div className="table-wrap product-publications-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Publicación</th>
                                <th>Estado</th>
                                <th>Precio venta</th>
                                <th>Envio</th>
                                <th>Fijo</th>
                                <th>Cuotas / tipo ML</th>
                                <th>Stock publicado</th>
                                <th>Última sync</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {publicationGroups.map((group) => {
                                const groupKey = `${product.sku}-${group.key}`;
                                const groupExpanded = Boolean(expandedPublicationGroups[groupKey]);
                                return (
                                <Fragment key={group.key}>
                                  <tr className="product-publication-group-row">
                                    <td colSpan={9}>
                                      <button
                                        className="product-publication-group-trigger"
                                        type="button"
                                        aria-expanded={groupExpanded}
                                        onClick={() => togglePublicationGroup(groupKey)}
                                      >
                                        <span>
                                          <strong>{group.title}</strong>
                                          <small>
                                            {publicationBranchLabel(group.branchKind)} · {group.itemIds.length} MLA · {group.rows.length} variante{group.rows.length === 1 ? "" : "s"}
                                            {group.hasCatalog ? <span className="badge product-catalog-badge">Catálogo</span> : null}
                                          </small>
                                        </span>
                                        {groupExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                                      </button>
                                    </td>
                                  </tr>
                                  {groupExpanded && (
                                    <tr className="product-publication-subheader">
                                      <th>Publicación</th>
                                      <th>Estado</th>
                                      <th>Precio venta</th>
                                      <th>Envío</th>
                                      <th>Fijo</th>
                                      <th>Cuotas / Tipo ML</th>
                                      <th>Stock publicado</th>
                                      <th>Última sync</th>
                                      <th>Acción</th>
                                    </tr>
                                  )}
                                  {groupExpanded && sortPublicationsByInstallments(group.rows).map((shipping) => {
                                return (
                                  <tr key={shipping.id || `${product.sku}-${shipping.meli_item_id}`}>
                                    <td>
                                      <strong className="product-publication-title" title={shipping.meli_title || product.name}>{shipping.meli_title || product.name}</strong>
                                      <br />
                                      <span className="small">
                                                    {shipping.meli_item_id || "-"} · {formatTechnicalLabel(shipping.meli_logistic_type || shipping.shipping_method)}
                                      </span>
                                    </td>
                                    <td><span className={`badge meli-status-${shipping.meli_status || "none"}`}>{meliStatusLabel(shipping.meli_status)}</span></td>
                                    <td className="numeric"><strong>{shipping.meli_price ? money(shipping.meli_price) : "-"}</strong></td>
                                    <td className="numeric">{money(Number(shipping.shipping_cost_amount || 0))}</td>
                                    <td className="numeric">{money(Number(shipping.fixed_fee_amount || 0))}</td>
                                    <td><span className="badge">{installmentLabel(shipping, shippings)}</span></td>
                                    <td className="numeric">{shipping.meli_stock ?? "-"}</td>
                                    <td className="numeric">{formatDateTime(shipping.meli_last_sync_at || shipping.updated_at)}</td>
                                    <td>{shipping.meli_permalink ? <a className="item-action product-publication-open" href={shipping.meli_permalink} target="_blank" rel="noreferrer">Abrir <ChevronRight aria-hidden="true" /></a> : null}</td>
                                  </tr>
                                );
                                  })}
                                </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                          </div>
                        </div>
                      )}

                      <div className="product-row-actions">
                        <button className="button product-detail-action primary" onClick={() => editProduct(product)}><Pencil aria-hidden="true" />Editar</button>
                        <button className="button ghost product-detail-action" onClick={() => duplicateProduct(product)}><Copy aria-hidden="true" />Duplicar</button>
                        <a className="button ghost product-detail-action" href={`/precios?sku=${encodeURIComponent(product.sku)}`}><Tags aria-hidden="true" />Ver precios</a>
                        <button className="button danger product-detail-action" onClick={() => deleteProduct(product)}><Trash2 aria-hidden="true" />Eliminar</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}

            {filtered.length === 0 && (
              <section className="card"><p>No hay productos para mostrar con esos filtros.</p></section>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
