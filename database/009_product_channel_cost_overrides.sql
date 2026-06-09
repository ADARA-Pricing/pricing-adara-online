alter table public.product_channel_margins
add column if not exists structure_amount numeric(14,2) not null default 0;

alter table public.product_channel_margins
add column if not exists manual_shipping_amount numeric(14,2) not null default 0;

alter table public.product_channel_margins
add column if not exists sales_commission_rate numeric(8,4) not null default 0;
