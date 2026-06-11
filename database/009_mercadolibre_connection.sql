-- Conexión MercadoLibre + logs de sincronización de envíos

create table if not exists public.mercadolibre_accounts (
  id uuid primary key default gen_random_uuid(),
  meli_user_id bigint not null unique,
  nickname text,
  access_token text not null,
  refresh_token text,
  token_type text default 'Bearer',
  scope text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.mercadolibre_shipping_sync_logs (
  id uuid primary key default gen_random_uuid(),
  sku text,
  meli_item_id text,
  old_shipping_cost numeric,
  new_shipping_cost numeric,
  status text not null,
  message text,
  created_at timestamptz default now()
);

create index if not exists idx_mercadolibre_shipping_sync_logs_sku
  on public.mercadolibre_shipping_sync_logs (sku);

create index if not exists idx_mercadolibre_shipping_sync_logs_created_at
  on public.mercadolibre_shipping_sync_logs (created_at desc);
