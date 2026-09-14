const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const sharp = require('sharp');

const filename = path.resolve(__dirname, '../lib/tiendanubeProductImages.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { mercadoLibreImageUrls, squareProductImage } = loaded.exports;

async function main() {
  const pictures = ['a', 'b', 'c'].map(id => ({ id, secure_url: `https://http2.mlstatic.com/${id}.jpg` }));
  assert.deepEqual(mercadoLibreImageUrls({ pictures: [...pictures, pictures[0]] }, 'SKU'), pictures.map(p => p.secure_url));
  assert.deepEqual(mercadoLibreImageUrls({ pictures, variations: [
    { seller_custom_field: 'other', picture_ids: ['a'] },
    { attributes: [{ id: 'SELLER_SKU', value_name: ' sku ' }], picture_ids: ['c', 'b'] },
  ] }, 'SKU'), [pictures[2].secure_url, pictures[1].secure_url]);
  assert.throws(() => mercadoLibreImageUrls({ pictures, variations: [{}, {}] }, 'SKU'), /variante/);
  assert.throws(() => mercadoLibreImageUrls({ pictures: [{ url: 'https://localhost/photo.jpg' }] }, 'SKU'), /URL/);
  for (const [width, height] of [[800, 400], [400, 800], [600, 600]]) {
    const input = await sharp({ create: { width, height, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const output = await squareProductImage(input);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, 1024);
    assert.equal(metadata.height, 1024);
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.hasAlpha, true);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 4)];
    assert.ok(pixel(512, 512)[0] > 240 && pixel(512, 512)[1] < 15);
    assert.equal(pixel(512, 512)[3], 255);
    if (width !== height) {
      const borders = width > height ? [[512, 100], [512, 924]] : [[100, 512], [924, 512]];
      for (const [x, y] of borders) assert.equal(pixel(x, y)[3], 0);
    }
  }
  const transparent = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#00000000' } }).png().toBuffer();
  const { channels } = await sharp(await squareProductImage(transparent)).stats();
  assert.equal(channels.length, 4);
  assert.equal(channels[3].max, 0);
  console.log('OK: galería completa, orden, variantes, URL, tamaño, centrado y transparencia.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
