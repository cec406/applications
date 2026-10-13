// Static deployment shells must work from the project URL itself, not only
// by navigating into /public/. Their relative assets also need to remain
// inside the repository when deployed as /<repo>/ on GitHub Pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const rootHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const appHtml = readFileSync(join(ROOT, 'public/index.html'), 'utf8');

test('the /dashboard homepage is the app shell, not a splash or redirect', () => {
  assert.match(rootHtml, /id="sidebar"/);
  assert.match(rootHtml, /id="topbar"/);
  assert.match(rootHtml, /id="content"/);
  assert.match(rootHtml, /src="\.\/public\/js\/app\.js\?v=20261012-3"/);
  assert.match(rootHtml, /href="\.\/public\/css\/styles\.css"/);
  assert.doesNotMatch(rootHtml, /http-equiv="refresh"|location\.replace/);
});

test('the /dashboard/public route remains a standalone app shell', () => {
  assert.match(appHtml, /id="content"/);
  assert.match(appHtml, /src="\.\/js\/app\.js\?v=20261012-3"/);
  assert.match(appHtml, /href="\.\/css\/styles\.css"/);
});
