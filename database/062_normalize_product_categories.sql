begin;

update public.products set category = 'Impresoras' where category = 'impresoras';
update public.products set category = 'Smartwatches' where category = 'Smartwatch';
update public.products set category = 'Televisores' where category = 'TV';
update public.products set category = 'Media Streaming' where category = 'Streaming';
update public.products set category = 'Discos Rígidos y SSDs' where category = 'SSD';

-- Keep the fee record with the agreed category name. Each removed row has
-- the same rate and Mercado Libre category IDs as its canonical counterpart.
delete from public.mercadolibre_category_fees as old
using public.mercadolibre_category_fees as canonical
where (old.category, canonical.category) in (
  ('impresoras', 'Impresoras'),
  ('Smartwatch', 'Smartwatches'),
  ('TV', 'Televisores'),
  ('Streaming', 'Media Streaming'),
  ('SSD', 'Discos Rígidos y SSDs')
)
and old.marketplace_fee_rate = canonical.marketplace_fee_rate
and old.marketplace_fee_percent is not distinct from canonical.marketplace_fee_percent
and old.meli_category_ids is not distinct from canonical.meli_category_ids
and old.meli_category_names is not distinct from canonical.meli_category_names;

commit;
