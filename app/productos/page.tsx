"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useRouter } from "next/navigation";
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

function installmentLabel(title?: string | null) {
  const text = (title || "").toLowerCase();
  const match = text.match(/(\d{1,2})\s*cuotas?/i);
  if (match?.[1]) return `${match[1]} cuotas`;
  if (text.includes("sin cuota") || text.includes("contado")) return "Sin cuotas";
  if (text.includes("cuota")) return "Con cuotas";
  return "Sin info";
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [activeProductTab, setActiveProductTab] = useState<"manual" | "excel">("manual");
  const [editorOpen, setEditorOpen] = useState(false);

  const costWithVatPreview = useMemo(() => {
    const cost = Number(form.cost_without_vat || 0);
    const vat = Number(form.vat_rate || 0);
    return cost * (1 + vat / 100);
  }, [form.cost_without_vat, form.vat_rate]);

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

  function shippingsForProduct(product: Product) {
    return shippingCosts
      .filter((item) => item.product_id === product.id || item.sku === product.sku)
      .sort((a, b) => {
        const aActive = a.meli_status === "active" ? 1 : 0;
        const bActive = b.meli_status === "active" ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return String(b.updated_at || b.meli_last_sync_at || "").localeCompare(String(a.updated_at || a.meli_last_sync_at || ""));
      });
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

    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(existing ? `Producto actualizado: ${cleanSku}` : `Producto creado: ${cleanSku}`);
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

  const categories = useMemo(() => {
    const values = new Set(products.map((product) => product.category).filter(Boolean) as string[]);
    return [...values].sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);

  const enriched = useMemo(() => {
    return products.map((product) => {
      const shippings = shippingsForProduct(product);
      return { product, shippings };
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
    const syncedToday = enriched.filter(({ shippings }) => {
      const now = new Date();
      return shippings.some((shipping) => {
        if (!shipping?.meli_last_sync_at) return false;
        const date = new Date(shipping.meli_last_sync_at);
        return date.toDateString() === now.toDateString();
      });
    }).length;

    return { total, withMl, withoutMl, syncedToday };
  }, [products, enriched]);

  return (
    <main className="container wide products-advanced-page">
      <PageHero
        title="Productos"
        description="Visualizá, filtrá y actualizá productos con datos comerciales y de MercadoLibre."
        onRefresh={loadProducts}
        icon="▧"
      />

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="products-toolbar-card card">
        <div className="products-toolbar-grid">
          <div className="field">
            <label>Buscar producto</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre, SKU, EAN o Item ID..." />
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
              + Nuevo producto
            </button>
            <button className="button ghost products-secondary-button" type="button" onClick={openImportModal}>
              Importar Excel
            </button>
          </div>
        </div>
      </section>

      <section className="products-kpi-grid">
        <div className="card product-kpi-card">
          <span className="product-kpi-icon">▧</span>
          <div>
            <p>Total productos</p>
            <strong>{metrics.total}</strong>
            <small>100% del catálogo</small>
          </div>
        </div>
        <div className="card product-kpi-card">
          <span className="product-kpi-icon green">⌑</span>
          <div>
            <p>Con publicación ML</p>
            <strong>{metrics.withMl}</strong>
            <small>{metrics.total ? `${Math.round((metrics.withMl / metrics.total) * 100)}% del catálogo` : "0% del catálogo"}</small>
          </div>
        </div>
        <div className="card product-kpi-card">
          <span className="product-kpi-icon violet">↻</span>
          <div>
            <p>Sincronizados hoy</p>
            <strong>{metrics.syncedToday}</strong>
            <small>Última sync disponible</small>
          </div>
        </div>
        <div className="card product-kpi-card">
          <span className="product-kpi-icon amber">!</span>
          <div>
            <p>Sin publicación ML</p>
            <strong>{metrics.withoutMl}</strong>
            <small>{metrics.total ? `${Math.round((metrics.withoutMl / metrics.total) * 100)}% del catálogo` : "0% del catálogo"}</small>
          </div>
        </div>
      </section>

      {editorOpen && (
        <div className="modal-backdrop" onClick={closeEditorModal}>
          <section className="modal-card product-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="header product-editor-header" style={{ alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 8 }}>
                  {activeProductTab === "manual" ? "Nuevo / actualizar producto" : "Carga masiva con Excel"}
                </h2>
                <p className="small" style={{ margin: 0 }}>
                  {activeProductTab === "manual"
                    ? "Si el SKU ya existe, la app actualiza el producto. Si no existe, lo crea."
                    : "Descargá la plantilla, completala en Excel y subila. Si el SKU ya existe, se actualiza; si no existe, se crea."}
                </p>
              </div>
              <div className="actions product-editor-controls" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                <button className={activeProductTab === "manual" ? "button products-primary-button" : "button ghost products-secondary-button"} type="button" onClick={() => setActiveProductTab("manual")}>Carga manual</button>
                <button className={activeProductTab === "excel" ? "button products-primary-button" : "button ghost products-secondary-button"} type="button" onClick={() => setActiveProductTab("excel")}>Carga masiva Excel</button>
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
            ) : (
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
            {filtered.map(({ product, shippings }) => {
              const expanded = expandedSku === product.sku;
              const publicationCount = shippings.length;
              const activePublications = shippings.filter((item) => item.meli_status === "active").length;
              const pausedPublications = shippings.filter((item) => item.meli_status === "paused").length;
              const totalMlStock = shippings.reduce((acc, item) => acc + Number(item.meli_stock || 0), 0);
              const latestSync = shippings
                .map((item) => item.meli_last_sync_at || item.updated_at)
                .filter(Boolean)
                .sort()
                .reverse()[0];
              return (
                <article key={product.id || product.sku} className={`product-row-card ${expanded ? "expanded" : ""}`}>
                  <div className="product-row-main">
                    <button className="product-select-box" type="button" aria-label="Seleccionar producto" />
                    <div className="product-thumb">{productInitial(product)}</div>

                    <div className="product-primary">
                      <h3>{product.name}</h3>
                      <p>
                        <strong>SKU:</strong> {product.sku}
                        {product.ean ? <> · <strong>EAN:</strong> {product.ean}</> : null}
                      </p>
                      <p>Categoría: {product.category || "-"} · {product.brand || ""} {product.model || ""}</p>
                    </div>

                    <div className="product-row-stat">
                      <span>Costo sin IVA</span>
                      <strong>{money(product.cost_without_vat)}</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>IVA</span>
                      <strong>{product.vat_rate}%</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>Publicaciones ML</span>
                      <strong>{publicationCount || "-"}</strong>
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
                    <div className="product-row-stat">
                      <span>Stock ML total</span>
                      <strong>{publicationCount ? totalMlStock : "-"}</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>Envío ML</span>
                      <strong>{publicationCount ? money(Math.max(...shippings.map((item) => Number(item.shipping_cost_amount || 0)))) : "-"}</strong>
                    </div>
                    <div className="product-row-stat">
                      <span>Última sync</span>
                      <strong>{formatDateTime(latestSync)}</strong>
                    </div>

                    <button className="product-expand-button" type="button" onClick={() => setExpandedSku(expanded ? null : product.sku)}>
                      {expanded ? "⌃" : "⌄"}
                    </button>
                  </div>

                  {expanded && (
                    <div className="product-expanded-panel">
                      <div className="product-detail-grid">
                        <div>
                          <h4>Dimensiones</h4>
                          <p>{dimensions(product)}</p>
                          <h4>Peso</h4>
                          <p>{product.weight_kg ? `${product.weight_kg} kg` : "-"}</p>
                        </div>
                        <div>
                          <h4>Marca / modelo</h4>
                          <p>{product.brand || "-"} {product.model || ""}</p>
                          <h4>Garantía</h4>
                          <p>{product.warranty_months ? `${product.warranty_months} meses` : "-"}</p>
                        </div>
                        <div>
                          <h4>MercadoLibre</h4>
                          <p>Publicaciones vinculadas: {publicationCount || 0}</p>
                          <p>Stock total: {publicationCount ? totalMlStock : "-"}</p>
                          <p>Activas: {activePublications}</p>
                          <p>Pausadas: {pausedPublications}</p>
                        </div>
                        <div>
                          <h4>Notas</h4>
                          <p>{product.description || shippings[0]?.notes || "-"}</p>
                        </div>
                      </div>

                      {publicationCount > 0 && (
                        <div className="table-wrap product-publications-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Publicación</th>
                                <th>Estado</th>
                                <th>Precio venta</th>
                                <th>Cuotas</th>
                                <th>Stock</th>
                                <th>Envío</th>
                                <th>Fijo</th>
                                <th>Total</th>
                                <th>Última sync</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {shippings.map((shipping) => {
                                const totalShipping = Number(shipping.fixed_fee_amount || 0) + Number(shipping.shipping_cost_amount || 0);
                                return (
                                  <tr key={shipping.id || `${product.sku}-${shipping.meli_item_id}`}>
                                    <td>
                                      <strong>{shipping.meli_title || product.name}</strong>
                                      <br />
                                      <span className="small">{shipping.meli_item_id || "-"} · {shipping.meli_logistic_type || shipping.shipping_method || "-"}</span>
                                    </td>
                                    <td><span className={`badge meli-status-${shipping.meli_status || "none"}`}>{meliStatusLabel(shipping.meli_status)}</span></td>
                                    <td><strong>{shipping.meli_price ? money(shipping.meli_price) : "-"}</strong></td>
                                    <td><span className="badge">{installmentLabel(shipping.meli_title)}</span></td>
                                    <td>{shipping.meli_stock ?? "-"}</td>
                                    <td>{money(shipping.shipping_cost_amount || 0)}</td>
                                    <td>{money(shipping.fixed_fee_amount || 0)}</td>
                                    <td><strong>{money(totalShipping)}</strong></td>
                                    <td>{formatDateTime(shipping.meli_last_sync_at || shipping.updated_at)}</td>
                                    <td>{shipping.meli_permalink ? <a className="button ghost small-button" href={shipping.meli_permalink} target="_blank" rel="noreferrer">Abrir</a> : null}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="product-row-actions">
                        <button className="button ghost" onClick={() => editProduct(product)}>Editar</button>
                        <button className="button ghost" onClick={() => duplicateProduct(product)}>Duplicar</button>
                        <a className="button ghost" href={`/precios?sku=${encodeURIComponent(product.sku)}`}>Ver precios</a>
                        <button className="button danger" onClick={() => deleteProduct(product)}>Eliminar</button>
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
