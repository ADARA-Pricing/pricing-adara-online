-- v7.51 - Fix múltiple publicaciones MercadoLibre por SKU/producto
-- Ejecutar antes de volver a sincronizar.
-- Permite guardar varias publicaciones de MercadoLibre para un mismo producto.

alter table public.mercadolibre_shipping_costs
  add column if not exists meli_price numeric(14,2),
  add column if not exists meli_currency_id text;

alter table public.mercadolibre_shipping_costs
  drop constraint if exists mercadolibre_shipping_costs_product_unique;

drop index if exists idx_mercadolibre_shipping_costs_product_item_unique;

create unique index if not exists idx_mercadolibre_shipping_costs_product_item_unique
  on public.mercadolibre_shipping_costs (product_id, meli_item_id);

create index if not exists idx_mercadolibre_shipping_costs_product_id
  on public.mercadolibre_shipping_costs (product_id);

create index if not exists idx_mercadolibre_shipping_costs_sku
  on public.mercadolibre_shipping_costs (sku);
