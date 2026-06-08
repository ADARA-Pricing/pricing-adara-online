-- Pricing ADARA v5 - Envíos MercadoLibre por producto

create table if not exists public.mercadolibre_shipping_costs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text,
  fixed_fee_amount numeric(14,2) not null default 0,
  shipping_cost_amount numeric(14,2) not null default 0,
  free_shipping boolean not null default true,
  shipping_method text not null default 'mercado_envios' check (shipping_method in ('mercado_envios', 'flex', 'full', 'manual')),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercadolibre_shipping_costs_product_unique unique (product_id)
);

alter table public.mercadolibre_shipping_costs enable row level security;

drop policy if exists "authenticated users can read meli shipping costs" on public.mercadolibre_shipping_costs;
create policy "authenticated users can read meli shipping costs"
on public.mercadolibre_shipping_costs for select
to authenticated
using (true);

drop policy if exists "authenticated users can insert meli shipping costs" on public.mercadolibre_shipping_costs;
create policy "authenticated users can insert meli shipping costs"
on public.mercadolibre_shipping_costs for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update meli shipping costs" on public.mercadolibre_shipping_costs;
create policy "authenticated users can update meli shipping costs"
on public.mercadolibre_shipping_costs for update
to authenticated
using (true)
with check (true);

create or replace function public.set_mercadolibre_shipping_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mercadolibre_shipping_updated_at on public.mercadolibre_shipping_costs;
create trigger trg_mercadolibre_shipping_updated_at
before update on public.mercadolibre_shipping_costs
for each row execute function public.set_mercadolibre_shipping_updated_at();
