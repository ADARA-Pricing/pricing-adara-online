-- Opciones de costo fijo y responsable del envío para simulaciones guardadas.

alter table public.simulator_saved_simulations
  add column if not exists fixed_fee_gross numeric not null default 0,
  add column if not exists shipping_payer text not null default 'seller'
    check (shipping_payer in ('seller', 'customer'));
