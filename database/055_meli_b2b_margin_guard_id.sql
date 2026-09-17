-- El lector paginado de la aplicación requiere una clave técnica `id`.
-- Conservamos la clave compuesta de negocio por MLA y rango mayorista.
alter table public.mercadolibre_b2b_margin_guard
  add column if not exists id uuid default gen_random_uuid();

update public.mercadolibre_b2b_margin_guard
  set id = gen_random_uuid()
  where id is null;

alter table public.mercadolibre_b2b_margin_guard
  alter column id set not null;

create unique index if not exists mercadolibre_b2b_margin_guard_id_key
  on public.mercadolibre_b2b_margin_guard (id);
