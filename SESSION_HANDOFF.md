# Handoff Pricing ADARA

Archivo principal para retomar:

`docs/handoff/CURRENT.md`

## Repo

`C:\Users\User\Documents\GitHub\pricing-adara-online`

Rama: `main`

Ultimo commit pusheado: `9fec22a` - Actualiza promos Meli al abrir la pantalla

## Importante

Hay archivos auxiliares sin commitear:

- `.env.example`
- `REVIEW_README.md`
- `SESSION_HANDOFF.md`
- `docs/handoff/`
- `docs/review/`

No incluirlos en commits salvo pedido explicito.

## Ultimo trabajo hecho

Promociones Meli:

- Se analizo discrepancia con Central de Promos de MercadoLibre para SKU `178`.
- Caso testigo: `MLA2686740444` sincronizada con `MLA2686779076`.
- La app tenia una oportunidad vieja `candidate` a `$465.599,03`.
- La API viva de MercadoLibre ya mostraba `Descuentazos` `started` a `$478.728,90 / $478.728,92`.
- No importa la diferencia chica de redondeo, pero si importa que estado/precio esten actualizados.

Commits ya pusheados:

- `d72e60f` - Evita cruzar promos entre publicaciones ML.
- `9fec22a` - Actualiza promos Meli al abrir la pantalla.

Cambios relevantes:

- La sync descarta promos cuyo `ref_id`, `offer_id` o `item_id` pertenece a otro MLA.
- La pantalla de Promociones Meli no reinterpreta promos crudas de otro endpoint/item.
- Al abrir Promociones Meli, carga datos guardados y dispara en segundo plano `scope: "promotions"`.
- El boton de la pantalla ahora dice `Actualizar promos` y corre sync liviana de promociones.

## Reglas del usuario

- No inventar datos.
- No cruzar promociones entre MLAs.
- Reflejar MercadoLibre con datos reales y actualizados.
- Si MercadoLibre solo da porcentajes redondeados, se toleran pequenas diferencias de importe.
- Lo critico es no mostrar estados/precios viejos.

## Endpoints utiles ML

- `/seller-promotions/items/{MLA}?app_version=v2`
- `/items/{MLA}/prices`
- `/items/{MLA}/sale_price`

Priorizar endpoint por item para parecerse a Central de Promos. El endpoint por campaña/item puede devolver `suggested_discounted_price` distinto para DEAL.

## Otros modulos recientes

Oportunidades:

- Cuidar cargo fijo real de ML en productos menores a `$30.000`.
- `Activar promo` debe usar promociones rentables con aporte ML.
- Calcular margen como Precios y usando valor de venta, no comprador.
- `Futura` debe ser distinta de `Activar promo` y solo con fecha futura.

Asesoria 360:

- Ranking automatico debe priorizar stock.
- Ordenar por necesidad real de promo extra de mayor a menor.

Simulador:

- Selector avanzado para `Usar producto como base` ya implementado.
- Permite buscar por categoria, SKU, producto, precio, etc.

## Comandos

Build:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co'; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY='dummy'; node node_modules\next\dist\bin\next build
```

Supabase:

```powershell
npx.cmd supabase db query --linked -o json "<SQL>"
```

Si Supabase CLI falla por `EPERM` de telemetria, pedir aprobacion y correr PowerShell fuera del sandbox.
