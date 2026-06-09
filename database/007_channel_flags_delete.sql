-- Pricing ADARA v6.9
-- Canales configurables, flags de cálculo y eliminación.

alter table public.mercadolibre_installment_fees
add column if not exists channel_type text not null default 'mercadolibre';

alter table public.mercadolibre_installment_fees
add column if not exists applies_marketplace_fee boolean not null default true;

alter table public.mercadolibre_installment_fees
add column if not exists applies_shipping boolean not null default true;

alter table public.mercadolibre_installment_fees
add column if not exists applies_iibb boolean not null default true;

alter table public.mercadolibre_installment_fees
add column if not exists applies_idc boolean not null default true;

alter table public.mercadolibre_installment_fees
add column if not exists applies_iigg boolean not null default true;

alter table public.mercadolibre_installment_fees
add column if not exists applies_structure boolean not null default true;

alter table public.mercadolibre_installment_fees
add column if not exists applies_vat boolean not null default true;

-- Compatibilidad para canales directos ya creados, por ejemplo EF.
update public.mercadolibre_installment_fees
set
  channel_type = 'directo',
  financing_fee_rate = 0,
  installment_count = null,
  applies_marketplace_fee = false,
  applies_shipping = false,
  applies_iibb = false,
  applies_idc = false,
  applies_iigg = false,
  applies_structure = false,
  applies_vat = false
where upper(code) in ('EF', 'EFE', 'EFECTIVO', 'CASH');

-- Si no existe EF, lo dejamos creado como canal directo cash.
insert into public.mercadolibre_installment_fees
(code, name, channel_type, installment_count, financing_fee_rate, applies_marketplace_fee, applies_shipping, applies_iibb, applies_idc, applies_iigg, applies_structure, applies_vat, active, notes)
values
('EF', 'Efectivo', 'directo', null, 0, false, false, false, false, false, false, false, true, 'Canal directo cash sin comisiones ni impuestos')
on conflict (code) do update set
  name = excluded.name,
  channel_type = excluded.channel_type,
  installment_count = excluded.installment_count,
  financing_fee_rate = excluded.financing_fee_rate,
  applies_marketplace_fee = excluded.applies_marketplace_fee,
  applies_shipping = excluded.applies_shipping,
  applies_iibb = excluded.applies_iibb,
  applies_idc = excluded.applies_idc,
  applies_iigg = excluded.applies_iigg,
  applies_structure = excluded.applies_structure,
  applies_vat = excluded.applies_vat,
  active = excluded.active,
  notes = excluded.notes;

-- Políticas de delete para poder eliminar canales/categorías desde la app.
drop policy if exists "authenticated users can delete ml installment fees" on public.mercadolibre_installment_fees;
create policy "authenticated users can delete ml installment fees"
on public.mercadolibre_installment_fees for delete
to authenticated
using (true);

drop policy if exists "authenticated users can delete ml category fees" on public.mercadolibre_category_fees;
create policy "authenticated users can delete ml category fees"
on public.mercadolibre_category_fees for delete
to authenticated
using (true);
