-- Permite eliminar productos desde el módulo Productos.
-- Las tablas relacionadas que referencian products con ON DELETE CASCADE se eliminan automáticamente.

alter table public.products enable row level security;

drop policy if exists "authenticated users can delete products" on public.products;
create policy "authenticated users can delete products"
on public.products for delete
to authenticated
using (true);
