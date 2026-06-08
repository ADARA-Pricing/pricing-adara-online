-- Pricing ADARA v4 - limpieza de MercadoLibre y precios
-- Ejecutar en Supabase > SQL Editor.
-- Deja MercadoLibre separado en:
-- 1) costos por cuotas: MP3, MP6, MP9, MP12
-- 2) comisiones por categoría: TV, Celulares, Audio, etc.
-- Ganancia deseada y redondeo no pertenecen a MercadoLibre; se usan solo en la pantalla Precios.

alter table public.mercadolibre_category_fees
add column if not exists marketplace_fee_rate numeric(7,3) not null default 0;

-- Por compatibilidad con una migración anterior que creó marketplace_fee_percent.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mercadolibre_category_fees'
      and column_name = 'marketplace_fee_percent'
  ) then
    update public.mercadolibre_category_fees
    set marketplace_fee_rate = marketplace_fee_percent
    where marketplace_fee_rate = 0
      and marketplace_fee_percent is not null;
  end if;
end $$;

-- MC no es costo por cuotas. ML Clásica se calcula con la comisión de categoría.
delete from public.mercadolibre_installment_fees
where code = 'MC';

-- Dejamos solo los planes premium como base.
insert into public.mercadolibre_installment_fees (
  code, name, installment_count, financing_fee_rate, active, notes
) values
  ('MP3', 'Mercado Libre Premium 3 cuotas', 3, 0, true, 'Completar costo de cuotas'),
  ('MP6', 'Mercado Libre Premium 6 cuotas', 6, 0, true, 'Completar costo de cuotas'),
  ('MP9', 'Mercado Libre Premium 9 cuotas', 9, 0, true, 'Completar costo de cuotas'),
  ('MP12', 'Mercado Libre Premium 12 cuotas', 12, 0, true, 'Completar costo de cuotas')
on conflict (code) do update set
  name = excluded.name,
  installment_count = excluded.installment_count,
  active = excluded.active;
