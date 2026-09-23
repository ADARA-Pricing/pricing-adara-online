-- Lotes de impresión y preparación de envíos. Acceso sólo desde rutas autenticadas
-- del servidor mediante service role; no se exponen filas por la API pública.
create table if not exists public.logistics_batches (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('cross_docking', 'self_service')),
  dispatch_day date not null,
  status text not null default 'printed' check (status in ('printed', 'collecting', 'packing', 'completed')),
  shipments jsonb not null check (jsonb_typeof(shipments) = 'array' and jsonb_array_length(shipments) between 1 and 50),
  staged jsonb not null default '{}'::jsonb,
  packed jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_logistics_batches_created_at on public.logistics_batches (created_at desc);
alter table public.logistics_batches enable row level security;

create table if not exists public.product_eans (
  ean text primary key check (ean ~ '^[0-9]{8,14}$'),
  sku text not null references public.products(sku) on update cascade on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_product_eans_sku on public.product_eans (sku);
alter table public.product_eans enable row level security;

insert into public.product_eans (ean, sku)
select trim(ean), sku from public.products
where trim(coalesce(ean, '')) ~ '^[0-9]{8,14}$'
on conflict (ean) do nothing;
