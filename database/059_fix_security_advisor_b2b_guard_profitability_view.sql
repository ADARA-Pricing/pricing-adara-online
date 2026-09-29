-- Security Advisor: RLS Disabled in Public.
-- The dashboard reads the guard as an authenticated user; server-side jobs use
-- the service role for writes. No anonymous or direct client writes are needed.
alter table public.mercadolibre_b2b_margin_guard enable row level security;

revoke all on table public.mercadolibre_b2b_margin_guard from anon, authenticated;
grant select on table public.mercadolibre_b2b_margin_guard to authenticated;

create policy "authenticated users can read b2b margin guard"
  on public.mercadolibre_b2b_margin_guard
  for select
  to authenticated
  using (true);

-- Security Advisor: Security Definer View.
-- Evaluate the view with the caller's permissions and the source table's RLS.
alter view public.mercadolibre_product_profitability
  set (security_invoker = true);

revoke all on table public.mercadolibre_product_profitability from anon;
