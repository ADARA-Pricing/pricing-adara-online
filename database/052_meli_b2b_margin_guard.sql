-- Protección de precios mayoristas por publicación. No se agrupa por SKU:
-- cada MLA y rango conserva el aporte y el margen con el que fue aprobado.
create table if not exists public.mercadolibre_b2b_margin_guard (
  meli_item_id text not null,
  minimum_purchase_unit integer not null check (minimum_purchase_unit > 1),
  sku text not null,
  target_margin_rate numeric not null,
  required_meli_contribution numeric not null default 0,
  active boolean not null default true,
  last_checked_at timestamptz,
  paused_at timestamptz,
  paused_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (meli_item_id, minimum_purchase_unit)
);

create index if not exists mercadolibre_b2b_margin_guard_active_idx
  on public.mercadolibre_b2b_margin_guard (active, meli_item_id);
