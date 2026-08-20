create or replace function public.recalculate_meli_order_items_profitability(days_back integer default 60)
returns table(updated_count bigint)
language sql
as $$
  with default_taxes as (
    select
      coalesce(iibb_rate, 0)::numeric as iibb_rate,
      coalesce(idc_rate, 0)::numeric as idc_rate,
      coalesce(iigg_rate, 0)::numeric as iigg_rate
    from public.tax_settings
    where key = 'default'
    limit 1
  ),
  scoped as (
    select
      oi.id,
      oi.quantity,
      oi.unit_price,
      p.id as product_id,
      p.category,
      coalesce(p.cost_without_vat, 0)::numeric as cost_without_vat,
      coalesce(p.vat_rate, 21)::numeric as product_vat_rate,
      coalesce(m.cost_vat_rate, 0)::numeric as cost_vat_rate,
      coalesce(m.structure_amount, 0)::numeric as structure_amount,
      coalesce(m.sale_applies_vat, true) as sale_applies_vat,
      coalesce(cf.marketplace_fee_rate, 0)::numeric as marketplace_fee_rate,
      coalesce(sc.fixed_fee_amount, 0)::numeric as fixed_fee_amount_gross,
      coalesce(sc.shipping_cost_amount, 0)::numeric as shipping_cost_amount_gross,
      coalesce(t.iibb_rate, 0)::numeric as iibb_rate,
      coalesce(t.idc_rate, 0)::numeric as idc_rate,
      coalesce(t.iigg_rate, 0)::numeric as iigg_rate
    from public.mercadolibre_order_items oi
    left join public.products p
      on p.id = oi.product_id
      or upper(p.sku) = upper(oi.sku)
    left join public.mercadolibre_shipping_costs sc
      on sc.meli_item_id = oi.meli_item_id
      and sc.active = true
    left join public.mercadolibre_category_fees cf
      on cf.active = true
      and lower(cf.category) = lower(coalesce(p.category, ''))
    left join public.product_channel_margins m
      on m.product_id = p.id
      and m.channel_code = 'MC'
    left join default_taxes t on true
    where oi.order_date >= now() - make_interval(days => greatest(days_back, 1))
      and p.id is not null
      and oi.unit_price > 0
  ),
  calculated as (
    select
      id,
      quantity,
      unit_price,
      case when sale_applies_vat then product_vat_rate else 0 end as sale_vat_rate,
      least(greatest(cost_vat_rate, 0), product_vat_rate) as bounded_cost_vat_rate,
      cost_without_vat + (cost_without_vat * least(greatest(cost_vat_rate, 0), product_vat_rate) / 100) as cost_for_profit,
      fixed_fee_amount_gross / 1.21 as fixed_fee_amount,
      shipping_cost_amount_gross / 1.21 as shipping_cost_amount,
      structure_amount,
      marketplace_fee_rate,
      iibb_rate,
      idc_rate,
      iigg_rate
    from scoped
  ),
  profitability as (
    select
      id,
      quantity,
      unit_price,
      unit_price / (1 + sale_vat_rate / 100) as net_sale_price,
      cost_for_profit,
      fixed_fee_amount,
      shipping_cost_amount,
      (unit_price * marketplace_fee_rate / 100) / 1.21 as marketplace_fee_amount,
      (unit_price / (1 + sale_vat_rate / 100)) * iibb_rate / 100 as iibb_amount,
      (unit_price / (1 + sale_vat_rate / 100)) * idc_rate / 100 as idc_amount,
      iigg_rate
    from calculated
  ),
  final_values as (
    select
      id,
      quantity,
      unit_price,
      net_sale_price,
      cost_for_profit,
      fixed_fee_amount,
      shipping_cost_amount,
      marketplace_fee_amount,
      greatest(
        net_sale_price
        - cost_for_profit
        - fixed_fee_amount
        - shipping_cost_amount
        - marketplace_fee_amount
        - iibb_amount
        - idc_amount,
        0
      ) * iigg_rate / 100 as income_tax_amount,
      net_sale_price
        - cost_for_profit
        - fixed_fee_amount
        - shipping_cost_amount
        - marketplace_fee_amount
        - iibb_amount
        - idc_amount
        - (
          greatest(
            net_sale_price
            - cost_for_profit
            - fixed_fee_amount
            - shipping_cost_amount
            - marketplace_fee_amount
            - iibb_amount
            - idc_amount,
            0
          ) * iigg_rate / 100
        ) as net_profit
    from profitability
  ),
  updated as (
    update public.mercadolibre_order_items oi
    set
      normalized_option_code = 'MC',
      normalized_unit_price = round(fv.unit_price, 2),
      normalized_net_sale_price = round(fv.net_sale_price, 2),
      normalized_net_profit = round(fv.net_profit, 2),
      normalized_total_net_profit = round(fv.net_profit * fv.quantity, 2),
      normalized_margin_on_net_sale = case when fv.net_sale_price > 0 then round((fv.net_profit / fv.net_sale_price) * 100, 4) else null end,
      normalized_margin_on_cost = case when fv.cost_for_profit > 0 then round((fv.net_profit / fv.cost_for_profit) * 100, 4) else null end,
      normalized_cost_for_profit = round(fv.cost_for_profit, 2),
      normalized_marketplace_fee_amount = round(fv.marketplace_fee_amount, 2),
      normalized_shipping_cost_amount = round(fv.shipping_cost_amount, 2),
      normalized_fixed_fee_amount = round(fv.fixed_fee_amount, 2),
      normalized_income_tax_amount = round(fv.income_tax_amount, 2),
      normalized_profit_error = null,
      profitability_calculated_at = now()
    from final_values fv
    where oi.id = fv.id
    returning oi.id
  )
  select count(*)::bigint as updated_count from updated;
$$;
