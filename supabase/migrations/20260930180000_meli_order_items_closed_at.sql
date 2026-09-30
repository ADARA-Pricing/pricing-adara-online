-- Fecha de cierre/pago informada por Mercado Libre. Es el criterio operativo
-- de “Ventas de hoy”: una orden creada antes no cuenta hasta quedar cerrada.
alter table public.mercadolibre_order_items
  add column if not exists meli_closed_at timestamptz;

create index if not exists mercadolibre_order_items_meli_closed_at_idx
  on public.mercadolibre_order_items (meli_closed_at desc);
