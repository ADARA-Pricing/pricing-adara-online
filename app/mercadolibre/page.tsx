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
  channel_type: "mercadolibre",
  installment_count: null,
  financing_fee_rate: 0,
  applies_marketplace_fee: true,
  applies_shipping: true,
  applies_iibb: true,
  applies_idc: true,
  applies_iigg: true,
  applies_structure: true,
  applies_vat: true,
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

function boolLabel(value?: boolean | null) {
  return value ? "Sí" : "No";
}

function defaultFlag(value: boolean | null | undefined, fallback = false) {
  return value ?? fallback;
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

  function applyChannelPreset(channelType: string) {
    if (channelType === "directo") {
      setInstallmentForm((current) => ({
        ...current,
        channel_type: "directo",
        financing_fee_rate: 0,
        installment_count: null,
        applies_marketplace_fee: false,
        applies_shipping: false,
        applies_iibb: false,
        applies_idc: false,
        applies_iigg: false,
        applies_structure: false,
        applies_vat: false
      }));
      return;
    }

    if (channelType === "mercadolibre") {
      setInstallmentForm((current) => ({
        ...current,
        channel_type: "mercadolibre",
        applies_marketplace_fee: true,
        applies_shipping: true,
        applies_iibb: true,
        applies_idc: true,
        applies_iigg: true,
        applies_structure: true,
        applies_vat: true
      }));
      return;
    }

    setInstallmentForm((current) => ({ ...current, channel_type: channelType }));
  }

  async function saveInstallment(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = {
      code: installmentForm.code.trim().toUpperCase(),
      name: installmentForm.name.trim(),
      channel_type: installmentForm.channel_type || "mercadolibre",
      installment_count: installmentForm.installment_count ?? null,
      financing_fee_rate: Number(installmentForm.financing_fee_rate || 0),
      applies_marketplace_fee: Boolean(installmentForm.applies_marketplace_fee),
      applies_shipping: Boolean(installmentForm.applies_shipping),
      applies_iibb: Boolean(installmentForm.applies_iibb),
      applies_idc: Boolean(installmentForm.applies_idc),
      applies_iigg: Boolean(installmentForm.applies_iigg),
      applies_structure: Boolean(installmentForm.applies_structure),
      applies_vat: Boolean(installmentForm.applies_vat),
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

    setMessage(`Canal guardado: ${payload.code}`);
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

  async function deleteInstallment(item: MercadoLibreInstallmentFee) {
    const ok = window.confirm(`¿Seguro que querés eliminar el canal ${item.code} - ${item.name}?`);
    if (!ok) return;
    setError(null);
    setMessage(null);
    const { error } = await supabase.from("mercadolibre_installment_fees").delete().eq("code", item.code);
    if (error) setError(error.message);
    else {
      setMessage(`Canal eliminado: ${item.code}`);
      await loadData();
    }
  }

  async function deleteCategory(item: MercadoLibreCategoryFee) {
    const ok = window.confirm(`¿Seguro que querés eliminar la categoría ${item.category}?`);
    if (!ok) return;
    setError(null);
    setMessage(null);
    const { error } = await supabase.from("mercadolibre_category_fees").delete().eq("category", item.category);
    if (error) setError(error.message);
    else {
      setMessage(`Categoría eliminada: ${item.category}`);
      await loadData();
    }
  }

  function editInstallment(item: MercadoLibreInstallmentFee) {
    const isMl = item.channel_type === "mercadolibre" || item.code.startsWith("MP") || item.code === "MC";
    setInstallmentForm({
      ...emptyInstallment,
      ...item,
      channel_type: item.channel_type || (isMl ? "mercadolibre" : "directo"),
      applies_marketplace_fee: defaultFlag(item.applies_marketplace_fee, isMl),
      applies_shipping: defaultFlag(item.applies_shipping, isMl),
      applies_iibb: defaultFlag(item.applies_iibb, isMl),
      applies_idc: defaultFlag(item.applies_idc, isMl),
      applies_iigg: defaultFlag(item.applies_iigg, isMl),
      applies_structure: defaultFlag(item.applies_structure, isMl),
      applies_vat: defaultFlag(item.applies_vat, isMl)
    });
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
          <h1>Costo x canal</h1>
          <p>Configuración separada de costos, financiación y comisiones por categoría/canal</p>
        </div>
        <div className="nav">
          <button className="button ghost" onClick={loadData}>Actualizar</button>
          <AppNav onLogout={logout} />
        </div>
      </header>

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Condiciones de venta / canales</h2>
        <p className="small">Configurá canales como MercadoLibre, efectivo, transferencia, Tienda Nube, Posnet u otros. Los checks definen qué costos/impuestos aplican en el cálculo.</p>
        <form onSubmit={saveInstallment}>
          <div className="grid">
            <div className="field"><label>Código *</label><input value={installmentForm.code} onChange={(e) => updateInstallment("code", e.target.value)} placeholder="EF, MP6, TN" required /></div>
            <div className="field"><label>Nombre *</label><input value={installmentForm.name} onChange={(e) => updateInstallment("name", e.target.value)} placeholder="Efectivo / ML Premium 6 cuotas" required /></div>
            <div className="field"><label>Tipo de canal</label><select value={installmentForm.channel_type || "mercadolibre"} onChange={(e) => applyChannelPreset(e.target.value)}><option value="mercadolibre">MercadoLibre</option><option value="directo">Directo / efectivo</option><option value="web">Web / Tienda Nube</option><option value="posnet">Posnet</option><option value="otro">Otro</option></select></div>
            <div className="field"><label>Cuotas</label><input type="number" min="0" value={numberValue(installmentForm.installment_count)} onChange={(e) => updateInstallment("installment_count", toNumber(e.target.value))} /></div>
            <div className="field"><label>Costo canal / cuotas %</label><input type="number" step="0.01" value={installmentForm.financing_fee_rate} onChange={(e) => updateInstallment("financing_fee_rate", Number(e.target.value))} /></div>
            <div className="field"><label>Estado</label><select value={installmentForm.active ? "true" : "false"} onChange={(e) => updateInstallment("active", e.target.value === "true")}><option value="true">Activo</option><option value="false">Inactivo</option></select></div>
          </div>

          <div className="channel-flags">
            <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_marketplace_fee)} onChange={(e) => updateInstallment("applies_marketplace_fee", e.target.checked)} /><span>Aplica comisión ML por categoría</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_shipping)} onChange={(e) => updateInstallment("applies_shipping", e.target.checked)} /><span>Aplica envío ML</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_iibb)} onChange={(e) => updateInstallment("applies_iibb", e.target.checked)} /><span>Aplica IIBB</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_idc)} onChange={(e) => updateInstallment("applies_idc", e.target.checked)} /><span>Aplica IDC</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_iigg)} onChange={(e) => updateInstallment("applies_iigg", e.target.checked)} /><span>Aplica IIGG</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_structure)} onChange={(e) => updateInstallment("applies_structure", e.target.checked)} /><span>Aplica estructura</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_vat)} onChange={(e) => updateInstallment("applies_vat", e.target.checked)} /><span>Aplica IVA venta</span></label>
          </div>

          <div className="grid" style={{ marginTop: 12 }}>
            <div className="field wide-field"><label>Notas</label><input value={installmentForm.notes || ""} onChange={(e) => updateInstallment("notes", e.target.value)} /></div>
          </div>
          <button className="button" disabled={saving} style={{ marginTop: 14 }}>{saving ? "Guardando..." : "Guardar canal"}</button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Comisiones por categoría / canal</h2>
        <p className="small">Esta comisión cambia según la categoría del producto y se usa solo en canales que tengan activo “Aplica comisión ML por categoría”.</p>
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
          <h2 style={{ marginTop: 0 }}>Tabla de canales</h2>
          {loading ? <p>Cargando...</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Cuotas</th><th>Costo %</th><th>ML</th><th>Env.</th><th>IIBB</th><th>IIGG</th><th>IVA</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {installments.map((item) => {
                    const isMl = item.channel_type === "mercadolibre" || item.code.startsWith("MP") || item.code === "MC";
                    return (
                      <tr key={item.id || item.code}>
                        <td>{item.code}</td>
                        <td>{item.name}</td>
                        <td>{item.channel_type || (isMl ? "mercadolibre" : "directo")}</td>
                        <td>{item.installment_count || "-"}</td>
                        <td>{percent(item.financing_fee_rate)}</td>
                        <td>{boolLabel(defaultFlag(item.applies_marketplace_fee, isMl))}</td>
                        <td>{boolLabel(defaultFlag(item.applies_shipping, isMl))}</td>
                        <td>{boolLabel(defaultFlag(item.applies_iibb, isMl))}</td>
                        <td>{boolLabel(defaultFlag(item.applies_iigg, isMl))}</td>
                        <td>{boolLabel(defaultFlag(item.applies_vat, isMl))}</td>
                        <td>{item.active ? <span className="badge">activo</span> : <span className="badge">inactivo</span>}</td>
                        <td className="actions-cell"><button className="button ghost" onClick={() => editInstallment(item)}>Editar</button><button className="button danger" onClick={() => deleteInstallment(item)}>Eliminar</button></td>
                      </tr>
                    );
                  })}
                  {installments.length === 0 && <tr><td colSpan={12}>Sin canales cargados.</td></tr>}
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
                      <td className="actions-cell"><button className="button ghost" onClick={() => editCategory(item)}>Editar</button><button className="button danger" onClick={() => deleteCategory(item)}>Eliminar</button></td>
                    </tr>
                  ))}
                  {categories.length === 0 && <tr><td colSpan={5}>Sin categorías cargadas.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
