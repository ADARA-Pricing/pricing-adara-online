"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type Summary = {
  day: string;
  checkedAt: string;
  counts: { flex: number; collection: number; full: number };
  flexByLocality: Array<{ locality: string; province: string; count: number }>;
  unresolved: number;
  coverageDays: number;
};

export function LogisticsSummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const { data } = await createClient().auth.getSession();
      if (!data.session) throw new Error("Sesión vencida.");
      const response = await fetch("/api/mercadolibre/logistics-summary", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo cargar el resumen.");
      setSummary(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el resumen."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  return <section className="logistics-daily-summary">
    <div className="logistics-batch-head"><div><h2>Resumen de despachos de hoy</h2><p>Se cuenta cada envío una sola vez, aunque tenga varios productos o venga de una venta anterior.</p></div><button className="button ghost" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Consultando..." : "Actualizar resumen"}</button></div>
    {loading && <p>Consultando los envíos y sus fechas de despacho en Mercado Libre. Puede tardar unos momentos.</p>}
    {error && <div className="message info" role="alert">{error}</div>}
    {summary && <><div className="logistics-daily-cards"><div><span>Colecta</span><strong>{summary.counts.collection}</strong></div><div><span>Full</span><strong>{summary.counts.full}</strong></div><div><span>Flex</span><strong>{summary.counts.flex}</strong></div><div><span>Total</span><strong>{summary.counts.collection + summary.counts.full + summary.counts.flex}</strong></div></div>
      <div className="logistics-daily-table"><h3>Flex por localidad</h3><table><thead><tr><th>Localidad</th><th>Provincia</th><th>Envíos Flex</th></tr></thead><tbody>{summary.flexByLocality.map((row) => <tr key={`${row.locality}-${row.province}`}><td>{row.locality}</td><td>{row.province || "—"}</td><td><strong>{row.count}</strong></td></tr>)}{!summary.flexByLocality.length && <tr><td colSpan={3}>No hay envíos Flex para hoy en los datos consultados.</td></tr>}</tbody></table></div>
      <p className="logistics-summary-note">Fecha: {summary.day} · actualizado {new Date(summary.checkedAt).toLocaleString("es-AR")}. Flex y Colecta: fecha real de salida si Mercado Libre la informó; si siguen pendientes, fecha límite prevista. Full: fecha real en que Mercado Libre marcó el envío como despachado. Se consultan ventas de los últimos {summary.coverageDays} días.</p>
      {summary.unresolved > 0 && <div className="message info" role="status">Mercado Libre no confirmó fecha o estado de {summary.unresolved} envíos. El resumen puede estar incompleto; reintentá actualizar.</div>}
    </>}
  </section>;
}
