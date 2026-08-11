# Roadmap Upgrade ADARA Pricing inspirado en SmartSelling

Fecha: 2026-08-11

## Objetivo

Convertir ADARA Pricing en un centro operativo para MercadoLibre, manteniendo el foco principal en rentabilidad, promociones, publicaciones, stock y decisiones accionables.

La referencia analizada fue SmartSelling, especialmente su enfoque de dashboard integrado para reputacion, ventas, publicidad, preventa IA y postventa. La idea no es copiar la herramienta, sino adaptar los patrones que suman valor a nuestro flujo: detectar oportunidades, priorizar acciones y reducir trabajo manual.

## Principios de producto

- Priorizar acciones concretas antes que reportes decorativos.
- Mostrar primero lo que requiere decision: activar promo, ajustar precio, cargar Asesoria 360, revisar stock, revisar margen.
- Mantener trazabilidad: cada sugerencia debe mostrar con que datos se calculo.
- No inventar datos de MercadoLibre. Cuando algo viene de ML, mostrarlo como viene o indicar que falta sincronizar.
- Separar datos activos, futuros y programados para evitar decisiones equivocadas.
- Evitar llenar la pantalla: usar popups, desplegables, filtros y resumen ejecutivo.

## Prioridad recomendada

### 1. Dashboard Ejecutivo ADARA

Crear una pantalla inicial con resumen de salud comercial de MercadoLibre.

Metricas iniciales:

- Ultima sincronizacion ML.
- Productos activos sincronizados.
- Publicaciones activas.
- Promos detectadas.
- Oportunidades amarillas.
- Promos futuras rentables.
- SKUs sin promo en alguna opcion de cuotas.
- Publicaciones con margen bajo.
- Alertas de sincronizacion.
- Top oportunidades por aporte ML.

Objetivo:

Que al abrir la app se vea rapidamente que requiere accion hoy.

### 2. Centro de Oportunidades

Crear una bandeja de acciones recomendadas.

Tipos de acciones:

- Activar promo rentable.
- Cargar MLA en Asesoria 360.
- Revisar promo activa con margen bajo.
- Revisar SKU sin promo en cuotas clave.
- Revisar publicacion con datos incompletos.
- Revisar precio que podria ganar catalogo.
- Revisar promo futura con aporte ML alto.

Cada accion deberia incluir:

- SKU.
- Nombre del producto.
- MLA.
- Cuotas.
- Tipo de oportunidad.
- Margen actual.
- Margen proyectado.
- Precio comprador actual.
- Precio comprador proyectado.
- Aporte MercadoLibre.
- Fecha de vigencia si aplica.
- Boton para ir al modulo correspondiente.

### 3. Ventas y rotacion por SKU

Agregar datos de ventas para tomar mejores decisiones de promo.

Metricas deseadas:

- Ventas ultimos 7 dias.
- Ventas ultimos 30 dias.
- Ventas ultimos 60 dias.
- Unidades vendidas.
- Precio promedio.
- Stock actual.
- Dias estimados de stock.
- Margen promedio estimado.
- Tiene promo rentable o no.

Uso principal:

- Priorizar promos en productos con stock alto y baja rotacion.
- Evitar bajar precio en productos que ya rotan bien.
- Detectar productos con alta demanda y margen malo.

### 4. Asesoria 360 inteligente

Mejorar el modulo Asesoria 360 para sugerir automaticamente candidatos.

Reglas iniciales:

- Maximo 40 MLA.
- No repetir mismo SKU el mismo dia.
- Permitir varias MLA del mismo SKU en dias distintos.
- Priorizar SKUs activos.
- Excluir publicaciones sin precio ML.
- Excluir productos sin costo o datos incompletos.
- Priorizar:
  - stock alto;
  - baja rotacion;
  - sin promo vigente rentable;
  - margen objetivo alcanzable;
  - publicaciones con cuotas relevantes;
  - publicaciones no incluidas ya en lista.

Salida:

- Lista editable.
- Exportar XLSX.
- Copiar formato planilla.
- Mostrar motivo de sugerencia por cada fila.

### 5. Alertas accionables

Expandir alertas de escritorio y alertas internas.

Alertas iniciales:

- Aporte ML supera umbral configurado.
- Promo mejora margen y precio comprador contra vigente.
- Promo futura rentable empieza pronto.
- SKU sin promo en cuotas relevantes.
- Sincronizacion fallida o incompleta.
- Publicacion activa sin costo/precio/envio.

Configuracion:

- Umbral aporte ML porcentual.
- Umbral margen minimo.
- Frecuencia de revision.
- Activar/desactivar tipo de alerta.

## Backlog posterior

### 6. Semaforo de reputacion ML

Traer indicadores de:

- Reclamos.
- Cancelaciones.
- Despachos con demora.
- Nivel de reputacion.
- Limites ML y limites MercadoLider.

Objetivo:

Cruzar salud de cuenta con operacion comercial.

### 7. Publicidad y ACOS

Si se puede obtener informacion de Product Ads:

- Inversion.
- Ventas por publicidad.
- ACOS.
- Margen despues de publicidad.
- SKUs con publicidad no rentable.

Objetivo:

Evitar activar promos en productos donde el margen se consume por ads.

### 8. Auditoria de publicaciones

Reporte para detectar problemas:

- Sin catalogo.
- Sin cuotas.
- Sin promo.
- Sin stock.
- Precio desactualizado.
- Datos ML incompletos.
- Publicacion pausada.
- Diferencia entre precio ML y precio calculado.

### 9. Comparador catalogo/publicacion propia

Ver por SKU:

- Publicaciones de catalogo.
- Publicaciones vendedor.
- Precio ganador.
- Precio propio.
- Margen necesario para ganar.
- Si conviene o no competir.

### 10. Rentabilidad real por venta

Reporte financiero por orden o por SKU:

- Precio venta.
- Comision ML.
- Costo cuotas.
- Envio.
- Impuestos.
- Costo producto.
- Aporte ML.
- Ganancia neta.
- Margen real.

### 11. Historial de cambios

Guardar historico de:

- Precio ML.
- Precio promo.
- Aporte ML.
- Costo envio.
- Comision categoria.
- Margen calculado.
- Estado de promo.

Objetivo:

Poder explicar por que una oportunidad cambio de un dia a otro.

### 12. Automatizacion controlada de precios

Primera etapa como sugerencia, no accion automatica:

- Precio recomendado para ganar catalogo.
- Precio minimo rentable.
- Precio maximo sugerido.
- Comparacion contra competencia.

## Datos necesarios

Ya tenemos:

- Productos.
- Costos.
- Impuestos.
- Comisiones por categoria.
- Costos de envio.
- Publicaciones ML.
- Promociones ML.
- Oportunidades de promocion.
- Margenes objetivo por canal/cuotas.

Falta investigar o agregar:

- Ventas por SKU desde MercadoLibre.
- Ordenes recientes.
- Stock ML vs stock interno.
- Reputacion ML.
- Metricas de publicidad.
- Historial de snapshots.
- Estado de sincronizacion por modulo.

## Orden de implementacion sugerido

### Fase 1: Fundacion visible

1. Crear Dashboard Ejecutivo.
2. Crear Centro de Oportunidades usando datos actuales.
3. Mejorar Asesoria 360 con sugerencias automaticas basadas en datos actuales.

### Fase 2: Datos comerciales

1. Sincronizar ventas/ordenes ML.
2. Agregar rotacion por SKU.
3. Cruzar rotacion + stock + promos.

### Fase 3: Alertas e historial

1. Alertas internas y escritorio por oportunidad.
2. Historial de snapshots.
3. Panel de calidad de sincronizacion.

### Fase 4: Reputacion y publicidad

1. Reputacion ML.
2. Publicidad/ACOS.
3. Rentabilidad real post-publicidad.

## Primeras tareas concretas

1. Crear ruta `/dashboard` o mejorar `/precios` como inicio operativo.
2. Agregar link del dashboard al menu principal.
3. Crear funcion central que arme oportunidades desde:
   - promociones activas con margen bajo;
   - promociones disponibles rentables;
   - promociones futuras rentables;
   - publicaciones sin promo por cuota;
   - errores de sincronizacion.
4. Reutilizar esa funcion en:
   - Dashboard Ejecutivo;
   - Centro de Oportunidades;
   - Alertas;
   - Asesoria 360.

## Ajustes detectados en Dashboard Ejecutivo

Pendientes para revisar despues de avanzar con los modulos principales:

- En "Top aporte ML" no mostrar promos con aporte ML igual a 0.
- En acciones recomendadas, evitar que el texto de precio/fecha se pise o quede pegado al margen derecho.
- Separar visualmente mejor los tipos de accion: revisar activa, activar disponible y futura.
- Mostrar etiqueta de estado en cada accion, no depender solo del color lateral.
- Revisar truncado de nombres largos de producto para que no rompan lectura.
- Validar si el orden de oportunidades debe priorizar margen, aporte ML o urgencia segun el bloque.

## Criterios de exito

- El usuario puede abrir la app y saber que hacer en menos de 30 segundos.
- Las oportunidades muestran siempre el dato de origen.
- Ninguna promo futura se mezcla con activa/disponible.
- Ninguna accion recomendada oculta precio comprador, precio vendedor, aporte ML y margen.
- Asesoria 360 puede armar una lista util de 40 MLA con pocos clicks.
- Los errores de sincronizacion son visibles y accionables.
