import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(root, '../src/shared/patrimonial.js');
const frontendCopy = path.resolve(root, '../../frontend/src/shared/patrimonial.js');

test('las fórmulas compartidas del frontend son idénticas a las del backend', { skip: !fs.existsSync(frontendCopy) && 'Repositorio frontend no disponible' }, () => {
  assert.equal(fs.readFileSync(frontendCopy, 'utf8'), fs.readFileSync(source, 'utf8'), 'Ejecuta npm run sync:shared en el backend');
});
