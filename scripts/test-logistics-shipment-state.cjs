const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../lib/logisticsShipmentState.ts');
const mod = new Module(filename, module);
mod.filename = filename;
mod.paths = module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

const { logisticsLabelState } = mod.exports;
const base = { logistic: { type: 'cross_docking' }, status: 'ready_to_ship' };
assert.equal(logisticsLabelState({ ...base, substatus: 'ready_to_print' }), 'ready_to_print');
assert.equal(logisticsLabelState({ ...base, substatus: 'printed' }), 'printed');
assert.equal(logisticsLabelState({ ...base, substatus: 'ready_for_pickup' }), 'printed');
assert.equal(logisticsLabelState({ ...base, substatus: 'picked_up' }), null);
assert.equal(logisticsLabelState({ ...base, logistic: { type: 'fulfillment' }, substatus: 'ready_to_print' }), null);
assert.equal(logisticsLabelState({ ...base, status: 'shipped', substatus: 'ready_for_pickup' }), null);
console.log('OK: Colecta impresa y lista para retiro, Flex, Full y envíos ya retirados.');
