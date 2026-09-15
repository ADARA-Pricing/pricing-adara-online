"use client";
import { useEffect, useRef, useState } from "react";
import { LatestRequest, readPages, datasetDates, type DataPhase, type ReadSpec, type ReadResult } from "./pricingData";

const snapshots = new Map<string, { data: Record<string, ReadResult>; at: string }>();
export function usePricingLoad(module: string, client: any) {
  const requests = useRef(new LatestRequest());
  const [state, setState] = useState<{ phase: DataPhase; at: string | null; error: string | null; coverage: string; source: string; dates?: Record<string, ReturnType<typeof datasetDates>> }>({ phase: "initial", at: null, error: null, coverage: "", source: "Base guardada" });
  const hasData = useRef(false);
  const owner = useRef<string | null>(null);
  const clearVisible = useRef<(() => void) | null>(null);
  useEffect(() => {
    const requestManager = requests.current;
    const { data } = client.auth.onAuthStateChange((event: string, session: any) => {
      if (event === "SIGNED_OUT" || (owner.current && session?.user?.id && owner.current !== session.user.id)) {
        snapshots.clear(); requestManager.cancel(); hasData.current = false; owner.current = null;
        clearVisible.current?.();
        setState({ phase: 'initial', at: null, error: null, coverage: '', source: 'Base guardada' });
      }
    });
    return () => { requestManager.cancel(); data.subscription.unsubscribe(); };
  }, [client]);

  async function run(specs: Record<string, ReadSpec>, apply: (data: Record<string, any[]>) => void, force = true) {
    const ticket = requests.current.begin();
    const start = performance.now();
    const applyData = (data: Record<string, ReadResult>) => apply(Object.fromEntries(Object.entries(data).map(([key, result]) => [key, result.rows])));
    try {
      const { data: auth } = await client.auth.getSession();
      if (!ticket.current()) return;
      if (!auth.session?.user?.id) throw new Error("Sesión no disponible. Volvé a iniciar sesión.");
      if (owner.current && owner.current !== auth.session.user.id) {
        clearVisible.current?.(); hasData.current = false;
        setState({ phase: 'initial', at: null, error: null, coverage: '', source: 'Base guardada' });
      }
      owner.current = auth.session.user.id;
      clearVisible.current = () => apply(Object.fromEntries(Object.keys(specs).map(name => [name, []])));
      const key = JSON.stringify([auth.session.user.id, module, specs]);
      const cached = snapshots.get(key);
      if (cached) {
        applyData(cached.data); hasData.current = true;
        setState({ phase: force ? "refreshing" : "ready", at: cached.at, error: null, coverage: "Copia válida de esta sesión", source: "Caché por usuario y consulta", dates: Object.fromEntries(Object.entries(cached.data).map(([name, result]) => [name, datasetDates(result.rows)])) });
        if (!force && Date.now() - Date.parse(cached.at) < 60000) return;
      }
      setState(previous => ({ ...previous, phase: hasData.current ? "refreshing" : "initial", error: null }));
      const results: Record<string, ReadResult> = {};
      let firstUseful = false;
      const entries = Object.entries(specs);
      await Promise.all(entries.map(async ([name, spec]) => {
        await readPages(client, spec, ticket.signal, result => {
          if (!ticket.current()) return;
          results[name] = result;
          const labels: Record<string, string> = { products: "Productos", publications: "Publicaciones", sales: "Ventas", opportunities: "Ofertas", settings: "Configuración", logs: "Ejecuciones", installments: "Cuotas", categories: "Comisiones", taxes: "Impuestos", margins: "Objetivos", guards: "Controles mayoristas" };
          const coverage = entries.map(([id]) => `${labels[id] || id}: ${results[id]?.rows.length ?? "—"}/${results[id]?.total ?? "—"}`).join(" · ");
          if (entries.every(([id]) => results[id]) && !hasData.current) {
            if (!firstUseful) { performance.measure(`pricing:${module}:first-useful`, { start, end: performance.now() }); firstUseful = true; }
            applyData(results);
            setState(previous => ({ ...previous, phase: "partial", coverage, source: "Base guardada, lectura parcial", dates: Object.fromEntries(Object.entries(results).map(([id, result]) => [id, datasetDates(result.rows)])) }));
          } else setState(previous => ({ ...previous, coverage }));
        });
      }));
      if (!ticket.current()) return;
      const at = new Date().toISOString();
      applyData(results); hasData.current = true;
      snapshots.set(key, { data: results, at });
      if (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value!);
      setState(previous => ({ ...previous, phase: Object.values(results).some(result => result.rows.length) ? "ready" : "empty", at, source: "Base guardada, lectura completa", dates: Object.fromEntries(Object.entries(results).map(([id, result]) => [id, datasetDates(result.rows)])) }));
      performance.measure(`pricing:${module}:complete`, { start, end: performance.now() });
    } catch (error) {
      if (!ticket.current()) return;
      requests.current.cancel();
      setState(previous => ({ ...previous, phase: "error", error: error instanceof Error ? error.message : "No se pudieron cargar los datos." }));
    }
  }
  return { state, run, initial: !state.at && state.source !== "Base guardada, lectura parcial", incomplete: !["ready", "empty"].includes(state.phase) };
}
