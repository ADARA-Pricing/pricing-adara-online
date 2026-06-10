alter table public.product_channel_margins
add column if not exists promo_discount_rate numeric not null default 0;

update public.product_channel_margins
set promo_discount_rate = 0
where promo_discount_rate is null;
