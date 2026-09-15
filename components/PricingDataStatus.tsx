"use client";
import type { usePricingLoad } from "@/lib/usePricingLoad";
import { freshness } from "@/lib/pricingData";
import { PricingFixtureNotice } from "./PricingFixtureNotice";

export function PricingDataStatus({ state, publications = [], onRefresh }: { state: ReturnType<typeof usePricingLoad>["state"]; publications?: any[]; onRefresh: () => void }) {
  const coverage = freshness(publications);
  const label = { initial: "Cargando datos guardados…", ready: "Datos disponibles", refreshing: "Actualizando vista; se conservan los últimos datos válidos", partial: "Resultados parciales: faltan páginas por cargar", empty: "Lectura completa, sin registros", error: "No se completó la actualización; los datos visibles pueden ser anteriores o parciales" }[state.phase];
  return <><PricingFixtureNotice /><section className="pricing-data-status" aria-live="polite" aria-busy={["initial", "refreshing", "partial"].includes(state.phase)}>
    <div><strong>{label}</strong><small>{state.source}{state.at ? ` · Última lectura completa ${new Date(state.at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}` : ""}</small>
      <small>{state.coverage}</small>
      {state.dates && <details><summary>Fechas de los registros guardados por conjunto</summary>{Object.entries(state.dates).map(([name, dates]) => <small key={name}>{({ products: 'Productos', publications: 'Publicaciones', sales: 'Ventas', opportunities: 'Ofertas', installments: 'Cuotas', categories: 'Comisiones', taxes: 'Impuestos', margins: 'Objetivos', logs: 'Ejecuciones', guards: 'Controles mayoristas' } as Record<string, string>)[name] || name}: {dates.oldest ? new Date(dates.oldest).toLocaleString('es-AR', {timeZone:'America/Argentina/Buenos_Aires'}) : '—'} a {dates.newest ? new Date(dates.newest).toLocaleString('es-AR', {timeZone:'America/Argentina/Buenos_Aires'}) : '—'} · {dates.missing} sin fecha. No es la fecha de lectura de esta pantalla.</small>)}</details>}
      {coverage.total > 0 && <small>Publicaciones: {coverage.stale} con más de 24 h sin actualizar · {coverage.unknown} sin fecha. Fechas ML: {coverage.oldest ? new Date(coverage.oldest).toLocaleString("es-AR") : "—"} a {coverage.newest ? new Date(coverage.newest).toLocaleString("es-AR") : "—"}. La fecha más reciente no implica cobertura completa.</small>}
      {state.error && <span role="alert">{state.error}</span>}
    </div>
    <button className="button ghost" onClick={onRefresh}>Actualizar vista</button>
  </section></>;
}

export function PricingPagination({ page, total, size = 40, onPage }: { page: number; total: number; size?: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);
  return <nav className="pricing-pagination" aria-label="Paginación de resultados"><span>{total ? (current - 1) * size + 1 : 0}–{Math.min(current * size, total)} de {total}</span><button className="button ghost" disabled={current <= 1} onClick={() => onPage(current - 1)}>Anterior</button><span>Página {current} de {pages}</span><button className="button ghost" disabled={current >= pages} onClick={() => onPage(current + 1)}>Siguiente</button></nav>;
}
