-- v7.60 - Thumbnail de publicaciones MercadoLibre para mostrar foto en Productos

alter table public.mercadolibre_shipping_costs
  add column if not exists meli_thumbnail text;
