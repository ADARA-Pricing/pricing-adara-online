-- v7.52 - Fix constraint vieja de envíos MercadoLibre
-- Ejecutar en Supabase antes de volver a sincronizar.
-- El error era:
-- duplicate key value violates unique constraint "mercadolibre_shipping_costs_product_id_key"

alter table public.mercadolibre_shipping_costs
  add column if not exists meli_price numeric(14,2),
  add column if not exists meli_currency_id text;

-- Sacamos las restricciones viejas que permitían solo 1 fila por producto.
alter table public.mercadolibre_shipping_costs
  drop constraint if exists mercadolibre_shipping_costs_product_unique;

alter table public.mercadolibre_shipping_costs
  drop constraint if exists mercadolibre_shipping_costs_product_id_key;

-- Re-creamos el índice correcto para permitir varias publicaciones por producto,
-- pero evitando duplicar la misma publicación de MercadoLibre.
drop index if exists idx_mercadolibre_shipping_costs_product_item_unique;

create unique index if not exists idx_mercadolibre_shipping_costs_product_item_unique
  on public.mercadolibre_shipping_costs (product_id, meli_item_id)
  where meli_item_id is not null;

create index if not exists idx_mercadolibre_shipping_costs_product_id
  on public.mercadolibre_shipping_costs (product_id);

create index if not exists idx_mercadolibre_shipping_costs_sku
  on public.mercadolibre_shipping_costs (sku);

create index if not exists idx_mercadolibre_shipping_costs_meli_item_id
  on public.mercadolibre_shipping_costs (meli_item_id);
