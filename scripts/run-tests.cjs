const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
for (const file of readdirSync(__dirname).filter(name => /^test-.*\.cjs$/.test(name)).sort()) {
  const result = spawnSync(process.execPath, [require('node:path').join(__dirname, file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
