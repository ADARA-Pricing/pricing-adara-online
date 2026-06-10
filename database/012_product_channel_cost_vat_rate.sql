alter table public.product_channel_margins
add column if not exists cost_vat_rate numeric(10,2) not null default 0;

-- El IVA atribuido al costo se usa para canales directos/efectivo/transferencia
-- cuando se quiere analizar la venta sin IVA en el precio, pero tomando todo
-- o parte del IVA del costo como costo real del producto.
