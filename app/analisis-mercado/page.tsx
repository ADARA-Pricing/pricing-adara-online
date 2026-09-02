"use client";

import { useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Search, Trophy } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { moneyWithCents } from "@/lib/pricing";

type CompetitionRow = {
  sku: string; itemId: string; title: string | null; thumbnail: string | null; permalink: string | null;
  catalogProductId: string | null; ownPrice: number | null; priceToWin: number | null; status: string;
  ownFull: boolean; reason: string[]; publicationCount?: number; lowestCompetitor?: number | null; suggestedPrice?: number | null; marginAtSuggested?: number | null; action?: string;
};
type RankedOffer = { itemId: string; price: number | null; nickname: string | null; permalink: string | null; full: boolean; invoiceA: boolean | null; isOwn: boolean };

function statusLabel(status: string) {
  if (status === "winning") return "Ganando catálogo";
  if (status === "sharing_first_place") return "Comparte 1° puesto";
  if (status === "competing") return "Compitiendo";
  if (status === "listed") return "No compite";
  if (status === "error") return "Sin datos";
  return status || "Sin datos";
}

function invoiceLabel(value: boolean | null) {
  if (value === true) return "Factura A";
  if (value === false) return "No Factura A";
  return "Factura sin informar";
}

export default function AnalisisMercadoPage() {
  const [rows, setRows] = useState<CompetitionRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingRanking, setLoadingRanking] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "winning" | "losing" | "expensive" | "cheap" | "no_margin">("all");
  const [applyingSku, setApplyingSku] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ row: CompetitionRow; offers: RankedOffer[] } | null>(null);
  const rankingRef = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const filtered = useMemo(() => rows.filter((row) => {
    const matchesQuery = `${row.sku} ${row.title || ""} ${row.itemId}`.toLowerCase().includes(query.toLowerCase());
    const isWinning = row.status === "winning" || row.status === "sharing_first_place";
    const competitor = Number(row.lowestCompetitor || 0);
    const own = Number(row.ownPrice || 0);
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "winning" && isWinning)
      || (statusFilter === "losing" && !isWinning)
      || (statusFilter === "expensive" && competitor > 0 && own > competitor)
      || (statusFilter === "cheap" && row.action === "subir_y_seguir_ganando")
      || (statusFilter === "no_margin" && row.action === "caro_sin_margen");
    return matchesQuery && matchesStatus;
  }), [rows, query, statusFilter]);
  const losing = rows.filter((row) => row.status === "competing" || row.status === "listed").length;
  const winning = rows.filter((row) => row.status === "winning" || row.status === "sharing_first_place").length;

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/mercadolibre/catalog-competition?summary=1");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo consultar la competencia de catálogo.");
      setRows(data.rows || []); setRefreshedAt(data.refreshedAt || new Date().toISOString());
    } catch (refreshError) { setError(refreshError instanceof Error ? refreshError.message : "No se pudo consultar la competencia."); }
    finally { setLoading(false); }
  }

  async function openRanking(row: CompetitionRow) {
    setLoadingRanking(row.itemId); setError(null);
    try {
      const response = await fetch(`/api/mercadolibre/catalog-competition?itemId=${encodeURIComponent(row.itemId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo traer el ranking de catálogo.");
      setSelected({ row, offers: data.competitors || [] });
      window.setTimeout(() => rankingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch (rankingError) { setError(rankingError instanceof Error ? rankingError.message : "No se pudo traer el ranking."); }
    finally { setLoadingRanking(null); }
  }

  async function applySuggestedPrice(row: CompetitionRow) {
    if (!row.suggestedPrice || !window.confirm(`Vas a cargar ${moneyWithCents(row.suggestedPrice)} en las publicaciones de 1 pago del SKU ${row.sku}.`)) return;
    setApplyingSku(row.sku); setError(null);
    try {
      const response = await fetch("/api/mercadolibre/update-sku-price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku: row.sku, installmentCount: 1, price: row.suggestedPrice }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Mercado Libre no actualizó el precio.");
      await refresh();
    } catch (applyError) { setError(applyError instanceof Error ? applyError.message : "No se pudo actualizar el precio."); }
    finally { setApplyingSku(null); }
  }

  return <main className="page market-analysis-page">
    <PageHero icon={<Trophy size={23} />} title="Métricas de competencia" description="Compará el precio de 1 pago por SKU contra las ofertas reales de catálogo. Solo se muestran SKUs con catálogo activo." actions={<button className="button" onClick={refresh} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />{loading ? "Armando ranking..." : "Actualizar competencia"}</button>} />
    {error ? <div className="notice error">{error}</div> : null}
    <section className="market-summary-grid">
      <div><span>Catálogos consultados</span><strong>{rows.length || "-"}</strong></div>
      <div><span>Ganando / compartiendo</span><strong>{rows.length ? winning : "-"}</strong></div>
      <div><span>Para revisar precio</span><strong>{rows.length ? losing : "-"}</strong></div>
      <div><span>Actualización</span><strong>{refreshedAt ? new Date(refreshedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "Pendiente"}</strong></div>
    </section>
    <section className="card market-results-card">
      <div className="section-heading"><div><h2>SKUs de catálogo</h2><p className="small">Cada fila agrupa las publicaciones del SKU. “Competidor más barato” sale del Top 5 real de ese catálogo.</p></div></div>
      <div className="market-competition-filters"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, producto o MLA" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "winning" | "losing" | "expensive" | "cheap" | "no_margin")}><option value="all">Todos los estados</option><option value="winning">Ganando catálogo</option><option value="losing">Perdiendo / no compite</option><option value="expensive">Caros con margen para ganar</option><option value="no_margin">Caros sin margen de 5%</option><option value="cheap">Baratos: puedo subir</option></select></div>
      {!rows.length && !loading ? <div className="empty-state-box">Actualizá la competencia para consultar tus publicaciones activas de catálogo.</div> : null}
      {filtered.length ? <div className="table-wrap"><table className="market-results-table catalog-competition-table"><thead><tr><th>SKU / producto</th><th>Mi precio 1 pago</th><th>Competidor más barato</th><th>Decisión</th><th>Acción</th><th /></tr></thead><tbody>{filtered.map((row) => { const actionLabel = row.action === "bajar_y_ganar" ? `Bajar a ${moneyWithCents(row.suggestedPrice)} · margen ${row.marginAtSuggested?.toFixed(2)}%` : row.action === "caro_sin_margen" ? `Caro · bajar deja margen ${row.marginAtSuggested?.toFixed(2)}%` : row.action === "subir_y_seguir_ganando" ? `Podés subir a ${moneyWithCents(row.suggestedPrice)} · margen ${row.marginAtSuggested?.toFixed(2)}%` : row.action === "en_precio" ? "Ya está en precio" : "Sin competidor comparable"; const safeAction = row.action === "bajar_y_ganar" || row.action === "subir_y_seguir_ganando"; return <tr key={row.sku}><td className="market-item-cell"><div>{row.thumbnail ? <img src={row.thumbnail} alt="" /> : <span className="market-thumb-placeholder" />}<span><strong>{row.title || row.sku}</strong><p>{row.sku} · {row.publicationCount || 1} publicación{row.publicationCount === 1 ? "" : "es"} · {statusLabel(row.status)}</p></span></div></td><td><strong>{row.ownPrice ? moneyWithCents(row.ownPrice) : "-"}</strong></td><td><strong>{row.lowestCompetitor ? moneyWithCents(row.lowestCompetitor) : "Sin competidor"}</strong></td><td><strong className={row.action === "caro_sin_margen" ? "competition-expensive" : row.action === "bajar_y_ganar" ? "competition-cheap" : ""}>{actionLabel}</strong></td><td>{safeAction ? <button className="button small-button" onClick={() => applySuggestedPrice(row)} disabled={applyingSku === row.sku}>{applyingSku === row.sku ? "Aplicando..." : "Aplicar sugerido"}</button> : "-"}</td><td><button className="button ghost small-button" onClick={() => openRanking(row)} disabled={loadingRanking === row.itemId}>{loadingRanking === row.itemId ? "Buscando..." : "Ver top 5"}</button></td></tr>; })}</tbody></table></div> : null}
    </section>
    {selected ? <section ref={rankingRef} className="card market-results-card"><div className="section-heading"><div><h2>Top 5 en 1 pago · {selected.row.sku}</h2><p className="small">{selected.row.title}</p></div><button className="button ghost small-button" onClick={() => setSelected(null)}>Cerrar</button></div><div className="table-wrap"><table className="market-results-table catalog-competition-table"><thead><tr><th>#</th><th>Vendedor</th><th>Precio 1 pago</th><th>Factura</th><th>Logística</th><th /></tr></thead><tbody>{selected.offers.map((offer, index) => <tr key={offer.itemId}><td><strong>{index + 1}</strong></td><td>{offer.isOwn ? <span className="badge success">Nosotros</span> : <strong>{offer.nickname || offer.itemId}</strong>}</td><td><strong>{offer.price ? moneyWithCents(offer.price) : "-"}</strong></td><td><span className={`badge ${offer.invoiceA ? "success" : ""}`}>{invoiceLabel(offer.invoiceA)}</span></td><td><span className={`badge ${offer.full ? "success" : ""}`}>{offer.full ? "Full" : "No Full"}</span></td><td>{offer.permalink ? <a className="button ghost small-button" href={offer.permalink} target="_blank" rel="noreferrer">Abrir <ExternalLink size={14} /></a> : "-"}</td></tr>)}</tbody></table></div></section> : null}
  </main>;
}
