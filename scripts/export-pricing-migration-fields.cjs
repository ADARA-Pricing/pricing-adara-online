// Export complementario de lectura para la pregunta 12 del handoff de ADARA APP.
// Ejecutar: node --env-file=.env.local scripts/export-pricing-migration-fields.cjs
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) throw new Error('Faltan credenciales de Supabase');

const date = new Date().toISOString().slice(0, 10);
const outputDir = path.resolve(__dirname, '..', 'migration-exports', date);
const tables = {
  product_channel_margins: {
    columns: ['sku', 'channel_code', 'manual_sale_price', 'cost_vat_rate'],
    order: 'id.asc',
  },
  mercadolibre_installment_fees: {
    columns: ['code', 'channel_type', 'applies_marketplace_fee', 'applies_shipping',
      'applies_iibb', 'applies_idc', 'applies_iigg', 'applies_structure'],
    order: 'id.asc',
  },
  mercadolibre_shipping_costs: {
    columns: ['product_id', 'sku', 'meli_item_id', 'fixed_fee_amount', 'shipping_cost_amount',
      'active', 'meli_status', 'meli_last_sync_at'],
    order: 'id.asc',
  },
  products: {
    columns: ['id', 'sku'],
    order: 'id.asc',
  },
};

async function readTable(table, { columns, order }) {
  const rows = [];
  let total = null;
  for (let offset = 0; ; offset += 500) {
    const query = new URLSearchParams({
      select: columns.join(','), limit: '500', offset: String(offset), order,
    });
    const response = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'count=exact',
      },
    });
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const batch = await response.json();
    if (total === null) total = Number(response.headers.get('content-range')?.split('/')[1]);
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  if (Number.isFinite(total) && rows.length !== total) {
    throw new Error(`${table}: leídas ${rows.length} filas, la base informó ${total}`);
  }
  return rows;
}

async function main() {
  const data = {};
  for (const [table, config] of Object.entries(tables)) data[table] = await readTable(table, config);

  const productSkuById = new Map(data.products.map(row => [row.id, row.sku]));
  for (const row of data.mercadolibre_shipping_costs) {
    if (!row.sku) row.sku = productSkuById.get(row.product_id) || null;
  }
  delete data.products;

  const marginKeys = data.product_channel_margins.map(row => `${row.sku}|${row.channel_code}`);
  const channelCodes = data.mercadolibre_installment_fees.map(row => row.code);
  const shippingIds = data.mercadolibre_shipping_costs.map(row => row.meli_item_id).filter(Boolean);
  const shippingSkuItems = data.mercadolibre_shipping_costs.filter(row => row.meli_item_id)
    .map(row => `${row.sku}|${row.meli_item_id}`);
  if (new Set(marginKeys).size !== marginKeys.length || marginKeys.some(key => key.startsWith('|') || key.endsWith('|'))) {
    throw new Error('Márgenes sin SKU/canal o con clave duplicada');
  }
  if (new Set(channelCodes).size !== channelCodes.length || channelCodes.some(code => !code)) {
    throw new Error('Canales sin código o duplicados');
  }
  if (data.mercadolibre_shipping_costs.some(row => !row.sku)) {
    throw new Error('Costos de envío sin SKU, tampoco resoluble por product_id');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const files = {};
  for (const [table, rows] of Object.entries(data)) {
    const file = `${table}-campos-adicionales-${date}.json`;
    fs.writeFileSync(path.join(outputDir, file), `${JSON.stringify(rows, null, 2)}\n`);
    files[table] = file;
  }
  const manifest = {
    generated_at: new Date().toISOString(),
    source: 'Supabase de pricing ADARA, export de lectura',
    purpose: 'Pregunta 12 de docs/handoff/CURRENT.md',
    files,
    fields: Object.fromEntries(Object.entries(tables).filter(([table]) => table !== 'products').map(([table, config]) => [table, config.columns])),
    counts: Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])),
    validation: {
      unique_margin_sku_channels: marginKeys.length,
      unique_channel_codes: channelCodes.length,
      unique_shipping_item_ids: new Set(shippingIds).size,
      repeated_shipping_item_ids: shippingIds.length - new Set(shippingIds).size,
      repeated_shipping_sku_item_pairs: shippingSkuItems.length - new Set(shippingSkuItems).size,
      shipping_rows_without_item_id: data.mercadolibre_shipping_costs.filter(row => !row.meli_item_id).length,
    },
    notes: [
      'El costo de envío se registra por publicación (meli_item_id); algunas filas pueden no tener item_id. No es un valor único por SKU.',
      'Si sku estaba vacío en mercadolibre_shipping_costs se resolvió por product_id contra products.',
      'Un mismo item_id puede aparecer en varias filas; conservar product_id y SKU, no usar item_id como clave única del export.',
      'Los importes de envío son los guardados en pricing al momento del export; meli_last_sync_at permite evaluar frescura.',
      'Ningún archivo incluye credenciales ni datos de clientes.',
    ],
  };
  fs.writeFileSync(path.join(outputDir, `manifest-campos-adicionales-${date}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, counts: manifest.counts, validation: manifest.validation }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
