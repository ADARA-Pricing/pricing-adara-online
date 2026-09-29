// Export de lectura para la migración de pricing a ADARA APP.
// Ejecutar con: node --env-file=.env.local scripts/export-pricing-migration.cjs
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) {
  throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
}

const date = new Date().toISOString().slice(0, 10);
const outputDir = path.resolve(__dirname, '..', 'migration-exports', date);
const tables = {
  products: ['sku', 'name', 'category', 'cost_without_vat', 'vat_rate', 'status'],
  product_channel_margins: [
    'sku', 'channel_code', 'desired_margin_rate', 'desired_net_profit',
    'structure_amount', 'manual_shipping_amount', 'sales_commission_rate',
    'sale_applies_vat', 'promo_discount_rate',
  ],
  mercadolibre_category_fees: ['category', 'marketplace_fee_rate', 'active'],
  mercadolibre_installment_fees: [
    'code', 'name', 'installment_count', 'financing_fee_rate',
    'round_to', 'rounding_mode', 'active', 'applies_vat',
  ],
  tax_settings: ['key', 'iibb_rate', 'idc_rate', 'iigg_rate', 'structure_rate'],
  flex_shipping_rates: [
    'zone', 'amount', 'vat_included', 'active', 'effective_from',
    'created_at', 'updated_at',
  ],
};

async function readTable(table, columns) {
  const rows = [];
  let total = null;
  for (let offset = 0; ; offset += 500) {
    const query = new URLSearchParams({
      select: '*', limit: '500', offset: String(offset),
      order: table === 'tax_settings' ? 'key.asc' : 'id.asc',
    });
    const response = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'count=exact',
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${table}: HTTP ${response.status}: ${body.slice(0, 500)}`);
    }
    const batch = await response.json();
    const range = response.headers.get('content-range');
    if (total === null && range?.includes('/')) total = Number(range.split('/')[1]);
    rows.push(...batch.map(row => Object.fromEntries(columns
      .filter(column => Object.hasOwn(row, column))
      .map(column => [column, row[column]]))));
    if (batch.length < 500) break;
  }
  if (total !== null && rows.length !== total) {
    throw new Error(`${table}: leídas ${rows.length} filas, la base informó ${total}`);
  }
  return rows;
}

async function main() {
  const data = {};
  for (const [table, columns] of Object.entries(tables)) {
    data[table] = await readTable(table, columns);
  }

  const productSkus = new Set();
  for (const product of data.products) {
    const sku = String(product.sku || '').trim().toUpperCase();
    if (!sku || productSkus.has(sku)) throw new Error(`SKU vacío o duplicado: ${sku}`);
    productSkus.add(sku);
  }
  const unknownMarginSkus = [...new Set(data.product_channel_margins
    .map(row => String(row.sku || '').trim().toUpperCase())
    .filter(sku => sku && !productSkus.has(sku)))];
  if (unknownMarginSkus.length) {
    throw new Error(`Márgenes con SKU fuera de products: ${unknownMarginSkus.join(', ')}`);
  }
  const marginKeys = data.product_channel_margins.map(row => `${row.sku}|${row.channel_code}`);
  if (marginKeys.some(key => key.startsWith('|')) || new Set(marginKeys).size !== marginKeys.length) {
    throw new Error('Hay márgenes sin SKU o con SKU/canal duplicado');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  for (const [table, rows] of Object.entries(data)) {
    fs.writeFileSync(path.join(outputDir, `${table}-${date}.json`), JSON.stringify(rows, null, 2) + '\n');
  }
  const manifest = {
    generated_at: new Date().toISOString(),
    source: 'Supabase de pricing ADARA',
    fields: tables,
    counts: Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])),
    validation: {
      unique_product_skus: productSkus.size,
      unique_margin_sku_channels: marginKeys.length,
      unknown_margin_skus: unknownMarginSkus,
      products_without_name_or_vat: data.products.filter(row => !row.name || row.vat_rate == null).length,
    },
    scope: 'Solo configuración y catálogo de pricing. Sin credenciales ni datos de clientes.',
    usage_notes: [
      'products.cost_without_vat es costo de simulación de pricing: no usar como costo FIFO ni para crear lotes.',
      'flex_shipping_rates.effective_from es la fecha configurada en pricing; confirmar contra la factura de MEF antes de usarla como vigencia contable.',
      'Los códigos de ML sin SKU deben darse de alta con nombre e IVA reales; el costo nace de la factura de compra (PRC3).',
    ],
  };
  fs.writeFileSync(path.join(outputDir, `manifest-${date}.json`), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, counts: manifest.counts, validation: manifest.validation }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
