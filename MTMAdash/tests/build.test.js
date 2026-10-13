// Tests for the single-file bundler (build.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

execFileSync(process.execPath, [join(ROOT, 'build.js')], { cwd: ROOT, stdio: 'ignore' });

test('build produces the two self-contained files', () => {
  assert.ok(existsSync(join(ROOT, 'index.html')));
  assert.ok(existsSync(join(ROOT, 'display.html')));
});

test('index.html is fully self-contained', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<style>/);
  assert.match(html, /<script type="module">/);
  assert.match(html, /id="content"/);
  assert.match(html, /data:image\/svg\+xml/, 'inline favicon');
  assert.doesNotMatch(html, /^\s*import\s/m, 'no bare import statements');
  assert.doesNotMatch(html, /^\s*export\s/m, 'no bare export statements');
  assert.match(html, /boardView/, 'views bundled');
  assert.match(html, /buildSeed/, 'seed bundled');
  assert.match(html, /makeLocalDb/, 'browser-local db bundled');
});

test('display.html carries the kiosk entry', () => {
  const html = readFileSync(join(ROOT, 'display.html'), 'utf8');
  assert.match(html, /id="kiosk"/);
  assert.match(html, /data-theme="kiosk"/);
  assert.match(html, /if \(document\.getElementById\('kiosk'\)\)/, 'kiosk guard present');
});

test('the bundle is one module with both entries guarded', () => {
  // Both pages share the same bundle content; each entry is guarded by DOM.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /document\.getElementById\('content'\) && !document\.getElementById\('kiosk'\)/, 'app guard');
  assert.match(html, /if \(document\.getElementById\('kiosk'\)\)/, 'kiosk guard');
  assert.match(html, /const __mod_js_store_js = \(\(\) =>/, 'modules wrapped in their own scope');
  assert.match(html, /const \{ collections, collectionByName \} = __mod_shared_schema_js/, 'imports rewritten to module scope');
  assert.match(html, /const store = __mod_js_store_js/, 'namespace imports preserved');
});
