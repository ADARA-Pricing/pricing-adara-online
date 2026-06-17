-- Pricing ADARA - Datos de comision/financiacion devueltos por MercadoLibre
-- Ejecutar antes de sincronizar para identificar cuotas sin inferir por precio.

alter table public.mercadolibre_shipping_costs
  add column if not exists meli_sale_fee_amount numeric(14,2),
  add column if not exists meli_sale_fee_details jsonb,
  add column if not exists meli_financing_fee_rate numeric(10,4);

create index if not exists idx_mercadolibre_shipping_costs_financing_fee
  on public.mercadolibre_shipping_costs (meli_financing_fee_rate);
