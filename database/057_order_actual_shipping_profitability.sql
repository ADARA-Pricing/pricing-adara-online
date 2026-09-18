-- Guarda el costo real del envío de cada orden, distribuido entre sus ítems.
alter table public.mercadolibre_order_items
  add column if not exists shipment_id text,
  add column if not exists shipping_logistic_type text,
  add column if not exists shipping_mode text,
  add column if not exists actual_shipping_cost_amount numeric(14,2),
  add column if not exists shipping_cost_source text;

create index if not exists idx_meli_order_items_shipment_id
on public.mercadolibre_order_items (shipment_id);
