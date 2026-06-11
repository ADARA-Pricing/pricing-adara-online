"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
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
  const [modalOpen, setModalOpen] = useState(false);

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
    setMessage(null);
    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setForm(emptyForm);
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
    setModalOpen(false);
    setForm(emptyForm);
    await loadData();
  }

  return (
    <main className="container wide">
      <PageHero
        title="Envíos"
        description="Costos de envío por producto. Por ahora usamos estos valores para MercadoLibre, y queda preparado para otros canales."
        onRefresh={loadData}
        onLogout={logout}
      />

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card envios-list-card">
        <div className="envios-list-header">
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Costos de envío por producto</h2>
            <p className="small" style={{ marginBottom: 0 }}>
              Hacé click en <strong>Editar</strong> para cargar o modificar el costo de envío de cada producto.
            </p>
          </div>
          <div className="envios-count-badge">{rows.length} productos</div>
        </div>
        <div className="grid envios-filter-grid" style={{ marginBottom: 14 }}>
          <div className="field wide-field"><label>Buscar</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SKU, producto, marca, categoría" /></div>
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

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="shipping-modal">
            <div className="modal-header">
              <div>
                <h2>Editar costo de envío</h2>
                <p className="small">
                  {selectedProduct ? `${selectedProduct.sku} · ${selectedProduct.name}` : "Producto seleccionado"}
                </p>
              </div>
              <button type="button" className="button ghost" onClick={closeModal}>
                Cerrar
              </button>
            </div>

            <form onSubmit={save}>
              <div className="shipping-modal-summary">
                <div>
                  <span>Producto</span>
                  <strong>{selectedProduct?.name || "-"}</strong>
                </div>
                <div>
                  <span>SKU</span>
                  <strong>{selectedProduct?.sku || "-"}</strong>
                </div>
                <div>
                  <span>Categoría</span>
                  <strong>{selectedProduct?.category || "-"}</strong>
                </div>
              </div>

              <div className="grid shipping-modal-grid">
                <div className="field">
                  <label>Costo fijo $</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={numberValue(form.fixed_fee_amount)}
                    onChange={(e) => update("fixed_fee_amount", Number(toNumber(e.target.value) || 0))}
                  />
                </div>
                <div className="field">
                  <label>Costo envío $</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={numberValue(form.shipping_cost_amount)}
                    onChange={(e) => update("shipping_cost_amount", Number(toNumber(e.target.value) || 0))}
                  />
                </div>
                <div className="field">
                  <label>Tipo</label>
                  <select
                    value={form.free_shipping ? "true" : "false"}
                    onChange={(e) => update("free_shipping", e.target.value === "true")}
                  >
                    <option value="true">Envío gratis / cargo vendedor</option>
                    <option value="false">Envío a cargo comprador</option>
                  </select>
                </div>
                <div className="field">
                  <label>Modalidad</label>
                  <select
                    value={form.shipping_method || "mercado_envios"}
                    onChange={(e) => update("shipping_method", e.target.value)}
                  >
                    <option value="mercado_envios">Mercado Envíos</option>
                    <option value="flex">Flex</option>
                    <option value="full">Full</option>
                    <option value="manual">Manual / otro</option>
                  </select>
                </div>
                <div className="field">
                  <label>Estado</label>
                  <select
                    value={form.active ? "true" : "false"}
                    onChange={(e) => update("active", e.target.value === "true")}
                  >
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </select>
                </div>
                <div className="field wide-field">
                  <label>Notas</label>
                  <input
                    value={form.notes || ""}
                    onChange={(e) => update("notes", e.target.value)}
                    placeholder="Ej: tarifa calculada en simulador ML / producto grande / TV"
                  />
                </div>
              </div>

              <div className="shipping-modal-total">
                <span>Total fijo cargado</span>
                <strong>{money(Number(form.fixed_fee_amount || 0) + Number(form.shipping_cost_amount || 0))}</strong>
              </div>

              <div className="modal-actions">
                <button type="button" className="button ghost" onClick={closeModal}>
                  Cancelar
                </button>
                <button className="button" disabled={saving}>
                  {saving ? "Guardando..." : "Guardar envío"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </main>
  );
}
