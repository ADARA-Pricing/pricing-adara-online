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
      coalesce(p.cost_without_vat, 0)::numeric as cost_without_vat,
      coalesce(p.vat_rate, 21)::numeric as product_vat_rate,
      coalesce(m.cost_vat_rate, 0)::numeric as cost_vat_rate,
      coalesce(m.structure_amount, 0)::numeric as structure_amount,
      coalesce(m.sale_applies_vat, true) as sale_applies_vat,
      coalesce(cf.marketplace_fee_rate, 0)::numeric as marketplace_fee_rate,
      coalesce(sc.meli_financing_fee_rate, 0)::numeric as actual_financing_fee_rate,
      coalesce(sc.fixed_fee_amount, 0)::numeric as fixed_fee_amount_gross,
      coalesce(sc.shipping_cost_amount, 0)::numeric as shipping_cost_amount_gross,
      coalesce(ref.one_pay_reference_price, oi.unit_price)::numeric as one_pay_reference_price,
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
    left join lateral (
      select
        coalesce(
          min(
            case
              when one_pay.meli_promo_price > 0 and coalesce(one_pay.meli_promo_status, '') ~* 'started|active'
                then one_pay.meli_promo_price
              else one_pay.meli_price
            end
          ) filter (
            where
              coalesce(one_pay.meli_financing_fee_rate, 0) = 0
              or coalesce(one_pay.meli_installments_text, '') ~* '1 pago|clasica|clásica'
          ),
          case
            when oi.unit_price > 0 and coalesce(sc.meli_financing_fee_rate, 0) > 0
              then oi.unit_price / (1 + coalesce(sc.meli_financing_fee_rate, 0) / 100)
            else oi.unit_price
          end
        ) as one_pay_reference_price
      from public.mercadolibre_shipping_costs one_pay
      where one_pay.active = true
        and upper(coalesce(one_pay.sku, '')) = upper(coalesce(oi.sku, p.sku, ''))
    ) ref on true
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
      one_pay_reference_price,
      case when sale_applies_vat then product_vat_rate else 0 end as sale_vat_rate,
      cost_without_vat + (cost_without_vat * least(greatest(cost_vat_rate, 0), product_vat_rate) / 100) as cost_for_profit,
      fixed_fee_amount_gross / 1.21 as fixed_fee_amount,
      shipping_cost_amount_gross / 1.21 as shipping_cost_amount,
      structure_amount,
      marketplace_fee_rate + actual_financing_fee_rate as actual_channel_fee_rate,
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
      one_pay_reference_price,
      one_pay_reference_price / (1 + sale_vat_rate / 100) as one_pay_reference_net_sale_price,
      unit_price / (1 + sale_vat_rate / 100) as actual_net_sale_price,
      cost_for_profit,
      fixed_fee_amount,
      shipping_cost_amount,
      (unit_price * actual_channel_fee_rate / 100) / 1.21 as marketplace_fee_amount,
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
      one_pay_reference_price,
      one_pay_reference_net_sale_price,
      cost_for_profit,
      fixed_fee_amount,
      shipping_cost_amount,
      marketplace_fee_amount,
      greatest(
        actual_net_sale_price
        - cost_for_profit
        - fixed_fee_amount
        - shipping_cost_amount
        - marketplace_fee_amount
        - iibb_amount
        - idc_amount,
        0
      ) * iigg_rate / 100 as income_tax_amount,
      actual_net_sale_price
        - cost_for_profit
        - fixed_fee_amount
        - shipping_cost_amount
        - marketplace_fee_amount
        - iibb_amount
        - idc_amount
        - (
          greatest(
            actual_net_sale_price
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
      normalized_unit_price = round(fv.one_pay_reference_price, 2),
      normalized_net_sale_price = round(fv.one_pay_reference_net_sale_price, 2),
      normalized_net_profit = round(fv.net_profit, 2),
      normalized_total_net_profit = round(fv.net_profit * fv.quantity, 2),
      normalized_margin_on_net_sale = case
        when fv.one_pay_reference_net_sale_price > 0 then round((fv.net_profit / fv.one_pay_reference_net_sale_price) * 100, 4)
        else null
      end,
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
