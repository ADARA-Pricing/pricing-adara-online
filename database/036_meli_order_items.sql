create table if not exists public.mercadolibre_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  order_date timestamptz not null,
  status text,
  pack_id text,
  meli_item_id text not null,
  variation_id text not null default '',
  sku text not null default '',
  product_id uuid references public.products(id) on delete set null,
  title text,
  quantity integer not null default 0 check (quantity >= 0),
  unit_price numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  currency_id text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, meli_item_id, variation_id, sku)
);

create index if not exists idx_meli_order_items_order_date
on public.mercadolibre_order_items (order_date desc);

create index if not exists idx_meli_order_items_sku
on public.mercadolibre_order_items (sku);

create index if not exists idx_meli_order_items_product_id
on public.mercadolibre_order_items (product_id);

create index if not exists idx_meli_order_items_meli_item_id
on public.mercadolibre_order_items (meli_item_id);

alter table public.mercadolibre_order_items enable row level security;

drop policy if exists "authenticated users can read mercadolibre order items" on public.mercadolibre_order_items;
create policy "authenticated users can read mercadolibre order items"
on public.mercadolibre_order_items for select
to authenticated
using (true);

create or replace function public.set_meli_order_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_meli_order_items_updated_at on public.mercadolibre_order_items;
create trigger trg_meli_order_items_updated_at
before update on public.mercadolibre_order_items
for each row execute function public.set_meli_order_items_updated_at();
