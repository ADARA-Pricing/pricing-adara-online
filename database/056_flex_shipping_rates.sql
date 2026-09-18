-- Tarifario de logística Flex. Los importes se mantienen editables desde Costo x Canal.
create table if not exists public.flex_shipping_rates (
  id uuid primary key default gen_random_uuid(),
  zone text not null unique,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  vat_included boolean not null default true,
  active boolean not null default true,
  effective_from date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.flex_shipping_rates enable row level security;

drop policy if exists "authenticated users can read flex shipping rates" on public.flex_shipping_rates;
create policy "authenticated users can read flex shipping rates"
on public.flex_shipping_rates for select to authenticated using (true);

drop policy if exists "authenticated users can insert flex shipping rates" on public.flex_shipping_rates;
create policy "authenticated users can insert flex shipping rates"
on public.flex_shipping_rates for insert to authenticated with check (true);

drop policy if exists "authenticated users can update flex shipping rates" on public.flex_shipping_rates;
create policy "authenticated users can update flex shipping rates"
on public.flex_shipping_rates for update to authenticated using (true) with check (true);

drop policy if exists "authenticated users can delete flex shipping rates" on public.flex_shipping_rates;
create policy "authenticated users can delete flex shipping rates"
on public.flex_shipping_rates for delete to authenticated using (true);

create or replace function public.set_flex_shipping_rates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_flex_shipping_rates_updated_at on public.flex_shipping_rates;
create trigger trg_flex_shipping_rates_updated_at
before update on public.flex_shipping_rates
for each row execute function public.set_flex_shipping_rates_updated_at();

insert into public.flex_shipping_rates (zone, amount, vat_included, active, effective_from, notes)
values
  ('CABA', 3850, true, true, '2026-07-06', 'Tarifario Mercado Envíos Flex'),
  ('Primer cordón (GBA1)', 5350, true, true, '2026-07-06', 'Tarifario Mercado Envíos Flex'),
  ('Segundo cordón (GBA2)', 5950, true, true, '2026-07-06', 'Tarifario Mercado Envíos Flex'),
  ('Tercer cordón (GBA3)', 7850, true, true, '2026-07-06', 'Tarifario Mercado Envíos Flex')
on conflict (zone) do update set
  amount = excluded.amount,
  vat_included = excluded.vat_included,
  active = excluded.active,
  effective_from = excluded.effective_from,
  notes = excluded.notes;
