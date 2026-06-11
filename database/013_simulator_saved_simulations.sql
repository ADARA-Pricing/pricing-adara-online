-- Simulaciones guardadas del simulador

create table if not exists public.simulator_saved_simulations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  cost_without_vat numeric not null default 0,
  desired_margin_rate numeric not null default 0,
  sale_price numeric not null default 0,
  vat_condition text not null default 'iva_21',
  shipping_gross numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_simulator_saved_simulations_updated_at
  on public.simulator_saved_simulations (updated_at desc);

create index if not exists idx_simulator_saved_simulations_category
  on public.simulator_saved_simulations (category);
