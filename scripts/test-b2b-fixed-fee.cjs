const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/pricing.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { calculateB2bPriceSummary: b2b, calculatePriceSummary: retail, mercadoLibreClassicOption, defaultTaxSettings } = loaded.exports;
const args = [{ sku: 'CHEAP', name: 'Cheap SKU', cost_without_vat: 12000, vat_rate: 21, status: 'active' }, mercadoLibreClassicOption(), { marketplace_fee_rate: 15 }, defaultTaxSettings(), { fixed_fee_amount: 3000, shipping_cost_amount: 1000 }];
for (const price of [20000, 32999.99]) {
  const result = b2b(...args, { salePrice: price });
  const normal = retail(...args, { salePrice: price });
  assert.equal(result.valid, true);
  assert.equal(result.fixedFeeAmount, 0);
  assert.ok(normal.fixedFeeAmount > 0);
  assert.ok(result.netProfit > normal.netProfit);
  assert.equal(result.shippingCostAmount, normal.shippingCostAmount);
}
for (const price of [33000, 40000]) {
  assert.equal(b2b(...args, { salePrice: price }).fixedFeeAmount, retail(...args, { salePrice: price }).fixedFeeAmount);
}
assert.equal(b2b(...args, { salePrice: 34000, meliContributionAmount: 2000 }).fixedFeeAmount, 0);
const target = { desiredMarginRate: 10, roundTo: 1 };
const suggested = b2b(...args, target);
assert.equal(suggested.valid, true);
assert.equal(suggested.fixedFeeAmount, 0);
assert.ok(suggested.roundedPrice < retail(...args, target).roundedPrice);
assert.equal(b2b(...args, { salePrice: suggested.roundedPrice }).fixedFeeAmount, 0);
console.log('OK: fijo B2B, umbral exacto, aporte ML, precio sugerido y venta individual.');
