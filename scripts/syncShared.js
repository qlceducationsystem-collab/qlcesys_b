import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.resolve(process.argv[2] || path.resolve(root, '../../frontend/src/shared'));
const files = ['patrimonial.js', 'countries.js'];

if (!fs.existsSync(targetDir)) {
  console.error(`[sync:shared] No existe ${targetDir}`);
  process.exit(1);
}
for (const file of files) {
  const source = path.resolve(root, '../src/shared', file);
  const target = path.join(targetDir, file);
  fs.copyFileSync(source, target);
  console.info(`[sync:shared] ${source} → ${target}`);
}
