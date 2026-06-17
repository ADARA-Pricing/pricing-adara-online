-- Pricing ADARA - sincronizacion de comisiones/categorias desde MercadoLibre

alter table public.mercadolibre_category_fees
  add column if not exists meli_category_ids jsonb not null default '[]'::jsonb,
  add column if not exists meli_category_names jsonb not null default '[]'::jsonb,
  add column if not exists meli_source text,
  add column if not exists meli_last_sync_at timestamptz;

create index if not exists idx_mercadolibre_category_fees_meli_last_sync
  on public.mercadolibre_category_fees (meli_last_sync_at);
