# Pricing ADARA Online

MVP online para cargar productos y calcular precios sugeridos.

## Módulos incluidos

- `/productos`: carga y actualización de productos por SKU.
- `/mercadolibre`: configuración de MercadoLibre separada en:
  - costos por cuotas, iguales para todas las categorías;
  - comisiones por categoría.
- `/impuestos`: configuración global de impuestos/costos: IIBB, IDC, IIGG y estructura.
- `/precios`: precios sugeridos MercadoLibre usando productos + cuotas + categoría + impuestos.

## Setup

1. Crear proyecto en Supabase.
2. Ejecutar en SQL Editor:
   - `database/schema.sql`
   - `database/003_mercadolibre_impuestos.sql`
3. Copiar `.env.example` como `.env.local` y completar:

```env
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_ANON_PUBLIC_KEY
```

4. Instalar y correr:

```bash
npm install
npm run dev
```

5. Abrir `http://localhost:3000`.

## Nota

Si ya habías ejecutado `002_channels_pricing.sql`, no pasa nada. La nueva versión usa las tablas nuevas de MercadoLibre e Impuestos y deja la lógica anterior separada.


## v5 - Envíos Meli
Ejecutar `database/005_meli_shipping_costs.sql` en Supabase. Agrega la pestaña `/envios-meli` y suma costo fijo + envío Meli al cálculo de `/precios`.


## v6.4
- Ajusta los checks del modal de precios: Aplicar % a todos / Aplicar margen a todos.
- El envío de MercadoLibre se carga con IVA incluido y se descuenta neto en rentabilidad dividiendo por 1.21.

## v6.5
- Corrige comisión/costo de cuotas de MercadoLibre: se calcula sobre precio de venta con IVA y se divide por 1.21 para llevarlo a neto, porque MercadoLibre factura la comisión con IVA 21%.
