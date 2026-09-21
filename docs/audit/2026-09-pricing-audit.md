# Auditoría Pricing ADARA — 15/09/2026

Cambios locales. No desplegados; no se modificaron datos comerciales ni se ejecutaron sincronizaciones reales.

## Implementado y comprobado

- Lector paginado sin tope silencioso, primera carga parcial, conservación de datos completos durante refresh, cancelación de respuestas obsoletas y caché por usuario/consulta. Integrado en dashboard, rotación, rentabilidad, promociones, productos, precios, costos por canal, simulador, impuestos y datos guardados de Tienda Nube.
- Dashboard agrupado por SKU, publicaciones desplegables, 40 productos por página, cantidades separadas de SKU/publicaciones/alertas. Severidad existente documentada; ventas consolidadas por SKU.
- Promociones: unidades y cobertura explícitas, estados separados, fechas sin zona interpretadas como Argentina, consulta desconocida distinta de ausencia, validación de umbrales. Comparador corregido para no fusionar campañas por nombre/precio; esta última corrección pasó pruebas unitarias pero falta su revisión visual final.
- Rentabilidad y Métricas comparten agregación ponderada: numerador y denominador usan las mismas ventas válidas. Faltantes separados de cero. Columna de cantidad renombrada y MLA vendido copiable. Fórmulas de costos e impuestos conservadas.
- Categorías canónicas sin cambiar etiquetas guardadas. Filtros y paginación en vistas principales; memoria de filtros por usuario.
- Menú contraído con nombre accesible y estado activo. Reproducido y corregido menú móvil que no contraía. Reproducido Escape inoperante en Productos, Promociones y Simulador; añadido manejo de foco, Escape y devolución de foco.

## Evidencia visual con fixtures

Se revisaron Rotación, Rentabilidad, Dashboard, Promociones, Productos, Costo por canal, Tienda Nube, Simulador, Métricas, Competencia y Configuración general. Escritorio y 390 px en Rotación/Promociones. Se verificó carga inicial con guiones, cobertura parcial fallida, categorías unificadas, paginación del dashboard y Escape/retorno de foco en selector de Promociones. No se guardaron formularios.

La revisión visual fue interrumpida por rechazo automático del navegador por falta de créditos. Los cambios posteriores en otros módulos, la persistencia al volver y las últimas correcciones de promociones necesitan comprobación visual adicional. No se afirma que todas las variantes de modal o estados vacíos estén verificadas.

## Rendimiento reproducible

Ejecutar node scripts/benchmark-pricing-fixtures.cjs. Fixture: 120 SKU, 573 MLA, 1.200 ventas, demora fija de 250 ms por página. Comparación de planes de lectura de Rotación, sin red real ni compresión:

| Métrica | Antes | Después |
|---|---:|---:|
| Primera información útil | 513 ms | 268 ms |
| Lectura completa | 513 ms | 793 ms |
| Solicitudes | 5 | 6 |
| JSON | 1.317.779 bytes | 533.492 bytes |

Filtro de 120 filas: p95 0,721 ms de cálculo, excluye render. Navegador: Rotación 270/795 ms primera/completa; Rentabilidad 272/800 ms; Promociones 284/2618 ms; Dashboard 276/3059 ms. Son fixtures, no promesas de producción. Páginas menores mejoran primera lectura y reducen payload, a costa de más solicitudes y mayor tiempo completo en este escenario.

## Pruebas

npm test: cinco suites aprobadas, incluyendo paginación, cancelación, errores 429/500, datos parciales, promociones nuevas/futuras/finalizadas/desconocidas, campañas y MLA múltiples, categorías y ratios ponderados. También regresiones previas de cargo fijo B2B, SKU relacionados y Tienda Nube.
npm run typecheck: aprobado.
npm run lint: sin errores; 101 advertencias existentes/de migración a React Compiler. Las reglas de migración quedan visibles como warnings, no se presenta como lint limpio.
npm run build: aprobado fuera del sandbox; Turbopack requería lectura de directorios bloqueada por el sandbox.

## Pendientes de despliegue y límites

- Aplicar database/053_atomic_promotion_refresh.sql antes de desplegar el endpoint de sincronización. El reemplazo de ofertas por MLA es transaccional y restringido a service_role. No se ejecutó contra PostgreSQL ni producción; falta probar rollback/concurrencia en base de prueba. Sin migración, el endpoint falla conservando las ofertas previas.
- No se verificó la respuesta vigente real del MLA2042169799; la captura del usuario no prueba el estado actual de la API.
- No hay prueba de carga con latencia/cantidad real de producción ni comprobación visual exhaustiva posterior a los últimos cambios.
- Los resultados históricos guardados pueden usar costo vigente al sincronizar si faltaba historial; registros antiguos no identifican esa procedencia. No equivalen a una liquidación bancaria confirmada.
- Métricas cuenta órdenes; Rentabilidad puede mostrar líneas de venta o SKU según período. Publicaciones y campañas no equivalen a productos. Las fechas máxima/mínima no prueban cobertura completa.
- Queda margen de optimización en carga diferida de históricos/detalles y adaptación de controles secundarios. No se reescribieron todas las pantallas.

## Archivos

Carga/frescura: lib/pricingData.ts, lib/usePricingLoad.ts, components/PricingDataStatus.tsx. Filtros: components/PricingFilters.tsx, lib/useRememberedView.ts. Promociones: lib/promotionState.ts, app/promociones-meli/page.tsx, app/api/mercadolibre/sync-shipping/route.ts, database/053_atomic_promotion_refresh.sql. Alertas: lib/accountAlerts.ts, app/dashboard/page.tsx. Rentabilidad: lib/profitability.ts, páginas rentabilidad-meli y metricas-meli. Accesibilidad: lib/useDialogFocus.ts, components/AppShell.tsx, app/globals.css. Fixtures: lib/pricingFixtures.ts, lib/supabase.ts, proxy.ts, components/PricingFixtureNotice.tsx. Ver git diff para las integraciones de carga en las demás páginas.
