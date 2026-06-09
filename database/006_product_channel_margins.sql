create table if not exists public.product_channel_margins (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text,
  channel_code text not null,
  desired_margin_rate numeric(8,4) not null default 5,
  desired_net_profit numeric(14,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, channel_code)
);

alter table public.product_channel_margins enable row level security;

drop policy if exists "authenticated users can read product channel margins" on public.product_channel_margins;
create policy "authenticated users can read product channel margins"
on public.product_channel_margins for select
to authenticated
using (true);

drop policy if exists "authenticated users can insert product channel margins" on public.product_channel_margins;
create policy "authenticated users can insert product channel margins"
on public.product_channel_margins for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update product channel margins" on public.product_channel_margins;
create policy "authenticated users can update product channel margins"
on public.product_channel_margins for update
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated users can delete product channel margins" on public.product_channel_margins;
create policy "authenticated users can delete product channel margins"
on public.product_channel_margins for delete
to authenticated
using (true);
