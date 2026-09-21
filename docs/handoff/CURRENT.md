# Current Handoff - Pricing ADARA

## Como retomar

Leer primero solo este archivo:

`docs/handoff/CURRENT.md`

Repo:

`C:\Users\User\Documents\GitHub\pricing-adara-online`

Rama:

`main`

Ultimo commit pusheado:

`9fec22a` - Actualiza promos Meli al abrir la pantalla

## Estado git local

Hay archivos auxiliares sin commitear de handoff/review:

- `.env.example`
- `REVIEW_README.md`
- `SESSION_HANDOFF.md`
- `docs/handoff/`
- `docs/review/`

No incluirlos en commits salvo pedido explicito. En fixes, stagear solo los archivos tocados por el cambio.

## Ultimos commits relevantes pusheados

- `9fec22a` - Actualiza promos Meli al abrir la pantalla
- `d72e60f` - Evita cruzar promos entre publicaciones ML
- `a22f48c` - Agrega selector avanzado de producto base
- `b2ce3b2` - Mejora ranking de asesoria 360
- `ef3f7d1` - Ajusta clasificacion de oportunidades ML
- `d9c20c1` - Usa cargo fijo real de ML en promos

## Promociones Meli: estado actual

Problema analizado:

- MercadoLibre actualizo Central de Promos.
- La app estaba mostrando oportunidades viejas o cruzadas entre publicaciones sincronizadas.
- Caso testigo SKU `178`, publicaciones `MLA2686740444` y `MLA2686779076`.
- ML Central mostraba `MLA2686740444` sincronizada con `MLA2686779076`.

Hallazgo clave:

- La DB tenia vieja la oportunidad `CANDIDATE-MLA2686740444-71542019405`:
  - `Descuentazos`
  - `candidate`
  - comprador `$465.599,03`
  - ML `$33.472,18`
  - vendedor `$158.828,79`
- La API viva de ML ya devolvia otra realidad:
  - `Descuentazos`
  - `started`
  - comprador `$478.728,90 / $478.728,92`
  - `meli_percentage 4.4`
  - `seller_percentage 22.9`
  - offer `OFFER-MLA2686740444-11365430031`
- La diferencia chica de monto exacto no preocupa; lo critico es tener estado/precio actualizados.

Fixes ya pusheados:

- `d72e60f`
  - Evita cruzar promos entre MLAs.
  - En sync, descarta promos cuyo payload trae `ref_id`, `offer_id` o `item_id` de otro MLA.
  - En `Promociones Meli`, solo lee respuestas crudas del endpoint exacto de la publicacion.
  - El agrupado interno ya no pisa promos de distintos MLAs aunque compartan SKU y cuota.
- `9fec22a`
  - Al abrir `Promociones Meli`, carga rapido con datos guardados y dispara en segundo plano una sync liviana `scope: "promotions"`.
  - Al terminar esa sync, recarga datos.
  - El boton de la pantalla ahora usa `Actualizar promos` y tambien corre `scope: "promotions"`, no sync completa.

Endpoints ML utiles para comparar Central:

- `/seller-promotions/items/{MLA}?app_version=v2`
  - Mejor fuente para reflejar la Central por publicacion.
  - Devuelve promociones asociadas al item, status, price, ref_id, porcentajes ML/vendedor.
- `/items/{MLA}/prices`
  - Confirma precio promocional activo exacto.
- `/items/{MLA}/sale_price`
  - Confirma promo activa, `campaign_id` y `promotion_id`.
- `/seller-promotions/promotions/{PROMO_ID}/items?...`
  - Util para auditar campañas, pero se vio inconsistencia en `suggested_discounted_price` para DEAL vs endpoint por item. Para reflejar Central, priorizar endpoint por item.

Regla fuerte del usuario:

- No inventar aportes.
- No cruzar promociones entre publicaciones.
- Reflejar MercadoLibre lo mas exacto posible con datos vivos.
- Si ML solo da porcentajes redondeados, aceptar pequenas diferencias de centavos/importes, pero no estados/precios viejos.

## Oportunidades

Contexto reciente:

- Se ajusto la clasificacion para `Revisar activa`, `Activar promo`, `Futura` y `Sin promo`.
- `Activar promo` debe mostrar promos rentables que se pueden activar, con aporte ML, calculando margen como en Precios y usando valor de venta, no valor comprador.
- `Futura` no debe ser igual a `Activar promo`; debe mostrar promos con fecha futura.
- Para productos menores a `$30.000`, el costo fijo real de ML debe incluirse igual que en Precios.
- No usar costo fijo inventado ni fijo global. Tomar el dato real por producto/publicacion.

## Asesoria 360

Mejora reciente:

- Ranking automatico debe priorizar publicaciones con stock.
- Debe ordenar por necesidad real de promo extra, de mayor a menor.
- Evitar recomendar productos sin stock arriba.

## Simulador

Mejora reciente:

- En `Usar producto como base`, se agrego selector avanzado en modal.
- Permite buscar/filtrar por categoria, SKU, producto, precio, etc.
- Objetivo: encontrar mas facil un producto base para comprar/simular.

## Comandos utiles

Build con env dummy:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co'; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY='dummy'; node node_modules\next\dist\bin\next build
```

Consultas Supabase:

```powershell
npx.cmd supabase db query --linked -o json "<SQL>"
```

Si Supabase CLI falla por telemetria `EPERM` en `C:\Users\User\.supabase\telemetry.json`, correr fuera del sandbox con PowerShell aprobado.

## Reglas para ahorrar capacidad

- Leer solo este handoff al iniciar.
- Usar `rg` antes de abrir archivos largos.
- Abrir fragmentos puntuales con rangos.
- No hacer build completo salvo cambios TS/JSX/logica.
- No tocar `.env.example`, `REVIEW_README.md`, `docs/review/` ni handoff salvo pedido.
- No commitear/pushear salvo pedido explicito o fix que deba quedar en produccion.
