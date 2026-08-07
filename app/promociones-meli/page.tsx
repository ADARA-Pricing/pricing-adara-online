"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { moneyWithCents, percent } from "@/lib/pricing";
import type {
  MercadoLibrePromotionOpportunity,
  MercadoLibreShippingCost,
  Product,
} from "@/lib/types";

type ProductPromoGroup = {
  product: Product;
  publications: MercadoLibreShippingCost[];
  opportunities: MercadoLibrePromotionOpportunity[];
  activePromotionCount: number;
  bestMeliAmount: number;
  bestMeliRate: number;
  minPrice: number | null;
  thumbnail: string | null;
  latestSync: string | null;
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

function isCurrentOpportunity(item: MercadoLibrePromotionOpportunity) {
  const status = `${item.promotion_status || ""} ${item.item_promotion_status || ""}`.toLowerCase();
  if (/finished|expired|ended|cancel|closed|inactive/.test(status)) return false;
  const end = item.end_date ? new Date(item.end_date).getTime() : 0;
  return !end || end > Date.now();
}

function productKey(product: Product) {
  return product.id || product.sku;
}

export default function PromocionesMeliPage() {
  const router = useRouter();
  const supabase = createClient();

  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [opportunities, setOpportunities] = useState<MercadoLibrePromotionOpportunity[]>([]);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function loadData() {
    setLoading(true);
    setError(null);

    const [productsResponse, publicationsResponse, opportunitiesResponse] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .neq("status", "discontinued")
        .order("name", { ascending: true }),
      supabase
        .from("mercadolibre_shipping_costs")
        .select("*")
        .eq("active", true)
        .eq("meli_status", "active")
        .order("updated_at", { ascending: false }),
      supabase
        .from("mercadolibre_promotion_opportunities")
        .select("*")
        .order("meli_amount", { ascending: false }),
    ]);

    setLoading(false);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);

    if (publicationsResponse.error) setError(publicationsResponse.error.message);
    else setPublications((publicationsResponse.data || []) as MercadoLibreShippingCost[]);

    if (opportunitiesResponse.error) setError(opportunitiesResponse.error.message);
    else setOpportunities((opportunitiesResponse.data || []) as MercadoLibrePromotionOpportunity[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo<ProductPromoGroup[]>(() => {
    const productsById = new Map(products.map((product) => [product.id, product]));
    const productsBySku = new Map(products.map((product) => [product.sku, product]));
    const opportunitiesByItem = new Map<string, MercadoLibrePromotionOpportunity[]>();

    opportunities.filter(isCurrentOpportunity).forEach((opportunity) => {
      const current = opportunitiesByItem.get(opportunity.meli_item_id) || [];
      current.push(opportunity);
      opportunitiesByItem.set(opportunity.meli_item_id, current);
    });

    const map = new Map<string, ProductPromoGroup>();

    publications.forEach((publication) => {
      const product =
        productsById.get(publication.product_id) ||
        (publication.sku ? productsBySku.get(publication.sku) : undefined);
      if (!product) return;

      const key = productKey(product);
      const publicationOpportunities = publication.meli_item_id
        ? opportunitiesByItem.get(publication.meli_item_id) || []
        : [];
      const current = map.get(key) || {
        product,
        publications: [],
        opportunities: [],
        activePromotionCount: 0,
        bestMeliAmount: 0,
        bestMeliRate: 0,
        minPrice: null,
        thumbnail: null,
        latestSync: null,
      };

      current.publications.push(publication);
      current.opportunities.push(...publicationOpportunities);
      current.activePromotionCount += publication.meli_promo_price ? 1 : 0;
      current.bestMeliAmount = Math.max(
        current.bestMeliAmount,
        Number(publication.meli_promo_meli_amount || 0),
        ...publicationOpportunities.map((item) => Number(item.meli_amount || 0)),
      );
      current.bestMeliRate = Math.max(
        current.bestMeliRate,
        Number(publication.meli_promo_meli_rate || 0),
        ...publicationOpportunities.map((item) => Number(item.meli_percentage || 0)),
      );

      const price = Number(publication.meli_price || publication.meli_promo_price || 0);
      if (price > 0) current.minPrice = current.minPrice === null ? price : Math.min(current.minPrice, price);
      if (!current.thumbnail && publication.meli_thumbnail) current.thumbnail = publication.meli_thumbnail;
      const sync = publication.meli_last_sync_at || publication.updated_at || null;
      if (sync && (!current.latestSync || sync > current.latestSync)) current.latestSync = sync;

      map.set(key, current);
    });

    return [...map.values()].sort((a, b) => {
      if (a.bestMeliAmount !== b.bestMeliAmount) return b.bestMeliAmount - a.bestMeliAmount;
      return (a.product.name || "").localeCompare(b.product.name || "", "es");
    });
  }, [products, publications, opportunities]);

  const filteredGroups = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return groups;
    return groups.filter((group) => {
      const haystack = [
        group.product.sku,
        group.product.name,
        group.product.brand,
        group.product.model,
        group.product.category,
        ...group.publications.map((item) => `${item.meli_item_id || ""} ${item.meli_title || ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(value);
    });
  }, [groups, query]);

  const selectedGroup =
    filteredGroups.find((group) => productKey(group.product) === selectedKey) ||
    filteredGroups[0] ||
    null;

  const selectedPublicationIds = new Set(
    selectedGroup?.publications.map((item) => item.meli_item_id).filter(Boolean) || [],
  );
  const selectedOpportunities = selectedGroup
    ? selectedGroup.opportunities.filter((item) => selectedPublicationIds.has(item.meli_item_id))
    : [];

  return (
    <main className="container wide promociones-meli-page">
      <PageHero
        title="Promociones Meli"
        description="Revisa productos activos en MercadoLibre, sus publicaciones y las promociones disponibles o vigentes detectadas en la ultima sincronizacion."
        onRefresh={loadData}
      />

      {error && <div className="message error">{error}</div>}

      <section className="card promociones-toolbar">
        <div className="field">
          <label>Buscar producto o publicacion</label>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedKey(null);
            }}
            placeholder="SKU, producto, marca, item ML..."
          />
        </div>
        <div className="promociones-kpis">
          <div>
            <span>Productos activos ML</span>
            <strong>{groups.length}</strong>
          </div>
          <div>
            <span>Publicaciones activas</span>
            <strong>{publications.length}</strong>
          </div>
          <div>
            <span>Promos detectadas</span>
            <strong>{opportunities.filter(isCurrentOpportunity).length}</strong>
          </div>
        </div>
      </section>

      <section className="promociones-layout">
        <div className="card promociones-product-list">
          <div className="promociones-card-header">
            <h2>Productos disponibles</h2>
            <span>{filteredGroups.length} resultados</span>
          </div>

          {loading ? (
            <p>Cargando publicaciones de MercadoLibre...</p>
          ) : (
            <div className="promociones-products">
              {filteredGroups.map((group) => {
                const selected = selectedGroup && productKey(selectedGroup.product) === productKey(group.product);
                return (
                  <button
                    key={productKey(group.product)}
                    type="button"
                    className={`promociones-product-row ${selected ? "active" : ""}`}
                    onClick={() => setSelectedKey(productKey(group.product))}
                  >
                    <span className="promociones-thumb">
                      {group.thumbnail ? <img src={group.thumbnail} alt="" /> : group.product.sku.slice(0, 2)}
                    </span>
                    <span className="promociones-product-main">
                      <strong>{group.product.name}</strong>
                      <span>{group.product.sku} | {group.product.category || "Sin categoria"}</span>
                    </span>
                    <span className="promociones-product-meta">
                      <strong>{group.publications.length}</strong>
                      <span>pub.</span>
                    </span>
                    <span className="promociones-product-meta">
                      <strong>{group.activePromotionCount + group.opportunities.length}</strong>
                      <span>promos</span>
                    </span>
                  </button>
                );
              })}
              {filteredGroups.length === 0 && (
                <div className="promociones-empty">
                  No hay productos con publicaciones activas sincronizadas.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card promociones-detail">
          {selectedGroup ? (
            <>
              <div className="promociones-detail-header">
                <div>
                  <h2>{selectedGroup.product.name}</h2>
                  <p>{selectedGroup.product.sku} | {selectedGroup.product.category || "Sin categoria"} | Sync {formatDateTime(selectedGroup.latestSync)}</p>
                </div>
                <div className="promociones-detail-stats">
                  <div>
                    <span>Precio ML desde</span>
                    <strong>{selectedGroup.minPrice ? moneyWithCents(selectedGroup.minPrice) : "-"}</strong>
                  </div>
                  <div>
                    <span>Mejor aporte ML</span>
                    <strong>{selectedGroup.bestMeliAmount ? moneyWithCents(selectedGroup.bestMeliAmount) : percent(selectedGroup.bestMeliRate)}</strong>
                  </div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="promociones-table">
                  <thead>
                    <tr>
                      <th>Publicacion</th>
                      <th>Precio</th>
                      <th>Promo vigente</th>
                      <th>Aporte vendedor</th>
                      <th>Aporte Meli</th>
                      <th>Disponibles detectadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedGroup.publications.map((publication) => {
                      const publicationOpportunities = selectedOpportunities.filter(
                        (item) => item.meli_item_id === publication.meli_item_id,
                      );
                      return (
                        <tr key={publication.id || publication.meli_item_id || publication.sku}>
                          <td>
                            <div className="promociones-publication-cell">
                              <strong>{publication.meli_title || publication.meli_item_id || "Publicacion ML"}</strong>
                              <span>{publication.meli_item_id || "-"} | Stock {publication.meli_stock ?? "-"}</span>
                              {publication.meli_permalink && (
                                <a href={publication.meli_permalink} target="_blank" rel="noreferrer">Abrir publicacion</a>
                              )}
                            </div>
                          </td>
                          <td>
                            <strong>{moneyWithCents(publication.meli_price || 0)}</strong>
                            {publication.meli_promo_price && <span className="promociones-muted">Promo {moneyWithCents(publication.meli_promo_price)}</span>}
                          </td>
                          <td>
                            {publication.meli_promo_name || publication.meli_promo_status ? (
                              <div className="promociones-promo-current">
                                <strong>{publication.meli_promo_name || "Promo activa"}</strong>
                                <span>{publication.meli_promo_status || "-"}</span>
                              </div>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>{publication.meli_promo_seller_amount ? moneyWithCents(publication.meli_promo_seller_amount) : percent(publication.meli_promo_seller_rate || 0)}</td>
                          <td>{publication.meli_promo_meli_amount ? moneyWithCents(publication.meli_promo_meli_amount) : percent(publication.meli_promo_meli_rate || 0)}</td>
                          <td>
                            {publicationOpportunities.length ? (
                              <div className="promociones-opportunities">
                                {publicationOpportunities.slice(0, 3).map((item) => (
                                  <div key={`${item.promotion_id}-${item.offer_id || ""}-${item.item_promotion_status || ""}`}>
                                    <strong>{item.promotion_name || item.promotion_id}</strong>
                                    <span>
                                      Precio {item.promo_price ? moneyWithCents(item.promo_price) : "-"} | Meli {item.meli_amount ? moneyWithCents(item.meli_amount) : percent(item.meli_percentage || 0)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              "Sin promos disponibles detectadas"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="promociones-empty">
              Selecciona un producto para ver sus publicaciones y promociones.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
