const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/tiendanubePriceUpdate.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { updateVerifiedTiendanubePrice: update } = loaded.exports;
(async () => {
  const calls = [];
  const result = await update(async init => {
    calls.push(init);
    return { price: '41800.00', promotional_price: null };
  }, 41800);
  assert.equal(result.price, '41800.00');
  assert.deepEqual(JSON.parse(calls[0].body), { price: '41800', promotional_price: '' });
  assert.equal(calls[1], undefined);
  await assert.rejects(update(async () => ({ price: '41800', promotional_price: '50000' }), 41800), /no confirmó/);
  await assert.rejects(update(async () => ({ price: '50000', promotional_price: null }), 41800), /no confirmó/);
  let attempts = 0;
  await assert.rejects(update(async () => { attempts++; throw new Error('422'); }, 41800), /422/);
  assert.equal(attempts, 1);
  console.log('OK: borra promo, verifica lectura real y no oculta errores.');
})().catch(error => { console.error(error); process.exitCode = 1; });
