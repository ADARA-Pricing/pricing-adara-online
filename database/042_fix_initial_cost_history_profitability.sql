create or replace function public.product_cost_at(
  target_product_id uuid,
  target_sku text,
  target_at timestamptz
)
returns table (
  cost_without_vat numeric,
  vat_rate numeric,
  source text,
  source_changed_at timestamptz
)
language sql
stable
as $$
  with matched_product as (
    select p.id, p.sku, p.cost_without_vat, p.vat_rate
    from public.products p
    where p.id = target_product_id
       or upper(p.sku) = upper(coalesce(target_sku, ''))
    order by case when p.id = target_product_id then 0 else 1 end
    limit 1
  ),
  candidates as (
    select
      h.new_cost_without_vat as cost_without_vat,
      h.new_vat_rate as vat_rate,
      'history_before'::text as source,
      h.changed_at as source_changed_at,
      1 as priority,
      h.changed_at as sort_at
    from public.product_cost_history h
    join matched_product p on p.id = h.product_id
    where h.changed_at <= target_at

    union all

    select
      coalesce(nullif(h.previous_cost_without_vat, 0), h.new_cost_without_vat) as cost_without_vat,
      coalesce(nullif(h.previous_vat_rate, 0), h.new_vat_rate) as vat_rate,
      case
        when coalesce(h.previous_cost_without_vat, 0) = 0 then 'first_real_cost'
        else 'history_after'
      end as source,
      h.changed_at as source_changed_at,
      2 as priority,
      h.changed_at as sort_at
    from public.product_cost_history h
    join matched_product p on p.id = h.product_id
    where h.changed_at > target_at

    union all

    select
      p.cost_without_vat,
      p.vat_rate,
      'current_product'::text as source,
      null::timestamptz as source_changed_at,
      3 as priority,
      null::timestamptz as sort_at
    from matched_product p
  )
  select c.cost_without_vat, c.vat_rate, c.source, c.source_changed_at
  from candidates c
  where c.cost_without_vat is not null
    and c.vat_rate is not null
  order by
    c.priority,
    case when c.priority = 1 then c.sort_at end desc nulls last,
    case when c.priority = 2 then c.sort_at end asc nulls last
  limit 1;
$$;
