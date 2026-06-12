-- v7.61 - Promociones de MercadoLibre para Rentabilidad Meli
-- Ejecutar en Supabase antes de volver a sincronizar publicaciones.

alter table public.mercadolibre_shipping_costs
  add column if not exists meli_original_price numeric(14,2),
  add column if not exists meli_promo_price numeric(14,2),
  add column if not exists meli_promo_name text,
  add column if not exists meli_promo_status text,
  add column if not exists meli_promo_discount_amount numeric(14,2),
  add column if not exists meli_promo_discount_rate numeric(8,4),
  add column if not exists meli_promo_seller_amount numeric(14,2),
  add column if not exists meli_promo_seller_rate numeric(8,4),
  add column if not exists meli_promo_meli_amount numeric(14,2),
  add column if not exists meli_promo_meli_rate numeric(8,4),
  add column if not exists meli_promo_receive_amount numeric(14,2),
  add column if not exists meli_promotions jsonb;

create index if not exists idx_mercadolibre_shipping_costs_promo_status
  on public.mercadolibre_shipping_costs (meli_promo_status);
