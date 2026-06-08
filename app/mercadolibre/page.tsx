"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { createClient } from "@/lib/supabase";
import { percent, toNumber } from "@/lib/pricing";
import type { MercadoLibreCategoryFee, MercadoLibreInstallmentFee } from "@/lib/types";

const emptyInstallment: MercadoLibreInstallmentFee = {
  code: "",
  name: "",
  installment_count: null,
  financing_fee_rate: 0,
  default_margin_rate: 10,
  round_to: 100,
  rounding_mode: "nearest",
  active: true,
  notes: ""
};

const emptyCategory: MercadoLibreCategoryFee = {
  category: "",
  marketplace_fee_rate: 0,
  active: true,
  notes: ""
};

function numberValue(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

export default function MercadoLibrePage() {
  const router = useRouter();
  const supabase = createClient();
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categories, setCategories] = useState<MercadoLibreCategoryFee[]>([]);
  const [installmentForm, setInstallmentForm] = useState<MercadoLibreInstallmentFee>(emptyInstallment);
  const [categoryForm, setCategoryForm] = useState<MercadoLibreCategoryFee>(emptyCategory);
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
    const [installmentsResponse, categoriesResponse] = await Promise.all([
      supabase.from("mercadolibre_installment_fees").select("*").order("code", { ascending: true }),
      supabase.from("mercadolibre_category_fees").select("*").order("category", { ascending: true })
    ]);
    setLoading(false);

    if (installmentsResponse.error) setError(installmentsResponse.error.message);
    else setInstallments((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]);

    if (categoriesResponse.error) setError(categoriesResponse.error.message);
    else setCategories((categoriesResponse.data || []) as MercadoLibreCategoryFee[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateInstallment<K extends keyof MercadoLibreInstallmentFee>(key: K, value: MercadoLibreInstallmentFee[K]) {
    setInstallmentForm((current) => ({ ...current, [key]: value }));
  }

  function updateCategory<K extends keyof MercadoLibreCategoryFee>(key: K, value: MercadoLibreCategoryFee[K]) {
    setCategoryForm((current) => ({ ...current, [key]: value }));
  }

  async function saveInstallment(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = {
      code: installmentForm.code.trim().toUpperCase(),
      name: installmentForm.name.trim(),
      installment_count: installmentForm.installment_count ?? null,
      financing_fee_rate: Number(installmentForm.financing_fee_rate || 0),
      default_margin_rate: Number(installmentForm.default_margin_rate || 0),
      round_to: Number(installmentForm.round_to || 100),
      rounding_mode: installmentForm.rounding_mode,
      active: Boolean(installmentForm.active),
      notes: installmentForm.notes?.trim() || null
    };

    if (!payload.code || !payload.name) {
      setError("Código y nombre son obligatorios.");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("mercadolibre_installment_fees").upsert(payload, { onConflict: "code" });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(`Costo de cuotas guardado: ${payload.code}`);
    setInstallmentForm(emptyInstallment);
    await loadData();
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = {
      category: categoryForm.category.trim(),
      marketplace_fee_rate: Number(categoryForm.marketplace_fee_rate || 0),
      active: Boolean(categoryForm.active),
      notes: categoryForm.notes?.trim() || null
    };

    if (!payload.category) {
      setError("La categoría es obligatoria.");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("mercadolibre_category_fees").upsert(payload, { onConflict: "category" });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(`Comisión por categoría guardada: ${payload.category}`);
    setCategoryForm(emptyCategory);
    await loadData();
  }

  function editInstallment(item: MercadoLibreInstallmentFee) {
    setInstallmentForm({ ...emptyInstallment, ...item });
    setMessage(`Editando ${item.code}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editCategory(item: MercadoLibreCategoryFee) {
    setCategoryForm({ ...emptyCategory, ...item });
    setMessage(`Editando categoría ${item.category}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="container wide">
      <header className="header">
        <div className="brand">
          <h1>MercadoLibre</h1>
          <p>Configuración separada de cuotas y comisiones por categoría</p>
        </div>
        <div className="nav">
          <button className="button ghost" onClick={loadData}>Actualizar</button>
          <AppNav onLogout={logout} />
        </div>
      </header>

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Costos por cuotas</h2>
        <p className="small">Estos porcentajes son iguales para todas las categorías. Ejemplos: MC, MP3, MP6, MP9, MP12.</p>
        <form onSubmit={saveInstallment}>
          <div className="grid">
            <div className="field"><label>Código *</label><input value={installmentForm.code} onChange={(e) => updateInstallment("code", e.target.value)} placeholder="MP6" required /></div>
            <div className="field"><label>Nombre *</label><input value={installmentForm.name} onChange={(e) => updateInstallment("name", e.target.value)} placeholder="Mercado Libre Premium 6 cuotas" required /></div>
            <div className="field"><label>Cuotas</label><input type="number" min="0" value={numberValue(installmentForm.installment_count)} onChange={(e) => updateInstallment("installment_count", toNumber(e.target.value))} /></div>
            <div className="field"><label>Costo cuotas %</label><input type="number" step="0.01" value={installmentForm.financing_fee_rate} onChange={(e) => updateInstallment("financing_fee_rate", Number(e.target.value))} /></div>
          </div>

          <div className="grid" style={{ marginTop: 12 }}>
            <div className="field"><label>Ganancia deseada %</label><input type="number" step="0.01" value={installmentForm.default_margin_rate} onChange={(e) => updateInstallment("default_margin_rate", Number(e.target.value))} /></div>
            <div className="field"><label>Redondear a</label><input type="number" min="1" value={installmentForm.round_to} onChange={(e) => updateInstallment("round_to", Number(e.target.value))} /></div>
            <div className="field"><label>Modo redondeo</label><select value={installmentForm.rounding_mode} onChange={(e) => updateInstallment("rounding_mode", e.target.value as MercadoLibreInstallmentFee["rounding_mode"])}><option value="nearest">Más cercano</option><option value="up">Siempre arriba</option><option value="down">Siempre abajo</option></select></div>
            <div className="field"><label>Estado</label><select value={installmentForm.active ? "true" : "false"} onChange={(e) => updateInstallment("active", e.target.value === "true")}><option value="true">Activo</option><option value="false">Inactivo</option></select></div>
          </div>

          <div className="field" style={{ marginTop: 12 }}><label>Notas</label><input value={installmentForm.notes || ""} onChange={(e) => updateInstallment("notes", e.target.value)} /></div>
          <button className="button" disabled={saving} style={{ marginTop: 14 }}>{saving ? "Guardando..." : "Guardar cuotas"}</button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Comisiones por categoría</h2>
        <p className="small">Esta comisión cambia según la categoría del producto. El cálculo de precio suma esta comisión + el costo de cuotas correspondiente.</p>
        <form onSubmit={saveCategory}>
          <div className="grid">
            <div className="field"><label>Categoría *</label><input value={categoryForm.category} onChange={(e) => updateCategory("category", e.target.value)} placeholder="TV" required /></div>
            <div className="field"><label>Comisión MercadoLibre %</label><input type="number" step="0.01" value={categoryForm.marketplace_fee_rate} onChange={(e) => updateCategory("marketplace_fee_rate", Number(e.target.value))} /></div>
            <div className="field"><label>Estado</label><select value={categoryForm.active ? "true" : "false"} onChange={(e) => updateCategory("active", e.target.value === "true")}><option value="true">Activa</option><option value="false">Inactiva</option></select></div>
            <div className="field"><label>Notas</label><input value={categoryForm.notes || ""} onChange={(e) => updateCategory("notes", e.target.value)} /></div>
          </div>
          <button className="button" disabled={saving} style={{ marginTop: 14 }}>{saving ? "Guardando..." : "Guardar categoría"}</button>
        </form>
      </section>

      <section className="grid-2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Tabla de cuotas</h2>
          {loading ? <p>Cargando...</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Código</th><th>Nombre</th><th>Cuotas</th><th>Costo cuotas</th><th>Ganancia</th><th>Redondeo</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {installments.map((item) => (
                    <tr key={item.id || item.code}>
                      <td>{item.code}</td>
                      <td>{item.name}</td>
                      <td>{item.installment_count || "-"}</td>
                      <td>{percent(item.financing_fee_rate)}</td>
                      <td>{percent(item.default_margin_rate)}</td>
                      <td>{item.round_to} / {item.rounding_mode}</td>
                      <td>{item.active ? <span className="badge">activo</span> : <span className="badge">inactivo</span>}</td>
                      <td><button className="button ghost" onClick={() => editInstallment(item)}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Tabla de categorías</h2>
          {loading ? <p>Cargando...</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Categoría</th><th>Comisión</th><th>Estado</th><th>Notas</th><th></th></tr></thead>
                <tbody>
                  {categories.map((item) => (
                    <tr key={item.id || item.category}>
                      <td>{item.category}</td>
                      <td>{percent(item.marketplace_fee_rate)}</td>
                      <td>{item.active ? <span className="badge">activa</span> : <span className="badge">inactiva</span>}</td>
                      <td>{item.notes || "-"}</td>
                      <td><button className="button ghost" onClick={() => editCategory(item)}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
