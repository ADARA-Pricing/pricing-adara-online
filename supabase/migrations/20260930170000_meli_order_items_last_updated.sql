-- Fecha de negocio que informa Mercado Libre. `updated_at` es técnico y un
-- trigger lo reemplaza por la hora local de cada upsert, por lo que no sirve
-- para decidir si una venta pertenece al día operativo.
alter table public.mercadolibre_order_items
  add column if not exists meli_last_updated timestamptz;

create index if not exists mercadolibre_order_items_meli_last_updated_idx
  on public.mercadolibre_order_items (meli_last_updated desc);
