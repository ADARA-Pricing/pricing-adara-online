# Pricing ADARA review package

Este paquete esta preparado para revisar externamente la pantalla Rotacion SKU y sus posibles colisiones visuales con estilos globales, Productos, tablas, botones, filtros e imagenes.

## Como correr el proyecto

```bash
npm install
npm run dev
```

Crear un `.env.local` propio a partir de `.env.example`. No se incluyen secretos ni datos productivos.

Variables esperadas:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MELI_CLIENT_ID=
MELI_CLIENT_SECRET=
MELI_REDIRECT_URI=
```

## Rutas locales principales

- Rotacion SKU: `http://localhost:3000/rotacion-sku`
- Productos: `http://localhost:3000/productos`
- Dashboard: `http://localhost:3000/dashboard`
- Promociones Meli: `http://localhost:3000/promociones-meli`

## Archivos principales para revisar primero

- Rotacion SKU: `app/rotacion-sku/page.tsx`
- Productos como referencia visual: `app/productos/page.tsx`
- CSS global y posibles colisiones: `app/globals.css`
- Layout raiz: `app/layout.tsx`
- Shell/sidebar/iconografia: `components/AppShell.tsx`, `components/AppNav.tsx`
- Page header reutilizable: `components/PageHero.tsx`
- Tipos compartidos: `lib/types.ts`
- Cliente Supabase: `lib/supabase.ts`, `lib/supabaseAdmin.ts`
- Helpers de precios/formato: `lib/pricing.ts`
- MercadoLibre helpers: `lib/mercadolibre.ts`
- Sync ventas ML: `app/api/mercadolibre/sync-sales/route.ts`
- Sync publicaciones/envios/stock ML: `app/api/mercadolibre/sync-shipping/route.ts`
- Fixture sanitizado auxiliar: `docs/review/rotation-sku-fixtures.json`

## Arquitectura relevante

1. Rotacion SKU carga datos client-side desde Supabase en `app/rotacion-sku/page.tsx`.
2. Consulta productos activos desde `products`.
3. Consulta publicaciones activas desde `mercadolibre_shipping_costs` para stock y publicaciones.
4. Consulta publicaciones activas e inactivas desde `mercadolibre_shipping_costs` para resolver imagenes.
5. Consulta ventas recientes desde `mercadolibre_order_items` con `fetchSalesSince`.
6. La sincronizacion de ventas/stock se dispara desde el boton de Rotacion SKU llamando a `/api/mercadolibre/sync-shipping` y luego `/api/mercadolibre/sync-sales`.
7. El calculo de 7/30/60 dias se hace en memoria sobre `sales` dentro del `useMemo` `rows`.
8. Sorting y filtros de Rotacion SKU son client-side.
9. Las imagenes de Rotacion SKU se resuelven con `productImage(imagePublications)` y se renderizan en `RotationThumbnail`.
10. Productos tiene su propio resolver `productImage(shippings)` y usa `.product-thumb` definido en `app/globals.css`.
11. Rotacion SKU usa `.rotation-product-thumb` definido localmente en `app/rotacion-sku/page.tsx`, con reglas `:global(.rotation-page .rotation-product-thumb)` para evitar heredar tamanos de Productos.
12. Los estilos globales de botones estan en `app/globals.css` bajo `.button`, `.item-action` y variantes.
13. Los estilos globales de tablas estan en `app/globals.css` bajo `table`, `th`, `td`, `.table-wrap` y tambien hay estilos especificos por pantalla.
14. El proyecto no usa Tailwind config. Usa CSS global (`app/globals.css`) mas CSS local con `style jsx` en algunas paginas.

## Puntos de revision visual

- Revisar selectores globales en `app/globals.css`: `button`, `input`, `select`, `table`, `th`, `td`, `.button`, `.card`, `.badge`, `.item-action`.
- Revisar si `.rotation-sort-trigger` necesita `all: unset` y reglas `!important` por colisiones con `.button` o `button`.
- Revisar si `thead` sticky y primera columna sticky generan stacking/z-index conflictivo con popovers de filtros.
- Revisar si `rotation-filter-popover` queda dentro del flujo de tabla y si requiere portal o overflow visible.
- Revisar si la tabla con `table-layout: fixed`, `colgroup`, sticky column y popovers conviven correctamente.
- Comparar thumbnails:
  - Rotacion: `RotationThumbnail`, `.rotation-product-thumb`.
  - Productos: `.product-thumb` y funciones `productImage`, `productInitial`.
- Revisar encoding si algun texto aparece corrupto en consola Windows. El proyecto fuente puede contener caracteres espanoles.

## Datos de ejemplo

El archivo `docs/review/rotation-sku-fixtures.json` contiene un dataset sanitizado de 10 productos con:

- foto y placeholder;
- categorias varias;
- stock 0, bajo y alto;
- ventas 7/30/60 dias;
- productos con y sin publicaciones;
- ejemplos de catalogo y sin catalogo.

Ese fixture no se carga automaticamente por la app. Es solo referencia para reproducir visualmente o armar mocks externos.

## Seguridad y exclusiones

Este paquete no debe incluir:

- `node_modules`
- `.next`
- `.git`
- `.env`, `.env.local`, `.env.production`
- caches, logs, coverage, builds
- tokens, credenciales o cookies

Solo se incluye `.env.example` con valores ficticios.
