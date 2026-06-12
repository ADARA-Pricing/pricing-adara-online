-- Pricing ADARA v7.47 - múltiples publicaciones de MercadoLibre por SKU/producto

alter table public.mercadolibre_shipping_costs
  add column if not exists meli_price numeric(14,2),
  add column if not exists meli_currency_id text;

alter table public.mercadolibre_shipping_costs
  drop constraint if exists mercadolibre_shipping_costs_product_unique;

drop index if exists idx_mercadolibre_shipping_costs_product_item_unique;
create unique index if not exists idx_mercadolibre_shipping_costs_product_item_unique
  on public.mercadolibre_shipping_costs (product_id, meli_item_id)
  where meli_item_id is not null;

create index if not exists idx_mercadolibre_shipping_costs_product_id
  on public.mercadolibre_shipping_costs (product_id);
