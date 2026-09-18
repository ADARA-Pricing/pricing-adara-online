-- Crédito de Mercado Libre por el envío, distribuido entre los ítems de la orden.
alter table public.mercadolibre_order_items
  add column if not exists shipping_seller_credit_amount numeric(14,2);
