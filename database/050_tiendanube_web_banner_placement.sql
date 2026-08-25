alter table public.tiendanube_web_banners
add column if not exists placement text not null default 'main_carousel';

update public.tiendanube_web_banners
set placement = 'main_carousel'
where placement is null or placement = '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tiendanube_web_banners_placement_check'
      and conrelid = 'public.tiendanube_web_banners'::regclass
  ) then
    alter table public.tiendanube_web_banners
    add constraint tiendanube_web_banners_placement_check
    check (placement in ('main_carousel', 'promo_strip'));
  end if;
end $$;
