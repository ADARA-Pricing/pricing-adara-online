const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const file = path.resolve(__dirname, '../lib/logisticsBatchPdf.ts');
const source = fs.readFileSync(file, 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(javascript, file);

const batch = {
  id: 'test', mode: 'self_service', dispatch_day: '2026-09-28',
  shipments: [{ id: '123456789', orderIds: ['987654321'], buyer: 'Prueba',
    items: [{ sku: 'SKU1', title: 'Producto de prueba', quantity: 1 }] }],
  staged: { _exceptions: [{ step: 'collecting', sku: 'SKU1', code: '', reason: 'Sin EAN legible', userId: 'test', at: '2026-09-28T12:00:00Z' }] },
};

(async () => {
  for (const kind of ['preparation', 'summary', 'control']) {
    const pdf = await loaded.exports.batchPdf(batch, kind);
    assert.equal(Buffer.from(pdf).subarray(0, 4).toString(), '%PDF', `${kind} no produjo un PDF`);
  }
  console.log('OK: PDFs de logística con casillero y excepción manual.');
})().catch(error => { console.error(error); process.exitCode = 1; });
