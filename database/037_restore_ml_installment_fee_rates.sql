-- Restaura costos de cuotas ML en escala porcentual.
-- La app espera financing_fee_rate como porcentaje (8.4 = 8,4%), no como decimal (0.084).
update public.mercadolibre_installment_fees
set financing_fee_rate = case code
  when 'MP3' then 8.4
  when 'MP6' then 12.3
  when 'MP9' then 15.7
  when 'MP12' then 19.2
  else financing_fee_rate
end,
notes = case
  when code in ('MP3', 'MP6', 'MP9', 'MP12')
    then 'Restaurado a porcentaje de costo de cuotas ML. No usar escala decimal.'
  else notes
end,
updated_at = now()
where code in ('MP3', 'MP6', 'MP9', 'MP12');
