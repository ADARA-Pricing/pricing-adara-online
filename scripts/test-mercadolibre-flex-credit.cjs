const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../lib/mercadolibreFlexCredit.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, filename);

const { shouldCreditFlexReceiverDiscount } = loaded.exports;

assert.equal(shouldCreditFlexReceiverDiscount(25200, [{ quantity: 1, unit_price: 25200 }]), true);
assert.equal(shouldCreditFlexReceiverDiscount(50400, [{ quantity: 2, unit_price: 25200 }]), true);
assert.equal(shouldCreditFlexReceiverDiscount(50400, [{ quantity: 1, unit_price: 25200 }, { quantity: 1, unit_price: 25200 }]), true);
assert.equal(shouldCreditFlexReceiverDiscount(50400, [{ quantity: 1, unit_price: 50400 }]), false);
assert.equal(shouldCreditFlexReceiverDiscount(50400, [{ quantity: 1, unit_price: 25200 }, { quantity: 1, unit_price: 33000 }]), false);
assert.equal(shouldCreditFlexReceiverDiscount(50400, undefined), false);

console.log('OK: crédito de envío Flex para múltiples unidades por debajo del umbral.');
