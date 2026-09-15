-- Apply separately, never as part of a test. Atomic replacement only for MLAs
-- whose authoritative per-item endpoint returned a complete response.
create or replace function public.replace_meli_promotion_snapshot(p_item_ids text[], p_rows jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare item_id text; inserted integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Expected array'; end if;
  if p_item_ids is null then raise exception 'Expected MLA scope'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where (r->>'meli_item_id' = any(p_item_ids)) is not true) then
    raise exception 'Promotion outside requested MLA scope';
  end if;
  -- Consistent lock order prevents concurrent snapshots deleting each other.
  for item_id in select distinct unnest(p_item_ids) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('meli-promos:' || item_id, 0));
  end loop;
  delete from public.mercadolibre_promotion_opportunities where meli_item_id = any(p_item_ids);
  insert into public.mercadolibre_promotion_opportunities
  select * from jsonb_populate_recordset(null::public.mercadolibre_promotion_opportunities,
    coalesce((select jsonb_agg(r || jsonb_build_object('id', gen_random_uuid(), 'created_at', now())) from jsonb_array_elements(p_rows) r), '[]'::jsonb));
  get diagnostics inserted = row_count;
  return inserted;
end $$;
revoke all on function public.replace_meli_promotion_snapshot(text[], jsonb) from public, anon, authenticated;
grant execute on function public.replace_meli_promotion_snapshot(text[], jsonb) to service_role;
