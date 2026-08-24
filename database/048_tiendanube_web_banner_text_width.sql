alter table public.tiendanube_web_banners
add column if not exists text_width_desktop numeric(5,2) not null default 46;
