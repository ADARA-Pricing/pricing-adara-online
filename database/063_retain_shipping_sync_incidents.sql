-- The dashboard only uses recent sku_not_found incidents. Successful sync
-- records are no longer written by the application.
delete from public.mercadolibre_shipping_sync_logs
where status = 'updated'
   or created_at < now() - interval '7 days';

create index if not exists idx_ml_shipping_sync_logs_recent_missing
  on public.mercadolibre_shipping_sync_logs (created_at desc)
  where status = 'sku_not_found';
