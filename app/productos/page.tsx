"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";
import { money, toNumber } from "@/lib/pricing";
import { AppNav } from "@/components/AppNav";

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

  const filtered = products.filter((product) => {
    const text = `${product.sku} ${product.name} ${product.brand || ""} ${product.model || ""} ${product.category || ""}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <h1>Productos</h1>
          <p>Carga y actualización de productos por SKU</p>
        </div>
        <div className="nav">
          <button className="button ghost" onClick={loadProducts}>Actualizar</button>
          <AppNav onLogout={logout} />
        </div>
      </header>

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Nuevo / actualizar producto</h2>
        <p className="small">Si el SKU ya existe, la app actualiza el producto. Si no existe, lo crea.</p>

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
