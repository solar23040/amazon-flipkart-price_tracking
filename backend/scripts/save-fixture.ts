// Dev utility: download a product page and save it as a scraper test fixture.
// Usage: npx tsx scripts/save-fixture.ts <url> <site> <name>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPage } from '../src/scrapers/http.js';

const [url, site, name] = process.argv.slice(2);
if (!url || !site || !name) {
  console.error('Usage: npx tsx scripts/save-fixture.ts <url> <site> <name>');
  process.exit(1);
}

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));
const outFile = path.join(fixturesDir, site, `${name}.html`);

const html = await fetchPage(url);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`saved ${html.length} bytes to ${outFile}`);
