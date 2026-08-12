-- Proveedor opcional asociado a simulaciones guardadas.

alter table public.simulator_saved_simulations
  add column if not exists provider text;

create index if not exists idx_simulator_saved_simulations_provider
  on public.simulator_saved_simulations (provider);
