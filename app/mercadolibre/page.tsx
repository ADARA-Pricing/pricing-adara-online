"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
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

type MeliCategoryImportRow = {
  meli_category_id: string;
  meli_category_name: string;
  meli_category_path: string;
  suggested_category: string;
  marketplace_fee_rate: number;
  publication_count: number;
  active_publications: number;
  paused_publications: number;
  sample_titles: string[];
  exists: boolean;
  existing_category: string | null;
};

type MeliCategoryImportPreview = {
  total_items: number;
  total_categories: number;
  missing: number;
  existing: number;
  rows: MeliCategoryImportRow[];
};

function numberValue(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function boolLabel(value?: boolean | null) {
  return value ? "Sí" : "No";
}

function dateLabel(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function listLabel(values?: string[] | null) {
  if (!Array.isArray(values) || values.length === 0) return "-";
  return values.slice(0, 3).join(", ") + (values.length > 3 ? ` +${values.length - 3}` : "");
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
  const [syncingMeli, setSyncingMeli] = useState(false);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showCategoryImport, setShowCategoryImport] = useState(false);
  const [categoryImportPreview, setCategoryImportPreview] = useState<MeliCategoryImportPreview | null>(null);
  const [categoryImportLoading, setCategoryImportLoading] = useState(false);
  const [categoryImportSaving, setCategoryImportSaving] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categoryImportNames, setCategoryImportNames] = useState<Record<string, string>>({});

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

  async function syncFromMercadoLibre() {
    setSyncingMeli(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/mercadolibre/sync-shipping", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo sincronizar MercadoLibre.");

      setMessage(
        `MercadoLibre sincronizado: ${data.category_fee_updates || 0} categorias y ${data.installment_fee_updates || 0} costos de cuotas actualizados.`
      );
      await loadData();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudo sincronizar MercadoLibre.");
    } finally {
      setSyncingMeli(false);
    }
  }

  async function loadCategoryImportPreview() {
    setCategoryImportLoading(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/mercadolibre/import-categories");
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudieron leer las categorias de MercadoLibre.");

      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const names = rows.reduce((acc: Record<string, string>, row: MeliCategoryImportRow) => {
        acc[row.meli_category_id] = row.suggested_category || row.meli_category_name || row.meli_category_id;
        return acc;
      }, {});

      setCategoryImportPreview({
        total_items: Number(data?.total_items || 0),
        total_categories: Number(data?.total_categories || rows.length || 0),
        missing: Number(data?.missing || 0),
        existing: Number(data?.existing || 0),
        rows,
      });
      setCategoryImportNames(names);
      setSelectedCategoryIds([]);
      setShowCategoryImport(true);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No se pudieron leer las categorias de MercadoLibre.");
    } finally {
      setCategoryImportLoading(false);
    }
  }

  async function startCategoryImport() {
    setShowChannelForm(false);
    setShowCategoryForm(false);
    if (showCategoryImport && categoryImportPreview) {
      setShowCategoryImport(false);
      return;
    }
    setShowCategoryImport(true);
    await loadCategoryImportPreview();
  }

  function toggleCategorySelection(categoryId: string, checked: boolean) {
    setSelectedCategoryIds((current) => (
      checked ? [...new Set([...current, categoryId])] : current.filter((id) => id !== categoryId)
    ));
  }

  function updateCategoryImportName(categoryId: string, value: string) {
    setCategoryImportNames((current) => ({ ...current, [categoryId]: value }));
  }

  async function importSelectedCategories() {
    setCategoryImportSaving(true);
    setMessage(null);
    setError(null);

    try {
      const categoriesToImport = selectedCategoryIds
        .map((id) => ({ meli_category_id: id, category: (categoryImportNames[id] || "").trim() }))
        .filter((entry) => entry.category);

      if (categoriesToImport.length === 0) {
        setError("Selecciona al menos una categoria y asignale un nombre.");
        return;
      }

      const response = await fetch("/api/mercadolibre/import-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: categoriesToImport }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudieron importar las categorias.");

      setMessage(`Categorias importadas: ${data.imported || 0}.`);
      setSelectedCategoryIds([]);
      await loadData();
      await loadCategoryImportPreview();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No se pudieron importar las categorias.");
    } finally {
      setCategoryImportSaving(false);
    }
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
    setShowChannelForm(false);
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
    setShowCategoryForm(false);
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
    setShowCategoryForm(false);
    setShowCategoryImport(false);
    setShowChannelForm(true);
    setMessage(`Editando ${item.code}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editCategory(item: MercadoLibreCategoryFee) {
    setCategoryForm({ ...emptyCategory, ...item });
    setShowChannelForm(false);
    setShowCategoryImport(false);
    setShowCategoryForm(true);
    setMessage(`Editando categoría ${item.category}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNewChannel() {
    setInstallmentForm(emptyInstallment);
    setMessage(null);
    setError(null);
    setShowCategoryForm(false);
    setShowCategoryImport(false);
    setShowChannelForm((current) => !current);
  }

  function startNewCategory() {
    setCategoryForm(emptyCategory);
    setMessage(null);
    setError(null);
    setShowChannelForm(false);
    setShowCategoryImport(false);
    setShowCategoryForm((current) => !current);
  }

  return (
    <main className="container wide">
      <PageHero
        title="Costo x canal"
        description="Configuración separada de costos, financiación y comisiones por categoría/canal"
        onRefresh={loadData}
        onLogout={logout}
      />

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card channel-actions-card">
        <div className="channel-actions-header">
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Configuración de canales y categorías</h2>
            <p className="small" style={{ marginBottom: 0 }}>MercadoLibre puede actualizar comisiones por categoría y costo de cuotas desde las publicaciones sincronizadas.</p>
          </div>
          <div className="channel-actions-buttons">
            <button type="button" className="button" onClick={syncFromMercadoLibre} disabled={syncingMeli}>
              {syncingMeli ? "Sincronizando..." : "Actualizar costos ML"}
            </button>
            <button type="button" className={`button ${showCategoryImport ? "secondary" : "ghost"}`} onClick={startCategoryImport} disabled={categoryImportLoading}>
              {categoryImportLoading ? "Leyendo ML..." : showCategoryImport ? "Ocultar importador" : "Importar categorias ML"}
            </button>
            <button type="button" className={`button ${showChannelForm ? "secondary" : "ghost"}`} onClick={startNewChannel}>
              {showChannelForm ? "Ocultar canal" : "Agregar canal"}
            </button>
            <button type="button" className={`button ${showCategoryForm ? "secondary" : "ghost"}`} onClick={startNewCategory}>
              {showCategoryForm ? "Ocultar categoría" : "Agregar categoría"}
            </button>
          </div>
        </div>
      </section>

      {showCategoryImport && (
        <section className="card channel-card channel-editor-card meli-category-import-card" style={{ marginBottom: 20 }}>
          <div className="section-title-row">
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Importar categorias desde MercadoLibre</h2>
              <p className="small" style={{ marginBottom: 0 }}>
                Trae las categorias con publicaciones activas o pausadas, calcula la comision detectada y te deja elegir cuales guardar.
              </p>
            </div>
            <div className="channel-actions-buttons">
              <button type="button" className="button ghost" onClick={loadCategoryImportPreview} disabled={categoryImportLoading}>
                {categoryImportLoading ? "Actualizando..." : "Actualizar lista"}
              </button>
              <button type="button" className="button ghost" onClick={() => setShowCategoryImport(false)}>
                Cerrar
              </button>
            </div>
          </div>

          {categoryImportPreview && (
            <div className="category-import-summary">
              <span className="badge">{categoryImportPreview.total_categories} categorias ML</span>
              <span className="badge">{categoryImportPreview.total_items} publicaciones</span>
              <span className="badge">{categoryImportPreview.missing} nuevas</span>
              <span className="badge">{categoryImportPreview.existing} ya cargadas</span>
            </div>
          )}

          <div className="channel-actions-buttons category-import-actions">
            <button
              type="button"
              className="button ghost small-button"
              onClick={() => setSelectedCategoryIds((categoryImportPreview?.rows || []).filter((row) => !row.exists).map((row) => row.meli_category_id))}
              disabled={!categoryImportPreview || categoryImportLoading}
            >
              Seleccionar nuevas
            </button>
            <button
              type="button"
              className="button ghost small-button"
              onClick={() => setSelectedCategoryIds([])}
              disabled={selectedCategoryIds.length === 0}
            >
              Limpiar seleccion
            </button>
            <button
              type="button"
              className="button small-button"
              onClick={importSelectedCategories}
              disabled={categoryImportSaving || selectedCategoryIds.length === 0}
            >
              {categoryImportSaving ? "Importando..." : `Importar ${selectedCategoryIds.length}`}
            </button>
          </div>

          {categoryImportLoading && !categoryImportPreview ? <p>Cargando categorias desde MercadoLibre...</p> : (
            <div className="table-wrap category-import-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Importar</th>
                    <th>Nombre en la app</th>
                    <th>Categoria MercadoLibre</th>
                    <th>Publicaciones</th>
                    <th>Comision</th>
                    <th>Estado</th>
                    <th>Ejemplos</th>
                  </tr>
                </thead>
                <tbody>
                  {(categoryImportPreview?.rows || []).map((row) => {
                    const selected = selectedCategoryIds.includes(row.meli_category_id);
                    return (
                      <tr key={row.meli_category_id}>
                        <td>
                          <label className="checkbox-row category-import-check">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(event) => toggleCategorySelection(row.meli_category_id, event.target.checked)}
                            />
                            <span>{selected ? "Si" : "No"}</span>
                          </label>
                        </td>
                        <td>
                          <input
                            value={categoryImportNames[row.meli_category_id] || ""}
                            onChange={(event) => updateCategoryImportName(row.meli_category_id, event.target.value)}
                            placeholder={row.meli_category_name}
                          />
                        </td>
                        <td>
                          <strong>{row.meli_category_name}</strong>
                          <div className="small">{row.meli_category_path}</div>
                          <div className="small">{row.meli_category_id}</div>
                        </td>
                        <td>
                          <strong>{row.publication_count}</strong>
                          <div className="small">{row.active_publications} activas / {row.paused_publications} pausadas</div>
                        </td>
                        <td>{percent(row.marketplace_fee_rate)}</td>
                        <td>{row.exists ? <span className="badge">ya cargada</span> : <span className="badge">nueva</span>}</td>
                        <td>{row.sample_titles?.length ? row.sample_titles.join(" | ") : "-"}</td>
                      </tr>
                    );
                  })}
                  {!categoryImportLoading && (!categoryImportPreview || categoryImportPreview.rows.length === 0) && (
                    <tr><td colSpan={7}>No encontramos categorias con publicaciones en MercadoLibre.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showChannelForm && (
        <section className="card channel-card channel-editor-card" style={{ marginBottom: 20 }}>
          <div className="section-title-row">
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Condiciones de venta / canales</h2>
              <p className="small" style={{ marginBottom: 0 }}>Configurá canales como MercadoLibre, efectivo, transferencia, Tienda Nube, Posnet u otros. Los checks definen qué costos/impuestos aplican en el cálculo.</p>
            </div>
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setShowChannelForm(false);
                setInstallmentForm(emptyInstallment);
              }}
            >
              Cerrar
            </button>
          </div>
          <form onSubmit={saveInstallment}>
            <div className="channel-form-grid">
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

            <div className="channel-footer">
              <div className="field channel-notes"><label>Notas</label><input value={installmentForm.notes || ""} onChange={(e) => updateInstallment("notes", e.target.value)} /></div>
              <button className="button" disabled={saving}>{saving ? "Guardando..." : "Guardar canal"}</button>
            </div>
          </form>
        </section>
      )}

      {showCategoryForm && (
        <section className="card channel-card channel-editor-card" style={{ marginBottom: 20 }}>
          <div className="section-title-row">
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Comisiones por categoría / canal</h2>
              <p className="small" style={{ marginBottom: 0 }}>Esta comisión cambia según la categoría del producto y se usa solo en canales que tengan activo “Aplica comisión ML por categoría”.</p>
            </div>
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setShowCategoryForm(false);
                setCategoryForm(emptyCategory);
              }}
            >
              Cerrar
            </button>
          </div>
          <form onSubmit={saveCategory}>
            <div className="category-form-grid">
              <div className="field"><label>Categoría *</label><input value={categoryForm.category} onChange={(e) => updateCategory("category", e.target.value)} placeholder="TV" required /></div>
              <div className="field"><label>Comisión MercadoLibre %</label><input type="number" step="0.01" value={categoryForm.marketplace_fee_rate} onChange={(e) => updateCategory("marketplace_fee_rate", Number(e.target.value))} /></div>
              <div className="field"><label>Estado</label><select value={categoryForm.active ? "true" : "false"} onChange={(e) => updateCategory("active", e.target.value === "true")}><option value="true">Activa</option><option value="false">Inactiva</option></select></div>
              <div className="field"><label>Notas</label><input value={categoryForm.notes || ""} onChange={(e) => updateCategory("notes", e.target.value)} /></div>
            </div>
            <button className="button" disabled={saving} style={{ marginTop: 14 }}>{saving ? "Guardando..." : "Guardar categoría"}</button>
          </form>
        </section>
      )}

      <section className="channel-tables">
        <div className="card channel-table-card">
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
                        <td className="actions-cell"><button className="button ghost small-button" onClick={() => editInstallment(item)}>Editar</button><button className="button danger small-button" onClick={() => deleteInstallment(item)}>Eliminar</button></td>
                      </tr>
                    );
                  })}
                  {installments.length === 0 && <tr><td colSpan={12}>Sin canales cargados.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card channel-table-card">
          <h2 style={{ marginTop: 0 }}>Tabla de categorías</h2>
          {loading ? <p>Cargando...</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Categoría</th><th>Comisión</th><th>Categorías ML</th><th>Sync ML</th><th>Estado</th><th>Notas</th><th></th></tr></thead>
                <tbody>
                  {categories.map((item) => (
                    <tr key={item.id || item.category}>
                      <td>{item.category}</td>
                      <td>{percent(item.marketplace_fee_rate)}</td>
                      <td>{listLabel(item.meli_category_names)}</td>
                      <td>{dateLabel(item.meli_last_sync_at)}</td>
                      <td>{item.active ? <span className="badge">activa</span> : <span className="badge">inactiva</span>}</td>
                      <td>{item.notes || "-"}</td>
                      <td className="actions-cell"><button className="button ghost small-button" onClick={() => editCategory(item)}>Editar</button><button className="button danger small-button" onClick={() => deleteCategory(item)}>Eliminar</button></td>
                    </tr>
                  ))}
                  {categories.length === 0 && <tr><td colSpan={7}>Sin categorías cargadas.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
