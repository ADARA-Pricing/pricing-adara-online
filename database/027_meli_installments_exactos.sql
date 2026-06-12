-- v7.59 - Datos reales de cuotas/tipo de publicación MercadoLibre
-- Ejecutar en Supabase antes de volver a sincronizar.

alter table public.mercadolibre_shipping_costs
  add column if not exists meli_listing_type_id text,
  add column if not exists meli_listing_type_name text,
  add column if not exists meli_sale_terms jsonb,
  add column if not exists meli_tags jsonb,
  add column if not exists meli_installments_text text;

create index if not exists idx_mercadolibre_shipping_costs_listing_type
  on public.mercadolibre_shipping_costs (meli_listing_type_id);
