"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { createClient } from "@/lib/supabase";
import { money, toNumber } from "@/lib/pricing";
import type { MercadoLibreShippingCost, Product } from "@/lib/types";

const emptyForm: MercadoLibreShippingCost = {
  product_id: "",
  fixed_fee_amount: 0,
  shipping_cost_amount: 0,
  free_shipping: true,
  shipping_method: "mercado_envios",
  notes: "",
  active: true
};

function numberValue(value?: number | null) {
  return value === null || value === undefined ? "" : String(value);
}

export default function EnviosMeliPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [shippingCosts, setShippingCosts] = useState<MercadoLibreShippingCost[]>([]);
  const [form, setForm] = useState<MercadoLibreShippingCost>(emptyForm);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    const [productsResponse, shippingResponse] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active").order("name", { ascending: true }),
      supabase.from("mercadolibre_shipping_costs").select("*").order("updated_at", { ascending: false })
    ]);
    setLoading(false);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);

    if (shippingResponse.error) setError(shippingResponse.error.message);
    else setShippingCosts((shippingResponse.data || []) as MercadoLibreShippingCost[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProduct = products.find((product) => product.id === form.product_id);

  const rows = useMemo(() => {
    const normalized = query.toLowerCase();
    return products
      .map((product) => ({
        product,
        shipping: shippingCosts.find((item) => item.product_id === product.id && item.active !== false)
      }))
      .filter(({ product }) => {
        const text = `${product.sku} ${product.name} ${product.brand || ""} ${product.model || ""} ${product.category || ""}`.toLowerCase();
        return !normalized || text.includes(normalized);
      });
  }, [products, shippingCosts, query]);

  function update<K extends keyof MercadoLibreShippingCost>(key: K, value: MercadoLibreShippingCost[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function edit(product: Product, shipping?: MercadoLibreShippingCost) {
    setForm({
      ...emptyForm,
      ...(shipping || {}),
      product_id: product.id || "",
      sku: product.sku
    });
    setMessage(`Editando envío Meli de ${product.sku}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    if (!selectedProduct?.id) {
      setError("Seleccioná un producto.");
      setSaving(false);
      return;
    }

    const payload = {
      product_id: selectedProduct.id,
      sku: selectedProduct.sku,
      fixed_fee_amount: Number(form.fixed_fee_amount || 0),
      shipping_cost_amount: Number(form.shipping_cost_amount || 0),
      free_shipping: Boolean(form.free_shipping),
      shipping_method: form.shipping_method || "mercado_envios",
      notes: form.notes?.trim() || null,
      active: Boolean(form.active)
    };

    const { error } = await supabase.from("mercadolibre_shipping_costs").upsert(payload, { onConflict: "product_id" });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(`Costos de envío guardados para ${selectedProduct.sku}.`);
    setForm(emptyForm);
    await loadData();
  }

  return (
    <main className="container wide">
      <header className="header">
        <div className="brand">
          <h1>Envíos</h1>
          <p>Costos de envío por producto. Por ahora usamos estos valores para MercadoLibre, y queda preparado para otros canales.</p>
        </div>
        <div className="nav">
          <button className="button ghost" onClick={loadData}>Actualizar</button>
          <AppNav onLogout={logout} />
        </div>
      </header>

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Cargar costo por producto</h2>
        <p className="small">MercadoLibre puede cobrar costo de envío gratis al vendedor y/o cargos fijos por unidad según precio, producto, modalidad, reputación y categoría. Por eso lo dejamos editable por SKU.</p>
        <form onSubmit={save}>
          <div className="grid">
            <div className="field wide-field">
              <label>Producto *</label>
              <select value={form.product_id} onChange={(e) => update("product_id", e.target.value)} required>
                <option value="">Seleccionar producto</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.sku} - {product.name} {product.category ? `(${product.category})` : ""}</option>
                ))}
              </select>
            </div>
            <div className="field"><label>Costo fijo $</label><input type="text" inputMode="decimal" value={numberValue(form.fixed_fee_amount)} onChange={(e) => update("fixed_fee_amount", Number(toNumber(e.target.value) || 0))} /></div>
            <div className="field"><label>Costo envío $</label><input type="text" inputMode="decimal" value={numberValue(form.shipping_cost_amount)} onChange={(e) => update("shipping_cost_amount", Number(toNumber(e.target.value) || 0))} /></div>
            <div className="field"><label>Tipo</label><select value={form.free_shipping ? "true" : "false"} onChange={(e) => update("free_shipping", e.target.value === "true")}><option value="true">Envío gratis / cargo vendedor</option><option value="false">Envío a cargo comprador</option></select></div>
          </div>
          <div className="grid" style={{ marginTop: 12 }}>
            <div className="field"><label>Modalidad</label><select value={form.shipping_method || "mercado_envios"} onChange={(e) => update("shipping_method", e.target.value)}><option value="mercado_envios">Mercado Envíos</option><option value="flex">Flex</option><option value="full">Full</option><option value="manual">Manual / otro</option></select></div>
            <div className="field"><label>Estado</label><select value={form.active ? "true" : "false"} onChange={(e) => update("active", e.target.value === "true")}><option value="true">Activo</option><option value="false">Inactivo</option></select></div>
            <div className="field wide-field"><label>Notas</label><input value={form.notes || ""} onChange={(e) => update("notes", e.target.value)} placeholder="Ej: tarifa calculada en simulador ML / producto grande / TV" /></div>
          </div>
          <button className="button" disabled={saving} style={{ marginTop: 14 }}>{saving ? "Guardando..." : "Guardar envío"}</button>
        </form>
      </section>

      <section className="card">
        <div className="grid" style={{ marginBottom: 14 }}>
          <div className="field wide-field"><label>Buscar</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SKU, producto, marca, categoría" /></div>
          <div className="field"><label>Productos</label><input value={`${rows.length} productos`} disabled /></div>
        </div>
        {loading ? <p>Cargando...</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th>Costo fijo</th><th>Envío</th><th>Total fijo</th><th>Tipo</th><th>Modalidad</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {rows.map(({ product, shipping }) => {
                  const total = Number(shipping?.fixed_fee_amount || 0) + Number(shipping?.shipping_cost_amount || 0);
                  return (
                    <tr key={product.id}>
                      <td>{product.sku}</td>
                      <td><strong>{product.name}</strong><br /><span className="small">{product.brand || ""} {product.model || ""}</span></td>
                      <td>{product.category || "-"}</td>
                      <td>{money(shipping?.fixed_fee_amount || 0)}</td>
                      <td>{money(shipping?.shipping_cost_amount || 0)}</td>
                      <td><strong>{money(total)}</strong></td>
                      <td>{shipping?.free_shipping ? "Gratis / vendedor" : "Comprador"}</td>
                      <td>{shipping?.shipping_method || "-"}</td>
                      <td>{shipping ? <span className="badge">configurado</span> : <span className="badge">sin cargar</span>}</td>
                      <td><button className="button ghost" onClick={() => edit(product, shipping)}>Editar</button></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={10}>No hay productos para mostrar.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
