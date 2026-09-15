export type DataPhase = "initial" | "ready" | "refreshing" | "partial" | "empty" | "error";
export type ReadSpec = { table: string; columns?: string; filters?: Array<[string, string, unknown]>; order?: string; ascending?: boolean };
export type ReadResult = { rows: any[]; total: number; complete: boolean };

export function normalizeFilter(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es-AR");
}
export function categoryOptions(values: unknown[]) {
  const labels = new Map<string, string>();
  for (const value of values) if (normalizeFilter(value) && !labels.has(normalizeFilter(value))) labels.set(normalizeFilter(value), String(value).trim());
  return [...labels.values()].sort((a, b) => a.localeCompare(b, "es-AR"));
}

export class LatestRequest {
  private controller?: AbortController;
  private generation = 0;
  begin() {
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    const generation = ++this.generation;
    return { signal: controller.signal, current: () => !controller.signal.aborted && generation === this.generation };
  }
  cancel() { this.controller?.abort(); this.generation++; }
}

// Each page is stable by ID; never silently stop at Supabase's default row cap.
export async function readPages(client: any, spec: ReadSpec, signal: AbortSignal, onPage?: (result: ReadResult) => void): Promise<ReadResult> {
  const rows: any[] = [];
  const seen = new Set<string>();
  let total = 0;
  const size = 500;
  for (let from = 0; ; from += size) {
    signal.throwIfAborted();
    let query = client.from(spec.table).select(spec.columns || "*", { count: "exact" });
    for (const [operator, column, value] of spec.filters || []) query = query[operator](column, value);
    query = query.order(spec.order || "id", { ascending: spec.ascending ?? true });
    if (spec.order && spec.order !== "id") query = query.order("id", { ascending: true });
    const response = await query.range(from, from + size - 1).abortSignal(signal);
    signal.throwIfAborted();
    if (response.error) throw new Error(`${spec.table}: ${response.error.message}`);
    total = Number(response.count ?? total);
    for (const row of response.data || []) {
      const key = row.id == null ? JSON.stringify(row) : String(row.id);
      if (!seen.has(key)) { rows.push(row); seen.add(key); }
    }
    const complete = (response.data || []).length < size || (response.count != null && from + size >= total);
    const result = { rows: [...rows], total: response.count == null ? rows.length : total, complete };
    onPage?.(result);
    if (complete) return result;
  }
}

export function freshness(rows: Array<{ meli_last_sync_at?: string; updated_at?: string }>, now = Date.now()) {
  const dates = rows.map(row => row.meli_last_sync_at).filter(Boolean) as string[];
  const valid = dates.map(Date.parse).filter(Number.isFinite);
  return { total: rows.length, unknown: rows.length - valid.length,
    stale: valid.filter(date => now - date > 86400000).length,
    oldest: valid.length ? new Date(Math.min(...valid)).toISOString() : null,
    newest: valid.length ? new Date(Math.max(...valid)).toISOString() : null };
}

export function datasetDates(rows: any[]) {
  const dates = rows.map(row => Date.parse(row.last_sync_at || row.meli_last_sync_at || row.updated_at || '')).filter(Number.isFinite);
  return { missing: rows.length - dates.length, oldest: dates.length ? new Date(Math.min(...dates)).toISOString() : null, newest: dates.length ? new Date(Math.max(...dates)).toISOString() : null };
}
