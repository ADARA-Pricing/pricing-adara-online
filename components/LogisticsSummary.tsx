"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type Summary = {
  day: string;
  checkedAt: string;
  counts: { flex: number; collection: number; full: number };
  flexTiming: { beforeNoon: number; afterNoon: number; unknown: number };
  flexByLocality: Array<{ locality: string; beforeNoon: number; afterNoon: number; unknown: number; count: number }>;
  unresolved: number;
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
      <div className="logistics-daily-cards logistics-flex-shifts"><div><span>Flex · Logística 1 (antes de 12:00)</span><strong>{summary.flexTiming.beforeNoon}</strong></div><div><span>Flex · Logística 2 (desde 12:00)</span><strong>{summary.flexTiming.afterNoon}</strong></div>{summary.flexTiming.unknown > 0 && <div><span>Flex · horario sin confirmar</span><strong>{summary.flexTiming.unknown}</strong></div>}</div>
      <div className="logistics-daily-table"><h3>Flex por localidad y logística</h3><table><thead><tr><th>Localidad</th><th>Logística 1</th><th>Logística 2</th>{summary.flexTiming.unknown > 0 && <th>Sin horario</th>}<th>Total Flex</th></tr></thead><tbody>{summary.flexByLocality.map((row) => <tr key={row.locality}><td>{row.locality}</td><td>{row.beforeNoon}</td><td>{row.afterNoon}</td>{summary.flexTiming.unknown > 0 && <td>{row.unknown}</td>}<td><strong>{row.count}</strong></td></tr>)}{!summary.flexByLocality.length && <tr><td colSpan={summary.flexTiming.unknown > 0 ? 5 : 4}>No hay envíos Flex para hoy en los datos consultados.</td></tr>}</tbody></table></div>
      <p className="logistics-summary-note">El corte se calcula con la hora de creación de la venta en Buenos Aires: Logística 1 antes de las 12:00; Logística 2 desde las 12:00. Las ventas de días anteriores con despacho hoy corresponden a Logística 1. No cambia la asignación al pasar el mediodía.</p>
      <p className="logistics-summary-note">Fecha: {summary.day} · actualizado {new Date(summary.checkedAt).toLocaleString("es-AR")}. Flex y Colecta: fecha real de salida si Mercado Libre la informó; si siguen pendientes, fecha límite prevista. Full: fecha real en que Mercado Libre marcó el envío como despachado. Se consultan ventas de ayer y hoy, más los lotes con despacho hoy; solo se cuentan envíos de hoy.</p>
      {summary.flexTiming.unknown > 0 && <div className="message info" role="status">No se pudo confirmar la hora de venta de {summary.flexTiming.unknown} envíos Flex; quedan separados para no asignarlos a una logística equivocada.</div>}
      {summary.unresolved > 0 && <div className="message info" role="status">Mercado Libre no confirmó fecha o estado de {summary.unresolved} envíos. El resumen puede estar incompleto; reintentá actualizar.</div>}
    </>}
  </section>;
}
