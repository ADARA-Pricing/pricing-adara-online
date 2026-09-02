"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Search, Trophy } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { moneyWithCents } from "@/lib/pricing";

type CompetitionRow = {
  sku: string; itemId: string; title: string | null; thumbnail: string | null; permalink: string | null;
  catalogProductId: string | null; ownPrice: number | null; priceToWin: number | null; status: string;
  ownFull: boolean; reason: string[];
  winner: { itemId: string; price: number | null; nickname: string | null; permalink: string | null; full: boolean; invoiceA: boolean | null; isOwn: boolean } | null;
};

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
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const filtered = useMemo(() => rows.filter((row) => `${row.sku} ${row.title || ""} ${row.itemId}`.toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const losing = rows.filter((row) => row.status === "competing" || row.status === "listed").length;
  const winning = rows.filter((row) => row.status === "winning" || row.status === "sharing_first_place").length;

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/mercadolibre/catalog-competition?limit=120");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo consultar la competencia de catálogo.");
      setRows(data.rows || []); setRefreshedAt(data.refreshedAt || new Date().toISOString());
    } catch (refreshError) { setError(refreshError instanceof Error ? refreshError.message : "No se pudo consultar la competencia."); }
    finally { setLoading(false); }
  }

  return <main className="page market-analysis-page">
    <PageHero icon={<Trophy size={23} />} title="Métricas de competencia" description="Decidí el precio de 1 pago usando la oferta ganadora real del catálogo. Solo se muestran publicaciones de catálogo activas." actions={<button className="button" onClick={refresh} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />{loading ? "Consultando catálogo..." : "Actualizar competencia"}</button>} />
    {error ? <div className="notice error">{error}</div> : null}
    <section className="market-summary-grid">
      <div><span>Catálogos consultados</span><strong>{rows.length || "-"}</strong></div>
      <div><span>Ganando / compartiendo</span><strong>{rows.length ? winning : "-"}</strong></div>
      <div><span>Para revisar precio</span><strong>{rows.length ? losing : "-"}</strong></div>
      <div><span>Actualización</span><strong>{refreshedAt ? new Date(refreshedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "Pendiente"}</strong></div>
    </section>
    <section className="card market-results-card">
      <div className="section-heading"><div><h2>Precio que gana catálogo</h2><p className="small">“Precio para ganar” es la recomendación actual de ML. Si nosotros ya ganamos, ML no publica un segundo competidor confiable.</p></div></div>
      <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, producto o MLA" /></label>
      {!rows.length && !loading ? <div className="empty-state-box">Actualizá la competencia para consultar tus publicaciones activas de catálogo.</div> : null}
      {filtered.length ? <div className="table-wrap"><table className="market-results-table catalog-competition-table"><thead><tr><th>Producto</th><th>Mi precio 1 pago</th><th>Estado catálogo</th><th>Precio para ganar</th><th>Oferta ganadora</th><th>Factura</th><th>Full</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.itemId}><td className="market-item-cell"><div>{row.thumbnail ? <img src={row.thumbnail} alt="" /> : <span className="market-thumb-placeholder" />}<span><strong>{row.title || row.sku}</strong><p>{row.sku} · {row.itemId}</p></span></div></td><td><strong>{row.ownPrice ? moneyWithCents(row.ownPrice) : "-"}</strong></td><td><span className={`badge catalog-status ${row.status}`}>{row.status === "winning" ? <Trophy size={14} /> : null}{statusLabel(row.status)}</span>{row.reason.length ? <p className="small">{row.reason.join(", ")}</p> : null}</td><td><strong>{row.priceToWin ? moneyWithCents(row.priceToWin) : "-"}</strong></td><td>{row.winner ? row.winner.isOwn ? <span className="badge success">Somos nosotros</span> : <span><strong>{row.winner.price ? moneyWithCents(row.winner.price) : "-"}</strong><p className="small">{row.winner.nickname || row.winner.itemId} {row.winner.permalink ? <a href={row.winner.permalink} target="_blank" rel="noreferrer" aria-label="Abrir oferta ganadora"><ExternalLink size={13} /></a> : null}</p></span> : "-"}</td><td>{row.winner ? <span className={`badge ${row.winner.invoiceA ? "success" : ""}`}>{invoiceLabel(row.winner.invoiceA)}</span> : "-"}</td><td><span className={`badge ${row.winner?.full ? "success" : ""}`}>{row.winner?.full ? "Full" : "No Full"}</span></td></tr>)}</tbody></table></div> : null}
    </section>
  </main>;
}
