insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tiendanube-web-banners',
  'tiendanube-web-banners',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read tiendanube web banners" on storage.objects;
create policy "public read tiendanube web banners"
on storage.objects for select
to public
using (bucket_id = 'tiendanube-web-banners');
