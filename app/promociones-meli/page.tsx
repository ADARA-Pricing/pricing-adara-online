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

type PublicationVariantGroup = {
  key: string;
  title: string;
  catalogProductId: string | null;
  domainId: string | null;
  branchKind: "catalog_listing" | "seller_listing";
  itemIds: string[];
  rows: PublicationPromoRow[];
};

type PublicationPromoRow = {
  publication: MercadoLibreShippingCost;
  opportunities: MercadoLibrePromotionOpportunity[];
  installmentCount: number;
  installmentLabel: string;
  bestOpportunity: MercadoLibrePromotionOpportunity | null;
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

function installmentCampaignTag(publication?: MercadoLibreShippingCost | null) {
  if (!publication) return null;
  const saleTerms = Array.isArray(publication.meli_sale_terms) ? publication.meli_sale_terms : [];
  const searchable = [
    ...(Array.isArray(publication.meli_tags) ? publication.meli_tags : []),
    ...saleTerms.flatMap((term) => {
      const value = term as { id?: string; name?: string; value_name?: string; value_id?: string };
      return [value.id, value.name, value.value_name, value.value_id];
    }),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (searchable.includes("3x_campaign")) return "3x_campaign";
  if (searchable.includes("9x_campaign")) return "9x_campaign";
  if (searchable.includes("12x_campaign")) return "12x_campaign";
  return null;
}

function installmentLabel(publication: MercadoLibreShippingCost) {
  const campaignTag = installmentCampaignTag(publication);
  if (campaignTag === "3x_campaign") return "3 cuotas";
  if (campaignTag === "9x_campaign") return "9 cuotas";
  if (campaignTag === "12x_campaign") return "12 cuotas";
  if (publication.meli_installments_text) return publication.meli_installments_text;
  if (publication.meli_listing_type_id === "gold_special") return "1 pago";
  if (publication.meli_listing_type_id === "gold_pro") return "6 cuotas";
  return "Sin dato";
}

function installmentCountFromLabel(label: string) {
  const normalized = label.toLowerCase();
  const match = normalized.match(/(\d{1,2})\s*(x|cuotas?)/i);
  if (match?.[1]) return Number(match[1]);
  if (normalized.includes("1 pago") || normalized.includes("clasica") || normalized.includes("clásica")) return 1;
  return 999;
}

function publicationTags(publication: MercadoLibreShippingCost) {
  return Array.isArray(publication.meli_tags) ? publication.meli_tags.map((tag) => String(tag)) : [];
}

function publicationBranchKind(publication: MercadoLibreShippingCost): "catalog_listing" | "seller_listing" {
  return publicationTags(publication).includes("user_product_listing") ? "catalog_listing" : "seller_listing";
}

function normalizedPublicationTitle(publication: MercadoLibreShippingCost) {
  return (publication.meli_title || publication.sku || publication.meli_item_id || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(1|3|6|9|12)\s*(x|cuotas?)\b/g, "")
    .replace(/\b(clasica|premium|sin cuotas|con cuotas)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function publicationFamilyKey(publication: MercadoLibreShippingCost) {
  const sku = publication.sku || "sin-sku";
  const branchKind = publicationBranchKind(publication);
  const catalogKey = publication.meli_catalog_product_id
    ? `catalog:${publication.meli_catalog_product_id}`
    : `domain:${publication.meli_domain_id || "sin-domain"}:${normalizedPublicationTitle(publication)}`;
  return `${sku}|${catalogKey}|${branchKind}`;
}

function publicationBranchLabel(branchKind: PublicationVariantGroup["branchKind"]) {
  return branchKind === "catalog_listing" ? "Catalogo ML" : "Publicacion vendedor";
}

function bestOpportunity(items: MercadoLibrePromotionOpportunity[]) {
  if (!items.length) return null;
  return [...items].sort((a, b) => {
    const amountA = Number(a.meli_amount || 0);
    const amountB = Number(b.meli_amount || 0);
    if (amountA !== amountB) return amountB - amountA;
    return Number(a.promo_price || 0) - Number(b.promo_price || 0);
  })[0];
}

export default function PromocionesMeliPage() {
  const router = useRouter();
  const supabase = createClient();

  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [opportunities, setOpportunities] = useState<MercadoLibrePromotionOpportunity[]>([]);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
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

  const selectedGroup = groups.find((group) => productKey(group.product) === selectedKey) || null;

  const selectedPublicationIds = new Set(
    selectedGroup?.publications.map((item) => item.meli_item_id).filter(Boolean) || [],
  );
  const selectedOpportunities = selectedGroup
    ? selectedGroup.opportunities.filter((item) => selectedPublicationIds.has(item.meli_item_id))
    : [];

  const publicationFamilies = useMemo<PublicationVariantGroup[]>(() => {
    if (!selectedGroup) return [];
    const opportunitiesByItem = new Map<string, MercadoLibrePromotionOpportunity[]>();
    selectedOpportunities.forEach((opportunity) => {
      const current = opportunitiesByItem.get(opportunity.meli_item_id) || [];
      current.push(opportunity);
      opportunitiesByItem.set(opportunity.meli_item_id, current);
    });

    const families = new Map<string, PublicationVariantGroup>();

    selectedGroup.publications.forEach((publication) => {
      const label = installmentLabel(publication);
      const count = installmentCountFromLabel(label);
      const rowOpportunities = publication.meli_item_id
        ? opportunitiesByItem.get(publication.meli_item_id) || []
        : [];
      const key = publicationFamilyKey(publication) || publication.meli_item_id || publication.sku || "publicacion";
      const family = families.get(key) || {
        key,
        title: publication.meli_title || publication.meli_item_id || "Publicacion ML",
        catalogProductId: publication.meli_catalog_product_id || null,
        domainId: publication.meli_domain_id || null,
        branchKind: publicationBranchKind(publication),
        itemIds: [],
        rows: [],
      };

      if (publication.meli_item_id && !family.itemIds.includes(publication.meli_item_id)) {
        family.itemIds.push(publication.meli_item_id);
      }

      family.rows.push({
        publication,
        opportunities: rowOpportunities,
        installmentCount: count,
        installmentLabel: count === 1 ? "1 pago" : label,
        bestOpportunity: bestOpportunity(rowOpportunities),
      });
      families.set(key, family);
    });

    return [...families.values()]
      .map((family) => ({
        ...family,
        rows: [...family.rows].sort((a, b) => {
          if (a.installmentCount !== b.installmentCount) return a.installmentCount - b.installmentCount;
          return Number(a.publication.meli_price || 0) - Number(b.publication.meli_price || 0);
        }),
      }))
      .sort((a, b) => {
        const aBest = Math.max(...a.rows.map((row) => Number(row.bestOpportunity?.meli_amount || row.publication.meli_promo_meli_amount || 0)));
        const bBest = Math.max(...b.rows.map((row) => Number(row.bestOpportunity?.meli_amount || row.publication.meli_promo_meli_amount || 0)));
        if (aBest !== bBest) return bBest - aBest;
        return a.title.localeCompare(b.title, "es");
      });
  }, [selectedGroup, selectedOpportunities]);

  return (
    <main className="container wide promociones-meli-page">
      <PageHero
        title="Promociones Meli"
        description="Revisa productos activos en MercadoLibre, sus publicaciones y las promociones disponibles o vigentes detectadas en la ultima sincronizacion."
        onRefresh={loadData}
      />

      {error && <div className="message error">{error}</div>}

      <section className="card promociones-workbar">
        <div className="promociones-current-product">
          <span className="promociones-thumb promociones-current-thumb">
            {selectedGroup?.thumbnail ? <img src={selectedGroup.thumbnail} alt="" /> : selectedGroup?.product.sku.slice(0, 2) || "ML"}
          </span>
          <div>
            <span className="small">Producto seleccionado</span>
            <h2>{selectedGroup ? selectedGroup.product.name : "Elegí un producto para empezar"}</h2>
            <p>
              {selectedGroup
                ? `${selectedGroup.product.sku} | ${selectedGroup.product.category || "Sin categoria"} | Sync ${formatDateTime(selectedGroup.latestSync)}`
                : `${groups.length} productos con publicaciones activas disponibles`}
            </p>
          </div>
        </div>
        <div className="promociones-workbar-actions">
          <div className="promociones-kpis compact">
            <div>
              <span>Productos ML</span>
              <strong>{groups.length}</strong>
            </div>
            <div>
              <span>Publicaciones</span>
              <strong>{selectedGroup?.publications.length || publications.length}</strong>
            </div>
            <div>
              <span>Promos</span>
              <strong>{selectedGroup ? selectedGroup.activePromotionCount + selectedGroup.opportunities.length : opportunities.filter(isCurrentOpportunity).length}</strong>
            </div>
          </div>
          <button className="button" type="button" onClick={() => setProductPickerOpen(true)}>
            Seleccionar producto
          </button>
        </div>
      </section>

      {productPickerOpen && (
        <div className="modal-backdrop promociones-picker-backdrop" onMouseDown={() => setProductPickerOpen(false)}>
          <div className="promociones-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Seleccionar producto</h2>
                <p className="small">Buscá por SKU, nombre, categoría o item de MercadoLibre.</p>
              </div>
              <button className="button ghost" type="button" onClick={() => setProductPickerOpen(false)}>
                Cerrar
              </button>
            </div>
            <div className="field">
              <label>Buscar</label>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="SKU, producto, marca, item ML..."
              />
            </div>
            <div className="promociones-picker-list">
              {loading ? (
                <p>Cargando publicaciones de MercadoLibre...</p>
              ) : (
                filteredGroups.map((group) => {
                  const selected = selectedGroup && productKey(selectedGroup.product) === productKey(group.product);
                  return (
                    <button
                      key={productKey(group.product)}
                      type="button"
                      className={`promociones-picker-row ${selected ? "active" : ""}`}
                      onClick={() => {
                        setSelectedKey(productKey(group.product));
                        setSelectedFamilyKey(null);
                        setProductPickerOpen(false);
                      }}
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
                })
              )}
              {!loading && filteredGroups.length === 0 && (
                <div className="promociones-empty">No hay productos para esa búsqueda.</div>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="card promociones-detail promociones-full-detail">
        {selectedGroup ? (
          <>
            <div className="promociones-detail-header">
              <div>
                <h2>Publicaciones del producto</h2>
                <p>Elegí una publicación para ver sus variantes de 1, 3, 6, 9 y 12 cuotas.</p>
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

            <div className="promociones-family-list">
              {publicationFamilies.map((family) => {
                const expanded = selectedFamilyKey === family.key;
                const bestFamilyAmount = Math.max(...family.rows.map((row) => Number(row.bestOpportunity?.meli_amount || row.publication.meli_promo_meli_amount || 0)));
                const minFamilyPrice = Math.min(...family.rows.map((row) => Number(row.publication.meli_price || 0)).filter((price) => price > 0));
                return (
                  <article className={`promociones-family-card ${expanded ? "expanded" : ""}`} key={family.key}>
                    <button
                      className="promociones-family-button"
                      type="button"
                      onClick={() => setSelectedFamilyKey(expanded ? null : family.key)}
                    >
                      <span className="promociones-family-main">
                        <strong>{family.title}</strong>
                        <small>{family.rows.length} variante(s) de cuotas | desde {Number.isFinite(minFamilyPrice) ? moneyWithCents(minFamilyPrice) : "-"}</small>
                        <small className="promociones-family-meta">
                          {family.catalogProductId ? `Grupo ML ${family.catalogProductId}` : family.domainId || "Grupo ML sin catalogo"}
                          {" | "}
                          {publicationBranchLabel(family.branchKind)}
                          {" | "}
                          {family.itemIds.length} ID(s) asociados
                        </small>
                      </span>
                      <span className="promociones-family-installments">
                        {family.rows.map((row) => (
                          <span key={`${row.publication.meli_item_id}-pill`}>{row.installmentLabel}</span>
                        ))}
                      </span>
                      <span className="promociones-family-best">
                        <small>Mejor aporte ML</small>
                        <strong>{bestFamilyAmount ? moneyWithCents(bestFamilyAmount) : "-"}</strong>
                      </span>
                      <span className="promociones-expand-label">{expanded ? "Ocultar" : "Ver cuotas"}</span>
                    </button>

                    {expanded && (
                      <div className="promociones-installment-grid">
                        {family.rows.map((row) => {
                          const activeMeliAmount = Number(row.publication.meli_promo_meli_amount || 0);
                          const activeSellerAmount = Number(row.publication.meli_promo_seller_amount || 0);
                          const best = row.bestOpportunity;
                          return (
                            <section className="promociones-installment-card" key={row.publication.id || row.publication.meli_item_id}>
                              <div className="promociones-installment-head">
                                <strong>{row.installmentLabel}</strong>
                                <span>{row.publication.meli_listing_type_name || row.publication.meli_listing_type_id || "-"}</span>
                              </div>

                              <div className="promociones-installment-prices">
                                <div>
                                  <span>Precio publicado</span>
                                  <strong>{moneyWithCents(row.publication.meli_price || 0)}</strong>
                                </div>
                                <div>
                                  <span>Precio promo</span>
                                  <strong>{row.publication.meli_promo_price ? moneyWithCents(row.publication.meli_promo_price) : "-"}</strong>
                                </div>
                              </div>

                              <div className="promociones-current-promo">
                                <span>Vigente</span>
                                <strong>{row.publication.meli_promo_name || row.publication.meli_promo_status || "Sin promo activa"}</strong>
                                <small>
                                  Meli {activeMeliAmount ? moneyWithCents(activeMeliAmount) : percent(row.publication.meli_promo_meli_rate || 0)}
                                  {" | "}
                                  Vendedor {activeSellerAmount ? moneyWithCents(activeSellerAmount) : percent(row.publication.meli_promo_seller_rate || 0)}
                                </small>
                              </div>

                              <div className="promociones-best-opportunity">
                                <span>Mejor disponible</span>
                                {best ? (
                                  <>
                                    <strong>{best.promotion_name || best.promotion_id}</strong>
                                    <small>
                                      Precio {best.promo_price ? moneyWithCents(best.promo_price) : "-"}
                                      {" | "}
                                      Meli {best.meli_amount ? moneyWithCents(best.meli_amount) : percent(best.meli_percentage || 0)}
                                    </small>
                                  </>
                                ) : (
                                  <strong>Sin promo disponible detectada</strong>
                                )}
                              </div>

                              <div className="promociones-row-footer">
                                <span>{row.publication.meli_item_id || "-"} | Stock {row.publication.meli_stock ?? "-"}</span>
                                {row.publication.meli_permalink && (
                                  <a href={row.publication.meli_permalink} target="_blank" rel="noreferrer">Abrir</a>
                                )}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="promociones-empty promociones-start-empty">
            <strong>Seleccioná un producto para empezar</strong>
            <span>El listado se abre en un popup para que después trabajes las promociones usando todo el ancho de pantalla.</span>
            <button className="button" type="button" onClick={() => setProductPickerOpen(true)}>
              Seleccionar producto
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
