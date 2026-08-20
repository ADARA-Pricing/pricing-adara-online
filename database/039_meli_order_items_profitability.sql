alter table public.mercadolibre_order_items
  add column if not exists listing_type_id text,
  add column if not exists sale_fee_amount numeric(14,2),
  add column if not exists gross_price numeric(14,2),
  add column if not exists actual_installments integer,
  add column if not exists payment_method_id text,
  add column if not exists normalized_option_code text default 'MC',
  add column if not exists normalized_unit_price numeric(14,2),
  add column if not exists normalized_net_sale_price numeric(14,2),
  add column if not exists normalized_net_profit numeric(14,2),
  add column if not exists normalized_total_net_profit numeric(14,2),
  add column if not exists normalized_margin_on_net_sale numeric(8,4),
  add column if not exists normalized_margin_on_cost numeric(8,4),
  add column if not exists normalized_cost_for_profit numeric(14,2),
  add column if not exists normalized_marketplace_fee_amount numeric(14,2),
  add column if not exists normalized_shipping_cost_amount numeric(14,2),
  add column if not exists normalized_fixed_fee_amount numeric(14,2),
  add column if not exists normalized_income_tax_amount numeric(14,2),
  add column if not exists normalized_profit_error text,
  add column if not exists profitability_calculated_at timestamptz;

create index if not exists idx_meli_order_items_profit_period
on public.mercadolibre_order_items (order_date desc, sku, normalized_margin_on_net_sale);

create or replace view public.mercadolibre_product_profitability as
select
  product_id,
  sku,
  count(*) filter (where status <> 'cancelled') as sold_rows,
  coalesce(sum(quantity) filter (where status <> 'cancelled'), 0) as units,
  coalesce(sum(total_amount) filter (where status <> 'cancelled'), 0) as revenue,
  coalesce(sum(normalized_total_net_profit) filter (where status <> 'cancelled'), 0) as normalized_net_profit,
  case
    when coalesce(sum(normalized_net_sale_price * quantity) filter (where status <> 'cancelled'), 0) > 0
      then coalesce(sum(normalized_total_net_profit) filter (where status <> 'cancelled'), 0)
        / sum(normalized_net_sale_price * quantity) filter (where status <> 'cancelled') * 100
    else null
  end as normalized_margin_on_net_sale,
  max(order_date) as last_order_at
from public.mercadolibre_order_items
group by product_id, sku;
