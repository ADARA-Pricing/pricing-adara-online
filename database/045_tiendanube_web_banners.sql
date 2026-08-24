create table if not exists public.tiendanube_web_banners (
  id uuid primary key default gen_random_uuid(),
  position integer not null default 0,
  title text not null default '',
  subtitle text,
  image_url text not null,
  mobile_image_url text,
  link_url text,
  button_label text,
  text_color text not null default '#ffffff',
  overlay_opacity numeric(4,2) not null default 0.28,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tiendanube_web_banners_active_position
on public.tiendanube_web_banners (active, position);

alter table public.tiendanube_web_banners enable row level security;

drop policy if exists "authenticated users can read tiendanube web banners" on public.tiendanube_web_banners;
create policy "authenticated users can read tiendanube web banners"
on public.tiendanube_web_banners for select
to authenticated
using (true);

create or replace function public.set_tiendanube_web_banners_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tiendanube_web_banners_updated_at on public.tiendanube_web_banners;
create trigger trg_tiendanube_web_banners_updated_at
before update on public.tiendanube_web_banners
for each row execute function public.set_tiendanube_web_banners_updated_at();
