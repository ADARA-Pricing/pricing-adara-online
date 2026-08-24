alter table public.tiendanube_web_banners
add column if not exists show_text boolean not null default true;
