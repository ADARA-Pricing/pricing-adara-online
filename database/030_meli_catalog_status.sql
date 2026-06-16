-- v7.60 - Datos de catalogo y competencia MercadoLibre

alter table public.mercadolibre_shipping_costs
  add column if not exists meli_catalog_listing boolean,
  add column if not exists meli_catalog_product_id text,
  add column if not exists meli_domain_id text,
  add column if not exists meli_catalog_status text,
  add column if not exists meli_catalog_price_to_win numeric(14,2),
  add column if not exists meli_catalog_current_price numeric(14,2),
  add column if not exists meli_catalog_consistent boolean,
  add column if not exists meli_catalog_visit_share text,
  add column if not exists meli_catalog_competitors_sharing_first_place integer,
  add column if not exists meli_catalog_reason jsonb;

create index if not exists idx_mercadolibre_shipping_costs_catalog_listing
  on public.mercadolibre_shipping_costs (meli_catalog_listing);

create index if not exists idx_mercadolibre_shipping_costs_catalog_status
  on public.mercadolibre_shipping_costs (meli_catalog_status);
