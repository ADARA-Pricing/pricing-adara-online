-- v7.62 - Overrides manuales de promociones compartidas MercadoLibre
-- Usar cuando la API publica no devuelve el split a cargo vendedor / MercadoLibre.

alter table public.mercadolibre_shipping_costs
  add column if not exists meli_promo_meli_amount_override numeric(14,2),
  add column if not exists meli_promo_receive_amount_override numeric(14,2),
  add column if not exists meli_promo_override_notes text;
