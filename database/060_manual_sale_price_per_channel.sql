-- Preserve a manually entered PVP instead of recalculating it from a rounded
-- target margin when Pricing is reopened.
alter table public.product_channel_margins
  add column if not exists manual_sale_price numeric(14,2)
  check (manual_sale_price is null or manual_sale_price > 0);
