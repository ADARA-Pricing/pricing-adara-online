-- Las hojas oficiales contienen datos de compradores y nunca deben ser públicas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logistics-controls', 'logistics-controls', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf'];

-- Sin políticas para anon/authenticated: acceso únicamente con service role
-- a través de las rutas autenticadas de la aplicación.
