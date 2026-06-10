"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { defaultTaxSettings, percent } from "@/lib/pricing";
import type { TaxSettings } from "@/lib/types";

export default function TaxesPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<TaxSettings>(defaultTaxSettings());
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
    const { data, error } = await supabase.from("tax_settings").select("*").eq("key", "default").single();
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm((data || defaultTaxSettings()) as TaxSettings);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof TaxSettings>(key: K, value: TaxSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = {
      key: "default",
      iibb_rate: Number(form.iibb_rate || 0),
      idc_rate: Number(form.idc_rate || 0),
      iigg_rate: Number(form.iigg_rate || 0),
      structure_rate: Number(form.structure_rate || 0),
      notes: form.notes?.trim() || null
    };

    const { error } = await supabase.from("tax_settings").upsert(payload, { onConflict: "key" });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Impuestos actualizados correctamente.");
    await loadData();
  }

  const totalTaxes = Number(form.iibb_rate || 0) + Number(form.idc_rate || 0) + Number(form.iigg_rate || 0) + Number(form.structure_rate || 0);

  return (
    <main className="container">
      <PageHero
        title="Impuestos"
        description="Configuración global separada de canales y comisiones"
        onRefresh={loadData}
        onLogout={logout}
      />

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Parámetros impositivos</h2>
        <p className="small">Estos porcentajes se usan en el cálculo de precios y quedan separados de MercadoLibre. Más adelante podemos permitir impuestos por canal o por sociedad.</p>
        {loading ? <p>Cargando...</p> : (
          <form onSubmit={save}>
            <div className="grid">
              <div className="field"><label>IIBB %</label><input type="number" step="0.01" value={form.iibb_rate} onChange={(e) => update("iibb_rate", Number(e.target.value))} /></div>
              <div className="field"><label>IDC %</label><input type="number" step="0.01" value={form.idc_rate} onChange={(e) => update("idc_rate", Number(e.target.value))} /></div>
              <div className="field"><label>IIGG %</label><input type="number" step="0.01" value={form.iigg_rate} onChange={(e) => update("iigg_rate", Number(e.target.value))} /></div>
              <div className="field"><label>Estructura %</label><input type="number" step="0.01" value={form.structure_rate} onChange={(e) => update("structure_rate", Number(e.target.value))} /></div>
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <div className="field"><label>Total impuestos/costos globales</label><input value={percent(totalTaxes)} disabled /></div>
              <div className="field"><label>Notas</label><input value={form.notes || ""} onChange={(e) => update("notes", e.target.value)} /></div>
            </div>

            <button className="button" disabled={saving} style={{ marginTop: 14 }}>{saving ? "Guardando..." : "Guardar impuestos"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
