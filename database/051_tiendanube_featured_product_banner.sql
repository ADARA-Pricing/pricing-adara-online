do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'tiendanube_web_banners_placement_check'
      and conrelid = 'public.tiendanube_web_banners'::regclass
  ) then
    alter table public.tiendanube_web_banners
    drop constraint tiendanube_web_banners_placement_check;
  end if;

  alter table public.tiendanube_web_banners
  add constraint tiendanube_web_banners_placement_check
  check (placement in ('main_carousel', 'promo_strip', 'featured_product'));
end $$;
