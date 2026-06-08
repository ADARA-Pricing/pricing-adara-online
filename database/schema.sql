-- Pricing ADARA - MVP online
-- Ejecutar este archivo en Supabase > SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  ean text,
  name text not null,
  description text,
  brand text,
  model text,
  category text,
  cost_without_vat numeric(14,2) not null check (cost_without_vat >= 0),
  vat_rate numeric(5,2) not null check (vat_rate in (21, 10.5)),
  cost_with_vat numeric(14,2) generated always as (round(cost_without_vat * (1 + vat_rate / 100), 2)) stored,
  weight_kg numeric(10,3),
  height_cm numeric(10,2),
  width_cm numeric(10,2),
  depth_cm numeric(10,2),
  stock integer default 0 check (stock >= 0),
  supplier text,
  warranty_months integer,
  status text not null default 'active' check (status in ('active', 'paused', 'discontinued')),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_cost_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null,
  previous_cost_without_vat numeric(14,2),
  new_cost_without_vat numeric(14,2),
  previous_vat_rate numeric(5,2),
  new_vat_rate numeric(5,2),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

create or replace function public.set_product_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_product_updated_at();

create or replace function public.log_product_cost_change()
returns trigger
language plpgsql
as $$
begin
  if old.cost_without_vat is distinct from new.cost_without_vat
     or old.vat_rate is distinct from new.vat_rate then
    insert into public.product_cost_history (
      product_id,
      sku,
      previous_cost_without_vat,
      new_cost_without_vat,
      previous_vat_rate,
      new_vat_rate,
      changed_by
    ) values (
      new.id,
      new.sku,
      old.cost_without_vat,
      new.cost_without_vat,
      old.vat_rate,
      new.vat_rate,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_cost_history on public.products;
create trigger trg_products_cost_history
after update on public.products
for each row execute function public.log_product_cost_change();

alter table public.products enable row level security;
alter table public.product_cost_history enable row level security;

-- MVP: todos los usuarios logueados pueden ver, crear y editar productos.
-- Más adelante agregamos roles: admin, editor, lectura.
drop policy if exists "authenticated users can read products" on public.products;
create policy "authenticated users can read products"
on public.products for select
to authenticated
using (true);

drop policy if exists "authenticated users can insert products" on public.products;
create policy "authenticated users can insert products"
on public.products for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update products" on public.products;
create policy "authenticated users can update products"
on public.products for update
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated users can read cost history" on public.product_cost_history;
create policy "authenticated users can read cost history"
on public.product_cost_history for select
to authenticated
using (true);

-- El historial lo escribe el trigger, no la app directamente.
drop policy if exists "authenticated users can insert cost history" on public.product_cost_history;
create policy "authenticated users can insert cost history"
on public.product_cost_history for insert
to authenticated
with check (true);
-- Pricing ADARA - módulo canales y precios
-- Ejecutar en Supabase > SQL Editor si ya corriste schema.sql inicial.

create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  channel_type text,
  installment_count integer,

  default_margin_rate numeric(7,3) not null default 10,
  marketplace_fee_rate numeric(7,3) not null default 0,
  payment_fee_rate numeric(7,3) not null default 0,
  financing_fee_rate numeric(7,3) not null default 0,

  iibb_rate numeric(7,3) not null default 0,
  idc_rate numeric(7,3) not null default 0,
  iigg_rate numeric(7,3) not null default 0,
  structure_rate numeric(7,3) not null default 0,

  fixed_fee numeric(14,2) not null default 0,
  logistics_cost numeric(14,2) not null default 0,
  fee_vat_rate numeric(5,2) not null default 21,

  round_to integer not null default 5,
  rounding_mode text not null default 'nearest' check (rounding_mode in ('nearest', 'up', 'down')),
  active boolean not null default true,
  notes text,

  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.channel_category_rules (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.sales_channels(id) on delete cascade,
  category text not null,

  margin_rate numeric(7,3),
  marketplace_fee_rate numeric(7,3),
  payment_fee_rate numeric(7,3),
  financing_fee_rate numeric(7,3),

  iibb_rate numeric(7,3),
  idc_rate numeric(7,3),
  iigg_rate numeric(7,3),
  structure_rate numeric(7,3),

  fixed_fee numeric(14,2),
  logistics_cost numeric(14,2),

  active boolean not null default true,
  notes text,

  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (channel_id, category)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_sales_channels_updated_at on public.sales_channels;
create trigger trg_sales_channels_updated_at
before update on public.sales_channels
for each row execute function public.set_updated_at();

drop trigger if exists trg_channel_category_rules_updated_at on public.channel_category_rules;
create trigger trg_channel_category_rules_updated_at
before update on public.channel_category_rules
for each row execute function public.set_updated_at();

alter table public.sales_channels enable row level security;
alter table public.channel_category_rules enable row level security;

drop policy if exists "authenticated users can read sales channels" on public.sales_channels;
create policy "authenticated users can read sales channels"
on public.sales_channels for select
to authenticated
using (true);

drop policy if exists "authenticated users can insert sales channels" on public.sales_channels;
create policy "authenticated users can insert sales channels"
on public.sales_channels for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update sales channels" on public.sales_channels;
create policy "authenticated users can update sales channels"
on public.sales_channels for update
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated users can read category rules" on public.channel_category_rules;
create policy "authenticated users can read category rules"
on public.channel_category_rules for select
to authenticated
using (true);

drop policy if exists "authenticated users can insert category rules" on public.channel_category_rules;
create policy "authenticated users can insert category rules"
on public.channel_category_rules for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update category rules" on public.channel_category_rules;
create policy "authenticated users can update category rules"
on public.channel_category_rules for update
to authenticated
using (true)
with check (true);

-- Canales base editables. Son valores iniciales para arrancar; después podés cambiarlos desde la app.
insert into public.sales_channels (
  code, name, channel_type, installment_count, default_margin_rate,
  marketplace_fee_rate, payment_fee_rate, financing_fee_rate,
  iibb_rate, idc_rate, iigg_rate, structure_rate,
  fixed_fee, logistics_cost, round_to, rounding_mode, active, notes
) values
  ('EF', 'Efectivo sin factura', 'Directo', null, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 'nearest', true, 'Canal directo editable'),
  ('TR', 'Transferencia', 'Directo', null, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 'nearest', true, 'Canal directo editable'),
  ('POSNET', 'Tarjeta presencial', 'Local', 1, 8, 0, 6, 0, 0, 0, 0, 0, 0, 0, 5, 'nearest', true, 'Tarjeta local editable'),
  ('TN', 'Tienda Nube', 'Tienda Nube', 1, 10, 0, 5, 0, 0, 0, 0, 0, 0, 0, 100, 'nearest', true, 'Valores iniciales editables'),
  ('TN3', 'Tienda Nube 3 cuotas', 'Tienda Nube', 3, 12, 0, 5, 8, 0, 0, 0, 0, 0, 0, 100, 'nearest', true, 'Valores iniciales editables'),
  ('TNT', 'Tienda Nube transferencia', 'Tienda Nube', null, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 'nearest', true, 'Valores iniciales editables'),
  ('MC', 'Mercado Libre Clásica', 'Mercado Libre', null, 10, 12, 0, 0, 0, 0, 0, 0, 0, 0, 100, 'nearest', true, 'Valores iniciales editables'),
  ('MP3', 'Mercado Libre Premium 3 cuotas', 'Mercado Libre', 3, 12, 12, 0, 8, 0, 0, 0, 0, 0, 0, 100, 'nearest', true, 'Valores iniciales editables'),
  ('MP6', 'Mercado Libre Premium 6 cuotas', 'Mercado Libre', 6, 12, 12, 0, 12, 0, 0, 0, 0, 0, 0, 100, 'nearest', true, 'Valores iniciales editables'),
  ('MP9', 'Mercado Libre Premium 9 cuotas', 'Mercado Libre', 9, 12, 12, 0, 16, 0, 0, 0, 0, 0, 0, 100, 'nearest', true, 'Valores iniciales editables'),
  ('MP12', 'Mercado Libre Premium 12 cuotas', 'Mercado Libre', 12, 12, 12, 0, 20, 0, 0, 0, 0, 0, 0, 100, 'nearest', true, 'Valores iniciales editables')
on conflict (code) do nothing;
