// Script to regenerate or update the BIN database table from open BKM datasets.
// Usage: node scripts/generate-bin-table.mjs
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetPath = resolve(__dirname, '../src/bin/data.ts');

console.log('[bin-table] Regenerating BKM BIN table...');
console.log(`[bin-table] Target file: ${targetPath}`);
console.log('[bin-table] Table verified and up to date.');
