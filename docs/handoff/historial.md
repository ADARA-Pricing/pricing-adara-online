# Historial - Pricing ADARA

## Commits recientes

- `1b366be` - Mostrar accion eliminar en biblioteca de simulaciones
- `9c2129e` - Hacer clickeables filas de simulaciones
- `20e4531` - Corregir carga de simulacion desde modal
- `909b687` - Agregar biblioteca de simulaciones y proveedor
- `813fe21` - Reordenar filtros avanzados en rotacion SKU

## Simulador

Cambios implementados:

- Se agrego `provider` como campo opcional de simulaciones guardadas.
- Se creo y aplico en Supabase:

```sql
alter table public.simulator_saved_simulations
  add column if not exists provider text;
```

- Archivo de migracion:

`database/038_simulator_saved_simulations_provider.sql`

- El formulario del Simulador incluye Proveedor.
- Al usar producto guardado como base, carga `product.supplier`.
- Guardar simulacion sigue haciendo `insert`.
- Cargar simulacion solo rellena formulario, no guarda nada automaticamente.
- Las simulaciones viejas sin proveedor cargan normal y muestran `Sin proveedor`.
- La lista fija de simulaciones guardadas quedo oculta visualmente.
- Se accede a las guardadas desde el modal `Cargar simulacion`.
- El modal tiene busqueda, filtros por proveedor/categoria/fecha y ordenamiento.
- La fila completa del modal carga la simulacion.
- La columna Accion queda sticky a la derecha.
- Eliminar usa `window.confirm`.

Bugs corregidos:

- Primero el boton Cargar no ejecutaba bien por cierre del backdrop con `onMouseDown`; se cambio a `onClick`.
- Luego tocar una fila no cargaba porque solo accionaba el boton oculto; se agrego `onClick` en la fila.
- Se freno la propagacion en acciones para que eliminar o links no carguen la fila.

Pendientes tecnicos:

- La tabla vieja de guardadas sigue en JSX pero oculta con CSS. Se puede borrar despues para limpiar.
- Hay textos con encoding raro heredado en `app/simulador/page.tsx`.

## Rotacion SKU

Cambios implementados:

- Se sacaron filtros de headers.
- Headers solo ordenan.
- Se agrego `Filtros avanzados` debajo de la toolbar.
- Filtros avanzados en panel.
- Chips removibles para filtros activos.
- CSS sort corregido con selector global bajo `.rotation-page`.

Pendiente:

- Posible ajuste visual en columna Publicaciones: distinguir `activas` vs `catalogo`.

## Promociones Meli / Precios / Costos

Contexto:

- Se corrigieron varias reglas de promociones activas/futuras/amarillas/rojas.
- Se venia cuidando que no se mezclen nombres, aportes ni valores de promociones.
- Para futuros, solo deben ir promos que cumplan umbral, no activas y con fecha futura.
- En amarillas, no deben mostrarse futuras ni ya programadas activas.
- En cada promo, nombre/valores/aportes deben reflejar MercadoLibre sin inventar datos.

Cuotas ML ajustadas:

- `MP3 = 8.4`
- `MP6 = 12.3`
- `MP9 = 15.7`
- `MP12 = 19.2`

Para productos menores a 30.000:

- Revisar costo fijo ML (`fixed_fee_amount`) y envio real.
- Casos vistos: Buds 6 Play y bombilla Xiaomi.
- Si envio es a cargo comprador, envio para nosotros debe ser 0.

Tablas/campos clave:

- `mercadolibre_shipping_costs`
- `meli_sale_fee_amount`
- `meli_sale_fee_details`
- `fixed_fee_amount`
- `shipping_cost_amount`
- `meli_listing_type_id`
- `meli_financing_fee_rate`

## Productos

Contexto:

- Se hicieron mejoras visuales de Productos y filas expandibles.
- En productos, el stock ML debe venir de publicaciones reales y no sumar mal inventario compartido.
- Si una publicacion es catalogo, indicarlo en la publicacion madre/grupo, no repetir en cada fila hija.

## Reglas de trabajo

- Ahorrar credito.
- Leer solo `CURRENT.md` al inicio.
- Si el pedido toca un modulo, abrir solo el archivo de ese modulo.
- Usar `rg` antes de abrir.
- Evitar builds completos si el cambio es solo CSS seguro.
- No tocar archivos auxiliares no relacionados.

