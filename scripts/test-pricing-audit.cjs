const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(name) {
  const filename = path.resolve(__dirname, '../lib/', name + '.ts');
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
async function main() {
  const { categoryOptions, normalizeFilter, LatestRequest, readPages, freshness } = load('pricingData');
  assert.equal(normalizeFilter('  ILUMINACIÓN   LED '), 'iluminacion led');
  assert.deepEqual(categoryOptions(['Audio', ' AUDIO ', 'Audío', 'Audio profesional']), ['Audio', 'Audio profesional']);
  const requests = new LatestRequest(), old = requests.begin(), latest = requests.begin();
  assert.equal(old.current(), false); assert.equal(old.signal.aborted, true); assert.equal(latest.current(), true);
  let rendered = 'new'; await Promise.resolve().then(() => { if (old.current()) rendered = 'old'; }); assert.equal(rendered, 'new');
  requests.cancel(); assert.equal(latest.current(), false);
  const dataset = Array.from({ length: 1201 }, (_, id) => ({ id })); let calls = 0;
  function client(errorAt = -1, message = '500') { return { from() { return { select() { return this; }, order() { return this; }, range(from, to) { this.from = from; this.to = to; return this; }, async abortSignal() { calls++; return this.from === errorAt ? { error: { message } } : { data: dataset.slice(this.from, this.to + 1), count: dataset.length }; } }; } }; }
  const progress = []; const result = await readPages(client(), { table: 'fixtures' }, new AbortController().signal, x => progress.push(x.rows.length));
  assert.equal(result.rows.length, 1201); assert.equal(calls, 3); assert.deepEqual(progress, [500, 1000, 1201]); assert.equal(result.complete, true);
  for (const code of ['500', '429']) {
    const partial = []; await assert.rejects(readPages(client(500, code), { table: 'fixtures' }, new AbortController().signal, x => partial.push(x)), new RegExp(code));
    assert.equal(partial.length, 1); assert.equal(partial[0].complete, false); assert.equal(partial[0].rows.length, 500);
  }
  assert.equal(freshness([{ meli_last_sync_at: '2000-01-01' }, {}]).unknown, 1);
  const { promotionState, promotionKey, dedupePromotions, promotionCoverage, validPromotionPayload, promotionDateMs, validThresholds } = load('promotionState');
  const now = Date.parse('2026-09-15T12:00:00-03:00');
  const promo = { meli_item_id: 'MLA2042169799', promotion_id: 'campaign1', offer_id: 'offer1', item_promotion_status: 'candidate', last_sync_at: '2026-09-15T12:00:00-03:00' };
  assert.equal(promotionState(promo, now), 'candidate');
  assert.equal(promotionState({ ...promo, end_date: '2026-09-14' }, now), 'finished');
  assert.equal(promotionState({ ...promo, start_date: '2026-09-16' }, now), 'future');
  assert.equal(promotionState({ ...promo, item_promotion_status: 'started' }, now), 'active');
  assert.equal(promotionState({ ...promo, item_promotion_status: 'unexpected' }, now), 'unknown');
  assert.equal(promotionDateMs('2026-09-15'), Date.parse('2026-09-15T03:00:00Z'));
  const differentCampaign = { ...promo, promotion_id: 'campaign2' }, differentMla = { ...promo, meli_item_id: 'MLA2042169803' };
  assert.notEqual(promotionKey(promo), promotionKey(differentMla));
  assert.equal(dedupePromotions([promo, promo, differentCampaign, differentMla]).length, 3);
  const { comparisonPromotionKey } = load('promotionState');
  const comparison = { key:'raw1',itemId:'MLA1',promotionId:'campaign1',offerId:'offer1',status:'Para activar',name:'Mismo nombre',promoPrice:244999 };
  assert.notEqual(comparisonPromotionKey(comparison), comparisonPromotionKey({...comparison,promotionId:'campaign2'}));
  assert.notEqual(comparisonPromotionKey(comparison), comparisonPromotionKey({...comparison,itemId:'MLA2'}));
  assert.notEqual(comparisonPromotionKey(comparison), comparisonPromotionKey({...comparison,offerId:'offer2'}));
  for (const error of ['429', '500']) {
    const raw = [{ endpoint: '/seller-promotions/items/MLA2042169799?app_version=v2', error }];
    assert.equal(validPromotionPayload(raw, promo.meli_item_id), false);
    assert.equal(promotionCoverage({ meli_item_id: promo.meli_item_id, meli_promotions: raw }).known, false);
  }
  assert.equal(validPromotionPayload([{ endpoint: '/items/MLA2042169799/prices', data: [] }], promo.meli_item_id), false);
  assert.equal(validPromotionPayload([{ endpoint: '/seller-promotions/items/MLA2042169799?app_version=v2', data: [] }], promo.meli_item_id), true);
  assert.equal(validPromotionPayload([{ endpoint: '/seller-promotions/items/MLA2042169799', data: [{id:'campaign',status:'candidate'}, {price:1}] }], promo.meli_item_id), false);
  assert.equal(validPromotionPayload([{ endpoint: '/seller-promotions/items/MLA2042169799', data: [] }, { endpoint: '/seller-promotions/items/MLA2042169799', error:'429' }], promo.meli_item_id), false);
  assert.equal(validThresholds(10, 5), false); assert.equal(validThresholds(NaN, 10), false); assert.equal(validThresholds(5, 10), true);
  const { profitabilityTotals } = load('profitability');
  const sale = { quantity: 2, total_amount: 242, real_total_net_profit: 20, real_net_sale_price: 100, normalized_total_net_profit: 20, normalized_net_sale_price: 120, normalized_cost_for_profit: 50 };
  const other = { ...sale, quantity: 1, total_amount: 1210, real_total_net_profit: 200, real_net_sale_price: 1000, normalized_total_net_profit: 200, normalized_net_sale_price: 1100, normalized_cost_for_profit: 600 };
  const totals = profitabilityTotals([sale, other, { ...sale, real_total_net_profit: null, normalized_total_net_profit: null }]);
  assert.equal(totals.netProfit, 220); assert.equal(totals.margin, 220 / 1200 * 100); assert.equal(totals.marginOnCost, 220 / 700 * 100); assert.equal(totals.errors, 1);
  assert.equal(profitabilityTotals([]).netProfit, null); assert.equal(profitabilityTotals([{ ...sale, real_total_net_profit: 0 }]).netProfit, 0);
  assert.equal(profitabilityTotals([{ ...sale, real_net_sale_price: 0 }]).margin, null);
  const { groupAlerts, resolutionHref } = load('accountAlerts');
  const groups = groupAlerts([{ sku: 'SKU1', itemId: 'MLA1' }, { sku: 'sku1', itemId: 'MLA2' }, { sku: 'SKU1', itemId: 'MLA1' }]);
  assert.equal(groups.length, 1); assert.equal(groups[0].publications, 2); assert.equal(groups[0].alerts.length, 3);
  assert.equal(resolutionHref({ href: '/promociones-meli', sku: 'SKU1', itemId: 'MLA1' }), '/promociones-meli?sku=SKU1&mla=MLA1');
  console.log('OK: paginación, parciales, 429/500, cancelación, filtros, estados/promociones múltiples y agregaciones ponderadas.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
