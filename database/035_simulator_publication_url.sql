-- Link de publicacion asociado a simulaciones guardadas

alter table public.simulator_saved_simulations
  add column if not exists publication_url text;
