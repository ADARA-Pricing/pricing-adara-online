alter table public.product_channel_margins
add column if not exists sale_applies_vat boolean;

update public.product_channel_margins pcm
set sale_applies_vat = coalesce(mif.applies_vat, false)
from public.mercadolibre_installment_fees mif
where pcm.channel_code = mif.code
  and pcm.sale_applies_vat is null;

update public.product_channel_margins
set sale_applies_vat = true
where channel_code = 'MC'
  and sale_applies_vat is null;

update public.product_channel_margins
set sale_applies_vat = false
where sale_applies_vat is null;
