create table if not exists public.tiendanube_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id bigint not null unique,
  store_name text,
  access_token text not null,
  token_type text,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tiendanube_publications (
  id uuid primary key default gen_random_uuid(),
  tiendanube_store_id bigint not null,
  tiendanube_product_id bigint not null,
  tiendanube_variant_id bigint not null,
  product_id uuid references public.products(id) on delete set null,
  sku text,
  title text,
  variant_name text,
  handle text,
  permalink text,
  price numeric(14,2),
  promotional_price numeric(14,2),
  currency text not null default 'ARS',
  stock numeric(14,2),
  stock_management boolean,
  visibility text,
  published boolean,
  categories jsonb,
  image_url text,
  raw jsonb,
  active boolean not null default true,
  tn_last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiendanube_publications_variant_unique unique (tiendanube_store_id, tiendanube_variant_id)
);

create index if not exists idx_tiendanube_publications_sku on public.tiendanube_publications (upper(sku));
create index if not exists idx_tiendanube_publications_product_id on public.tiendanube_publications (product_id);

alter table public.tiendanube_accounts enable row level security;
alter table public.tiendanube_publications enable row level security;

-- No client-side policy for tiendanube_accounts: tokens are only accessed through server routes with service role.

drop policy if exists "authenticated users can read tiendanube publications" on public.tiendanube_publications;
create policy "authenticated users can read tiendanube publications"
on public.tiendanube_publications for select
to authenticated
using (true);

create or replace function public.set_tiendanube_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tiendanube_accounts_updated_at on public.tiendanube_accounts;
create trigger trg_tiendanube_accounts_updated_at
before update on public.tiendanube_accounts
for each row execute function public.set_tiendanube_updated_at();

drop trigger if exists trg_tiendanube_publications_updated_at on public.tiendanube_publications;
create trigger trg_tiendanube_publications_updated_at
before update on public.tiendanube_publications
for each row execute function public.set_tiendanube_updated_at();
