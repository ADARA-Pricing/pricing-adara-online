-- Pricing ADARA - módulo MercadoLibre + Impuestos configurables
-- Ejecutar en Supabase > SQL Editor después de schema.sql inicial.
-- Si ejecutaste la versión anterior de canales, no pasa nada: estas tablas nuevas quedan separadas.

create table if not exists public.tax_settings (
  key text primary key default 'default',
  iibb_rate numeric(7,3) not null default 0,
  idc_rate numeric(7,3) not null default 0,
  iigg_rate numeric(7,3) not null default 0,
  structure_rate numeric(7,3) not null default 0,
  notes text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mercadolibre_installment_fees (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  installment_count integer,
  financing_fee_rate numeric(7,3) not null default 0,
  default_margin_rate numeric(7,3) not null default 10,
  round_to integer not null default 100,
  rounding_mode text not null default 'nearest' check (rounding_mode in ('nearest', 'up', 'down')),
  active boolean not null default true,
  notes text,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mercadolibre_category_fees (
  id uuid primary key default gen_random_uuid(),
  category text not null unique,
  marketplace_fee_rate numeric(7,3) not null default 0,
  active boolean not null default true,
  notes text,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

drop trigger if exists trg_ml_installment_fees_updated_at on public.mercadolibre_installment_fees;
create trigger trg_ml_installment_fees_updated_at
before update on public.mercadolibre_installment_fees
for each row execute function public.set_updated_at();

drop trigger if exists trg_ml_category_fees_updated_at on public.mercadolibre_category_fees;
create trigger trg_ml_category_fees_updated_at
before update on public.mercadolibre_category_fees
for each row execute function public.set_updated_at();

create or replace function public.set_tax_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_tax_settings_updated_at on public.tax_settings;
create trigger trg_tax_settings_updated_at
before update on public.tax_settings
for each row execute function public.set_tax_settings_updated_at();

alter table public.tax_settings enable row level security;
alter table public.mercadolibre_installment_fees enable row level security;
alter table public.mercadolibre_category_fees enable row level security;

drop policy if exists "authenticated users can read tax settings" on public.tax_settings;
create policy "authenticated users can read tax settings"
on public.tax_settings for select
to authenticated
using (true);

drop policy if exists "authenticated users can insert tax settings" on public.tax_settings;
create policy "authenticated users can insert tax settings"
on public.tax_settings for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update tax settings" on public.tax_settings;
create policy "authenticated users can update tax settings"
on public.tax_settings for update
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated users can read ml installment fees" on public.mercadolibre_installment_fees;
create policy "authenticated users can read ml installment fees"
on public.mercadolibre_installment_fees for select
to authenticated
using (true);

drop policy if exists "authenticated users can insert ml installment fees" on public.mercadolibre_installment_fees;
create policy "authenticated users can insert ml installment fees"
on public.mercadolibre_installment_fees for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update ml installment fees" on public.mercadolibre_installment_fees;
create policy "authenticated users can update ml installment fees"
on public.mercadolibre_installment_fees for update
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated users can read ml category fees" on public.mercadolibre_category_fees;
create policy "authenticated users can read ml category fees"
on public.mercadolibre_category_fees for select
to authenticated
using (true);

drop policy if exists "authenticated users can insert ml category fees" on public.mercadolibre_category_fees;
create policy "authenticated users can insert ml category fees"
on public.mercadolibre_category_fees for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update ml category fees" on public.mercadolibre_category_fees;
create policy "authenticated users can update ml category fees"
on public.mercadolibre_category_fees for update
to authenticated
using (true)
with check (true);

insert into public.tax_settings (key, iibb_rate, idc_rate, iigg_rate, structure_rate, notes)
values ('default', 0, 0, 0, 0, 'Impuestos globales configurables')
on conflict (key) do nothing;

-- Costo de cuotas de MercadoLibre. Estos valores son iniciales y editables.
insert into public.mercadolibre_installment_fees (
  code, name, installment_count, financing_fee_rate, default_margin_rate, round_to, rounding_mode, active, notes
) values
  ('MC', 'Mercado Libre Clásica', null, 0, 10, 100, 'nearest', true, 'Sin costo de cuotas'),
  ('MP3', 'Mercado Libre Premium 3 cuotas', 3, 0, 10, 100, 'nearest', true, 'Completar costo de cuotas'),
  ('MP6', 'Mercado Libre Premium 6 cuotas', 6, 0, 10, 100, 'nearest', true, 'Completar costo de cuotas'),
  ('MP9', 'Mercado Libre Premium 9 cuotas', 9, 0, 10, 100, 'nearest', true, 'Completar costo de cuotas'),
  ('MP12', 'Mercado Libre Premium 12 cuotas', 12, 0, 10, 100, 'nearest', true, 'Completar costo de cuotas')
on conflict (code) do nothing;

-- Categorías base tomadas de tu planilla. Las comisiones quedan en 0 para que las completes con tus valores reales.
insert into public.mercadolibre_category_fees (category, marketplace_fee_rate, active, notes) values
  ('Aspiradoras', 0, true, 'Completar comisión MercadoLibre'),
  ('Audio', 0, true, 'Completar comisión MercadoLibre'),
  ('Celulares', 0, true, 'Completar comisión MercadoLibre'),
  ('Compresor aire', 0, true, 'Completar comisión MercadoLibre'),
  ('Controles', 0, true, 'Completar comisión MercadoLibre'),
  ('Discos SSD', 0, true, 'Completar comisión MercadoLibre'),
  ('Freidora Aire', 0, true, 'Completar comisión MercadoLibre'),
  ('Lamparas led', 0, true, 'Completar comisión MercadoLibre'),
  ('Linterna', 0, true, 'Completar comisión MercadoLibre'),
  ('Microondas', 0, true, 'Completar comisión MercadoLibre'),
  ('Monitores', 0, true, 'Completar comisión MercadoLibre'),
  ('Mouse y teclado', 0, true, 'Completar comisión MercadoLibre'),
  ('Notebooks', 0, true, 'Completar comisión MercadoLibre'),
  ('Pinturas', 0, true, 'Completar comisión MercadoLibre'),
  ('Sanwichera', 0, true, 'Completar comisión MercadoLibre'),
  ('Smartwatch', 0, true, 'Completar comisión MercadoLibre'),
  ('Streaming', 0, true, 'Completar comisión MercadoLibre'),
  ('TV', 0, true, 'Completar comisión MercadoLibre'),
  ('Tablets', 0, true, 'Completar comisión MercadoLibre')
on conflict (category) do nothing;
