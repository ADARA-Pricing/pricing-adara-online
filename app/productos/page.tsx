"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";
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

export default function ProductsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<Product>(emptyProduct);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [activeProductTab, setActiveProductTab] = useState<"manual" | "excel">("manual");

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
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("updated_at", { ascending: false });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setProducts((data || []) as Product[]);
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

  function editProduct(product: Product) {
    setActiveProductTab("manual");
    setForm({ ...emptyProduct, ...product });
    setMessage(`Editando SKU ${product.sku}. Al guardar se actualiza el producto.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

    if (form.sku === product.sku) {
      setForm(emptyProduct);
    }

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
      status: form.status || "active"
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
    const { error } = await supabase
      .from("products")
      .upsert(payload, { onConflict: "sku" });

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

  const filtered = products.filter((product) => {
    const text = `${product.sku} ${product.name} ${product.brand || ""} ${product.model || ""} ${product.category || ""}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  return (
    <main className="container">
      <PageHero
        title="Productos"
        description="Carga y actualización de productos por SKU"
        onRefresh={loadProducts}
        onLogout={logout}
      />

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="header" style={{ alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
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
          <div className="actions" style={{ alignItems: "center", flexWrap: "nowrap" }}>
            <button
              className={activeProductTab === "manual" ? "button" : "button ghost"}
              type="button"
              onClick={() => setActiveProductTab("manual")}
            >
              Carga manual
            </button>
            <button
              className={activeProductTab === "excel" ? "button" : "button ghost"}
              type="button"
              onClick={() => setActiveProductTab("excel")}
            >
              Carga masiva Excel
            </button>
          </div>
        </div>

        {activeProductTab === "manual" ? (
          <form onSubmit={saveProduct}>
            <div className="grid">
              <div className="field">
                <label>SKU *</label>
                <input value={form.sku} onChange={(e) => update("sku", e.target.value)} placeholder="TVEN043GTV01" required />
              </div>
              <div className="field">
                <label>EAN</label>
                <input value={form.ean || ""} onChange={(e) => update("ean", e.target.value)} placeholder="779..." />
              </div>
              <div className="field">
                <label>Nombre *</label>
                <input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Smart TV Enova 43 Google TV" required />
              </div>
              <div className="field">
                <label>Estado</label>
                <select value={form.status} onChange={(e) => update("status", e.target.value as Product["status"])}>
                  <option value="active">Activo</option>
                  <option value="paused">Pausado</option>
                  <option value="discontinued">Discontinuado</option>
                </select>
              </div>
            </div>

            <div className="grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Marca</label>
                <input value={form.brand || ""} onChange={(e) => update("brand", e.target.value)} placeholder="Enova" />
              </div>
              <div className="field">
                <label>Modelo</label>
                <input value={form.model || ""} onChange={(e) => update("model", e.target.value)} placeholder="43GTV" />
              </div>
              <div className="field">
                <label>Categoría</label>
                <input value={form.category || ""} onChange={(e) => update("category", e.target.value)} placeholder="TV" />
              </div>
              <div className="field">
                <label>Proveedor</label>
                <input value={form.supplier || ""} onChange={(e) => update("supplier", e.target.value)} placeholder="Radio Victoria" />
              </div>
            </div>

            <div className="grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Costo sin IVA *</label>
                <input type="number" step="0.01" min="0" value={form.cost_without_vat} onChange={(e) => update("cost_without_vat", Number(e.target.value))} required />
              </div>
              <div className="field">
                <label>IVA % *</label>
                <select value={form.vat_rate} onChange={(e) => update("vat_rate", Number(e.target.value) as 21 | 10.5)}>
                  <option value={21}>21%</option>
                  <option value={10.5}>10,5%</option>
                </select>
              </div>
              <div className="field">
                <label>Costo con IVA automático</label>
                <input value={money(costWithVatPreview)} disabled />
              </div>
            </div>

            <div className="grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Peso kg</label>
                <input type="number" step="0.001" value={form.weight_kg ?? ""} onChange={(e) => update("weight_kg", toNumber(e.target.value))} />
              </div>
              <div className="field">
                <label>Alto cm</label>
                <input type="number" step="0.01" value={form.height_cm ?? ""} onChange={(e) => update("height_cm", toNumber(e.target.value))} />
              </div>
              <div className="field">
                <label>Ancho cm</label>
                <input type="number" step="0.01" value={form.width_cm ?? ""} onChange={(e) => update("width_cm", toNumber(e.target.value))} />
              </div>
              <div className="field">
                <label>Profundidad cm</label>
                <input type="number" step="0.01" value={form.depth_cm ?? ""} onChange={(e) => update("depth_cm", toNumber(e.target.value))} />
              </div>
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Garantía meses</label>
                <input type="number" min="0" value={form.warranty_months ?? ""} onChange={(e) => update("warranty_months", toNumber(e.target.value))} />
              </div>
              <div className="field">
                <label>Descripción</label>
                <textarea value={form.description || ""} onChange={(e) => update("description", e.target.value)} placeholder="Descripción interna o comercial" />
              </div>
            </div>

            <div className="actions" style={{ marginTop: 16 }}>
              <button className="button" disabled={saving} type="submit">
                {saving ? "Guardando..." : "Guardar producto"}
              </button>
              <button className="button ghost" type="button" onClick={() => setForm(emptyProduct)}>
                Limpiar
              </button>
            </div>
          </form>
        ) : (
          <div>
            <div className="header" style={{ alignItems: "flex-start", gap: 16 }}>
              <div>
                <p className="small" style={{ marginTop: 0 }}>
                  Columnas obligatorias: <strong>SKU</strong>, <strong>Nombre</strong>, <strong>Costo sin IVA</strong> e <strong>IVA %</strong>. El IVA acepta 21 o 10,5. El Estado puede ser active, paused o discontinued.
                </p>
              </div>
              <div className="actions">
                <button className="button ghost" type="button" onClick={downloadTemplate}>Descargar plantilla</button>
                <label className="button ghost" style={{ cursor: "pointer" }}>
                  Subir Excel
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleImportFile}
                    style={{ display: "none" }}
                  />
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
                    <button className="button" type="button" disabled={importing || saving} onClick={importProducts}>
                      {importing ? "Importando..." : "Importar productos"}
                    </button>
                    <button className="button ghost" type="button" disabled={importing} onClick={() => setImportRows([])}>Cancelar</button>
                  </div>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Producto</th>
                        <th>Categoría</th>
                        <th>Costo s/IVA</th>
                        <th>IVA</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 8).map((row) => (
                        <tr key={`${row.rowNumber}-${row.payload.sku}`}>
                          <td>{row.payload.sku}</td>
                          <td>
                            <strong>{row.payload.name}</strong><br />
                            <span className="small">{row.payload.brand || ""} {row.payload.model || ""}</span>
                          </td>
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
      <section className="card">
        <div className="header" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Listado</h2>
            <p className="small">{filtered.length} productos visibles</p>
          </div>
          <div className="field" style={{ minWidth: 280 }}>
            <label>Buscar</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SKU, nombre, marca, categoría" />
          </div>
        </div>

        {loading ? (
          <p>Cargando productos...</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Costo s/IVA</th>
                  <th>IVA</th>
                  <th>Costo c/IVA</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => (
                  <tr key={product.id || product.sku}>
                    <td>{product.sku}</td>
                    <td>
                      <strong>{product.name}</strong><br />
                      <span className="small">{product.brand || ""} {product.model || ""}</span>
                    </td>
                    <td>{product.category || "-"}</td>
                    <td>{money(product.cost_without_vat)}</td>
                    <td>{product.vat_rate}%</td>
                    <td>{money(product.cost_with_vat)}</td>
                    <td><span className="badge">{product.status}</span></td>
                    <td className="actions-cell">
                      <button className="button ghost" onClick={() => editProduct(product)}>Editar</button>
                      <button className="button danger" onClick={() => deleteProduct(product)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8}>Todavía no hay productos cargados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
