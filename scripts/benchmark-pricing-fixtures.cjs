// Controlled comparison of the old and new rotation read plans; no network.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function load(name) { const file = path.resolve(__dirname, '../lib', name + '.ts'), mod = new Module(file, module); mod.paths = module.paths; mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return mod.exports; }
let metrics = { requests: 0, bytes: 0 };
global.window = { location: { search: '' }, dispatchEvent: event => { metrics = event.detail; } };
const { readPages, normalizeFilter } = load('pricingData');
async function measure(mode) {
  metrics = { requests: 0, bytes: 0 };
  const client = load('pricingFixtures').pricingFixtureClient, start = performance.now(); let first = 0;
  if (mode === 'before') {
    await Promise.all([
      client.from('products').select('*'),
      client.from('mercadolibre_shipping_costs').select('*').eq('active', true).eq('meli_status', 'active'),
      client.from('mercadolibre_shipping_costs').select('*').eq('active', true),
      (async () => { for (let from = 0; from < 20000; from += 1000) { const result = await client.from('mercadolibre_order_items').select('*').range(from, from + 999); if (result.data.length < 1000) break; } })(),
    ]); first = performance.now() - start;
  } else {
    const specs = [
      { table: 'products' },
      { table: 'mercadolibre_shipping_costs', columns: 'id,product_id,sku,meli_item_id,meli_stock,meli_status,meli_catalog_listing,meli_thumbnail,meli_last_sync_at,updated_at' },
      { table: 'mercadolibre_order_items', columns: 'id,order_id,order_date,status,meli_item_id,variation_id,sku,product_id,title,quantity,unit_price,total_amount,updated_at' },
    ]; const ready = new Set();
    await Promise.all(specs.map(spec => readPages(client, spec, new AbortController().signal, () => { ready.add(spec.table); if (ready.size === 3 && !first) first = performance.now() - start; })));
  }
  return { firstUsefulMs: Math.round(first), completeMs: Math.round(performance.now() - start), ...metrics };
}
(async () => {
  const before = await measure('before'), after = await measure('after');
  const rows = Array.from({ length: 120 }, (_, i) => ({ name: `Producto Iluminación ${i}` })); const samples = [];
  for (let i = 0; i < 100; i++) { const start = performance.now(); rows.filter(row => normalizeFilter(row.name).includes(normalizeFilter('ILUMINACION'))); samples.push(performance.now() - start); }
  samples.sort((a,b) => a-b);
  console.log(JSON.stringify({ fixture: '120 SKU / 573 MLA / 1200 ventas; demora de 250 ms por página; payload JSON sin compresión', before, after, filterP95Ms: +samples[94].toFixed(3), note: 'Lecturas solamente; no incluye render ni latencia de producción. Menor primera página, mayor número de lecturas y carga completa: compromiso explícito.' }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
