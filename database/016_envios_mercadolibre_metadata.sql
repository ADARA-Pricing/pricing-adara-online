-- v7.43 - Datos de publicación MercadoLibre para envíos
-- Agrega información útil para pricing/envíos sin convertir la app en auditoría.

alter table public.mercadolibre_shipping_costs
add column if not exists meli_item_id text;

alter table public.mercadolibre_shipping_costs
add column if not exists meli_title text;

alter table public.mercadolibre_shipping_costs
add column if not exists meli_permalink text;

alter table public.mercadolibre_shipping_costs
add column if not exists meli_status text;

alter table public.mercadolibre_shipping_costs
add column if not exists meli_stock numeric;

alter table public.mercadolibre_shipping_costs
add column if not exists meli_free_shipping boolean;

alter table public.mercadolibre_shipping_costs
add column if not exists meli_shipping_mode text;

alter table public.mercadolibre_shipping_costs
add column if not exists meli_logistic_type text;

alter table public.mercadolibre_shipping_costs
add column if not exists meli_cost_source text;

alter table public.mercadolibre_shipping_costs
add column if not exists meli_last_sync_at timestamptz;

create index if not exists idx_mercadolibre_shipping_costs_meli_item_id
  on public.mercadolibre_shipping_costs (meli_item_id);

create index if not exists idx_mercadolibre_shipping_costs_meli_status
  on public.mercadolibre_shipping_costs (meli_status);
