"use client";

import { FormEvent, useMemo, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { moneyWithCents, percent } from "@/lib/pricing";

type MarketItem = {
  id: string;
  title: string;
  price: number;
  originalPrice: number | null;
  permalink: string;
  thumbnail: string | null;
  condition: string | null;
  listingTypeId: string | null;
  channel: string;
  availableQuantity: number | null;
  soldQuantity: number | null;
  catalogListing: boolean;
  catalogProductId: string | null;
  categoryId: string | null;
  sellerId: number | null;
  sellerNickname: string | null;
  acceptsMercadoPago: boolean;
  freeShipping: boolean;
  logisticType: string | null;
  shippingMode: string | null;
  tags: string[];
  priceToWin: number | null;
  rawPriceToWinStatus: string | null;
};

type ChannelSummary = {
  channel: string;
  count: number;
  bestPrice: number | null;
  bestItem: MarketItem | null;
};

type CatalogSummary = {
  key: string;
  title: string;
  count: number;
  bestPrice: number | null;
  bestItem: MarketItem | null;
};

type MarketResponse = {
  query: string;
  categoryId: string | null;
  generatedAt: string;
  items: MarketItem[];
  summary: {
    totalItems: number;
    sellerCount: number;
    minPrice: number | null;
    maxPrice: number | null;
    avgPrice: number | null;
    catalogCount: number;
    fullCount: number;
    visibleStock: number;
    visibleSoldQuantity: number;
    byChannel: ChannelSummary[];
    byCatalog: CatalogSummary[];
  };
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

function channelLabel(channel: string) {
  const labels: Record<string, string> = {
    MC: "Clásica / 1 pago",
    MP3: "Premium / 3 cuotas",
    MP6: "Premium / 6 cuotas",
    MP9: "Premium / 9 cuotas",
    MP12: "Premium / 12 cuotas",
    Premium: "Premium",
  };
  return labels[channel] || channel || "Sin dato";
}

function logisticLabel(item: MarketItem) {
  if (item.logisticType === "fulfillment") return "Full";
  if (item.logisticType === "xd_drop_off") return "Drop off";
  if (item.logisticType === "self_service") return "Flex";
  if (item.freeShipping) return "Envío gratis";
  return item.shippingMode || "-";
}

function marginForPrice(price: number | null, inputs: SimulationInputs) {
  if (!price) return null;
  const cost = Number(inputs.costWithoutVat || 0);
  const categoryFee = Number(inputs.categoryFeeRate || 0);
  const taxes = Number(inputs.taxRate || 0);
  const shipping = Number(inputs.shippingCost || 0);
  if (!cost) return null;

  const revenueWithoutVat = price / (1 + Number(inputs.vatRate || 21) / 100);
  const variableCosts = price * ((categoryFee + taxes) / 100) + shipping;
  const profit = revenueWithoutVat - cost - variableCosts;
  return {
    profit,
    marginRate: revenueWithoutVat ? (profit / revenueWithoutVat) * 100 : null,
  };
}

type SimulationInputs = {
  costWithoutVat: string;
  vatRate: string;
  categoryFeeRate: string;
  taxRate: string;
  shippingCost: string;
};

const emptySimulation: SimulationInputs = {
  costWithoutVat: "",
  vatRate: "21",
  categoryFeeRate: "13",
  taxRate: "11",
  shippingCost: "",
};

export default function MarketAnalysisPage() {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [limit, setLimit] = useState("30");
  const [inputs, setInputs] = useState<SimulationInputs>(emptySimulation);
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bestItem = data?.items?.[0] || null;
  const bestCatalog = data?.summary.byCatalog.find((group) => group.bestItem?.catalogListing);

  const opportunity = useMemo(() => {
    if (!data) return null;
    const minPrice = data.summary.minPrice;
    const simulation = marginForPrice(minPrice, inputs);
    if (!simulation) return "Cargá tu costo para saber si conviene entrar al mercado.";
    if (simulation.profit > 0) {
      return `Podés competir contra el menor precio visible con una ganancia estimada de ${moneyWithCents(simulation.profit)} (${percent(simulation.marginRate)}).`;
    }
    return `El menor precio visible deja una pérdida estimada de ${moneyWithCents(Math.abs(simulation.profit))}. Conviene buscar otra estrategia o mejor costo.`;
  }, [data, inputs]);

  function updateInput(key: keyof SimulationInputs, value: string) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  async function analyze(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/mercadolibre/market-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          categoryId,
          limit: Number(limit || 30),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "No se pudo analizar el mercado.");
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo analizar el mercado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container wide market-analysis-page">
      <PageHero
        title="Análisis de Mercado"
        description="Buscá productos en MercadoLibre, medí competencia y estimá si conviene entrar."
        onRefresh={() => analyze()}
      />

      {error && <div className="message error">{error}</div>}

      <section className="card market-search-card">
        <form className="market-search-grid" onSubmit={analyze}>
          <div className="field market-query-field">
            <label>Producto a analizar</label>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ej: Tablet Xiaomi Redmi Pad 2 8GB 256GB" />
          </div>
          <div className="field">
            <label>Dominio ML opcional</label>
            <input value={categoryId} onChange={(event) => setCategoryId(event.target.value)} placeholder="MLA-TABLETS" />
          </div>
          <div className="field">
            <label>Resultados</label>
            <select value={limit} onChange={(event) => setLimit(event.target.value)}>
              <option value="20">20</option>
              <option value="30">30</option>
              <option value="50">50</option>
            </select>
          </div>
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Analizando..." : "Analizar mercado"}
          </button>
        </form>
      </section>

      <section className="market-layout">
        <section className="card market-simulation-card">
          <h2>Simulación rápida</h2>
          <p className="small">Usá estos datos para estimar si competir contra el mercado tiene margen.</p>
          <div className="market-simulation-grid">
            <div className="field">
              <label>Costo sin IVA</label>
              <input value={inputs.costWithoutVat} onChange={(event) => updateInput("costWithoutVat", event.target.value)} placeholder="0" />
            </div>
            <div className="field">
              <label>IVA</label>
              <select value={inputs.vatRate} onChange={(event) => updateInput("vatRate", event.target.value)}>
                <option value="21">21%</option>
                <option value="10.5">10,5%</option>
              </select>
            </div>
            <div className="field">
              <label>Comisión ML %</label>
              <input value={inputs.categoryFeeRate} onChange={(event) => updateInput("categoryFeeRate", event.target.value)} />
            </div>
            <div className="field">
              <label>Impuestos %</label>
              <input value={inputs.taxRate} onChange={(event) => updateInput("taxRate", event.target.value)} />
            </div>
            <div className="field market-wide-field">
              <label>Envío estimado</label>
              <input value={inputs.shippingCost} onChange={(event) => updateInput("shippingCost", event.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="market-opportunity-box">{opportunity || "Buscá un producto para generar una recomendación."}</div>
        </section>

        <section className="card market-summary-card">
          <h2>Resumen mercado</h2>
          <div className="market-summary-grid">
            <div><span>Publicaciones</span><strong>{data?.summary.totalItems ?? "-"}</strong></div>
            <div><span>Vendedores</span><strong>{data?.summary.sellerCount ?? "-"}</strong></div>
            <div><span>Mejor precio</span><strong>{moneyWithCents(data?.summary.minPrice)}</strong></div>
            <div><span>Precio promedio</span><strong>{moneyWithCents(data?.summary.avgPrice)}</strong></div>
            <div><span>Catálogo</span><strong>{data ? `${data.summary.catalogCount}` : "-"}</strong></div>
            <div><span>Full</span><strong>{data ? `${data.summary.fullCount}` : "-"}</strong></div>
            <div><span>Stock visible</span><strong>{data?.summary.visibleStock ?? "-"}</strong></div>
            <div><span>Ventas visibles</span><strong>{data?.summary.visibleSoldQuantity ?? "-"}</strong></div>
          </div>
          <p className="small market-data-note">
            Ventas y stock son datos visibles/acumulados que MercadoLibre expone. Para ventas por semana hay que guardar histórico.
          </p>
        </section>
      </section>

      {data && (
        <>
          <section className="card market-channel-card">
            <div className="section-title-row">
              <div>
                <h2>Mejor precio por opción</h2>
                <p className="small">Ordenado por tipo de publicación/cuotas detectado desde MercadoLibre.</p>
              </div>
              <span className="badge">Actualizado {formatDateTime(data.generatedAt)}</span>
            </div>
            <div className="market-channel-grid">
              {data.summary.byChannel.map((channel) => {
                const simulation = marginForPrice(channel.bestPrice, inputs);
                return (
                  <article key={channel.channel} className="market-channel-tile">
                    <span>{channelLabel(channel.channel)}</span>
                    <strong>{moneyWithCents(channel.bestPrice)}</strong>
                    <p>{channel.count} publicaciones</p>
                    {simulation ? (
                      <em className={simulation.profit >= 0 ? "positive-money" : "negative-money"}>
                        {moneyWithCents(simulation.profit)} / {percent(simulation.marginRate)}
                      </em>
                    ) : (
                      <em>Sin costo cargado</em>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="card market-insights-card">
            <h2>Lectura rápida</h2>
            <div className="market-insights-grid">
              <div>
                <span>Precio ganador visible</span>
                <strong>{bestItem ? moneyWithCents(bestItem.price) : "-"}</strong>
                <p>{bestItem?.title || "-"}</p>
              </div>
              <div>
                <span>Catálogo más barato</span>
                <strong>{bestCatalog?.bestPrice ? moneyWithCents(bestCatalog.bestPrice) : "-"}</strong>
                <p>{bestCatalog?.bestItem?.catalogProductId || "No detectado"}</p>
              </div>
              <div>
                <span>Precio para ganar</span>
                <strong>{data.items.some((item) => item.priceToWin) ? moneyWithCents(Math.min(...data.items.map((item) => item.priceToWin || Infinity).filter(Number.isFinite))) : "-"}</strong>
                <p>Disponible solo cuando ML lo expone para la publicación.</p>
              </div>
            </div>
          </section>

          <section className="card market-results-card">
            <div className="section-title-row">
              <div>
                <h2>Competidores detectados</h2>
                <p className="small">Resultados de MercadoLibre ordenados por precio.</p>
              </div>
              <span className="badge">{data.items.length} resultados</span>
            </div>
            {data.items.length === 0 ? (
              <div className="empty-state-box">
                No encontramos ofertas activas para productos de catálogo con esa búsqueda. Probá con un nombre más específico o con un dominio ML.
              </div>
            ) : (
            <div className="table-wrap market-results-table">
              <table>
                <thead>
                  <tr>
                    <th>Publicación</th>
                    <th>Canal</th>
                    <th>Precio</th>
                    <th>Precio ganar</th>
                    <th>Stock</th>
                    <th>Ventas</th>
                    <th>Logística</th>
                    <th>Catálogo</th>
                    <th>Rentabilidad</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => {
                    const simulation = marginForPrice(item.priceToWin || item.price, inputs);
                    return (
                      <tr key={item.id}>
                        <td className="market-item-cell">
                          <div>
                            {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span className="market-thumb-placeholder" />}
                            <div>
                              <strong>{item.title}</strong>
                              <p>{item.id} · {item.condition || "-"} · {item.sellerNickname || item.sellerId || "Vendedor"}</p>
                            </div>
                          </div>
                        </td>
                        <td><span className="badge">{channelLabel(item.channel)}</span></td>
                        <td><strong>{moneyWithCents(item.price)}</strong></td>
                        <td>{item.priceToWin ? <strong>{moneyWithCents(item.priceToWin)}</strong> : "-"}</td>
                        <td>{item.availableQuantity ?? "-"}</td>
                        <td>{item.soldQuantity ?? "-"}</td>
                        <td>{logisticLabel(item)}</td>
                        <td>{item.catalogListing ? <span className="badge market-catalog-badge">Catálogo</span> : "-"}</td>
                        <td>
                          {simulation ? (
                            <span className={simulation.profit >= 0 ? "positive-money" : "negative-money"}>
                              {moneyWithCents(simulation.profit)}
                              <br />
                              <small>{percent(simulation.marginRate)}</small>
                            </span>
                          ) : (
                            <span className="small">Cargá costo</span>
                          )}
                        </td>
                        <td><a className="button ghost small-button" href={item.permalink} target="_blank" rel="noreferrer">Abrir</a></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
