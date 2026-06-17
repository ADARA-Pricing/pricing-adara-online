-- Pricing ADARA - Oportunidades de promociones MercadoLibre
-- Guarda campañas/promos por publicacion para detectar aportes compartidos.

create table if not exists public.mercadolibre_promotion_opportunities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sync_at timestamptz,
  promotion_id text not null,
  promotion_name text,
  promotion_type text,
  promotion_status text,
  item_promotion_status text,
  offer_id text,
  meli_item_id text not null,
  original_price numeric(14,2),
  promo_price numeric(14,2),
  min_discounted_price numeric(14,2),
  max_discounted_price numeric(14,2),
  suggested_discounted_price numeric(14,2),
  seller_percentage numeric(8,4),
  meli_percentage numeric(8,4),
  seller_amount numeric(14,2),
  meli_amount numeric(14,2),
  start_date timestamptz,
  end_date timestamptz,
  raw jsonb
);

create unique index if not exists idx_meli_promotion_opportunities_unique
  on public.mercadolibre_promotion_opportunities (
    promotion_id,
    meli_item_id,
    coalesce(offer_id, ''),
    coalesce(item_promotion_status, '')
  );

create index if not exists idx_meli_promotion_opportunities_item
  on public.mercadolibre_promotion_opportunities (meli_item_id);

create index if not exists idx_meli_promotion_opportunities_meli_amount
  on public.mercadolibre_promotion_opportunities (meli_amount);

alter table public.mercadolibre_promotion_opportunities enable row level security;

drop policy if exists "authenticated users can read meli promotion opportunities" on public.mercadolibre_promotion_opportunities;
create policy "authenticated users can read meli promotion opportunities"
on public.mercadolibre_promotion_opportunities for select
to authenticated
using (true);
