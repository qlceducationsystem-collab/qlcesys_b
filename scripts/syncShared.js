import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(root, '../src/shared/patrimonial.js');
const target = path.resolve(process.argv[2] || path.resolve(root, '../../frontend/src/shared/patrimonial.js'));

if (!fs.existsSync(path.dirname(target))) {
  console.error(`[sync:shared] No existe ${path.dirname(target)}`);
  process.exit(1);
}
fs.copyFileSync(source, target);
console.info(`[sync:shared] ${source} → ${target}`);
