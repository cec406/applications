// Bundler: compiles the modular sources into two fully self-contained files.
//
//   index.html    - the whole app (CSS + JS inlined). Double-click it and it
//                   runs with data saved in the browser; serve it with
//                   `node server.js` and the same file talks to the REST API
//                   and syncs live across the shop LAN.
//   display.html  - the kiosk wall board, self-contained the same way.
//
// There is no build tooling beyond plain Node. Each source module is wrapped
// in its own factory (a tiny module system): `import` statements become
// destructuring of the dependency's exports, so modules keep their own scope
// and namespace imports (`import * as store`) keep working. The entry files
// (app.js / display.js) are wrapped in DOM guards so both pages can share the
// same bundle safely.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Dependency order: leaves first (validated below).
const MODULES = [
  'shared/schema.js',
  'shared/legacy.js',
  'shared/seed.js',
  'js/util.js',
  'js/icons.js',
  'js/api.js',
  'js/localdb.js',
  'js/store.js',
  'js/components.js',
  'js/views.js',
  'js/app.js',      // guarded: boots only on the main app page
  'js/display.js',  // guarded: boots only on the wall-board page
];

const GUARDS = {
  'js/app.js': "document.getElementById('content') && !document.getElementById('kiosk')",
  'js/display.js': "document.getElementById('kiosk')",
};

const modId = (rel) => '__mod_' + rel.replace(/[^A-Za-z0-9]/g, '_');

// ---- source analysis -------------------------------------------------------
function parseExports(src) {
  const names = [];
  const re = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of src.matchAll(re)) names.push(m[1]);
  const re2 = /^export\s*\{([^}]*)\}/gm;
  for (const m of src.matchAll(re2)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.push((as[1] || as[0]).trim());
    }
  }
  return names;
}

// Names exported with `let`/`var` need live getters so reassignment is seen.
function exportedLets(src) {
  const lets = new Set();
  const re = /^export\s+(?:let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of src.matchAll(re)) lets.add(m[1]);
  return lets;
}

function parseImport(statement) {
  const m = statement.match(/^import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"]\s*;?$/);
  if (!m) throw new Error(`unrecognized import: ${statement}`);
  const clause = m[1].trim();
  const spec = m[2];
  if (clause.startsWith('*')) {
    return { ns: clause.replace(/^\*\s*as\s*/, '').trim(), spec };
  }
  const inner = clause.replace(/^\{/, '').replace(/\}$/, '');
  const names = inner.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const parts = s.split(/\s+as\s+/);
    return { imported: parts[0].trim(), local: (parts[1] || parts[0]).trim() };
  });
  return { names, spec };
}

function resolveSpec(fromRel, spec) {
  return posix.normalize(posix.join(posix.dirname(fromRel), spec));
}

// Consume a whole `import` statement (may span lines) and return the rest.
function stripImports(src, imports) {
  const lines = src.split('\n');
  const out = [];
  let pending = null;
  for (const line of lines) {
    if (pending !== null) {
      pending += '\n' + line;
      if (/;\s*$/.test(line.trim())) { imports.push(parseImport(pending.trim())); pending = null; }
      continue;
    }
    const t = line.trimStart();
    if (t.startsWith('import ') || t.startsWith('import{')) {
      if (/;\s*$/.test(t)) imports.push(parseImport(t.trim()));
      else pending = t;
      continue;
    }
    out.push(line);
  }
  if (pending !== null) imports.push(parseImport(pending.trim()));
  return out.join('\n');
}

function transformModule(rel, rawSource, sourceCache) {
  const exportsList = parseExports(rawSource);
  const lets = exportedLets(rawSource);
  const imports = [];
  let body = stripImports(rawSource, imports);
  body = body
    .replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');

  const importCode = imports.map((imp) => {
    const target = resolveSpec(rel, imp.spec);
    if (!sourceCache.has(target)) throw new Error(`${rel} imports unknown module "${imp.spec}" (${target})`);
    if (MODULES.indexOf(target) > MODULES.indexOf(rel)) {
      throw new Error(`${rel} imports ${target}, which must be listed earlier in MODULES`);
    }
    const targetExports = new Set(parseExports(sourceCache.get(target)));
    const targetId = modId(target);
    if (imp.ns) return `  const ${imp.ns} = ${targetId};`;
    for (const n of imp.names) {
      if (!targetExports.has(n.imported)) {
        throw new Error(`${rel} imports "${n.imported}" from ${target}, which does not export it`);
      }
    }
    const parts = imp.names.map(({ imported, local }) => (imported === local ? imported : `${imported}: ${local}`));
    return `  const { ${parts.join(', ')} } = ${targetId};`;
  }).join('\n');

  const returns = exportsList.map((name) => (
    lets.has(name)
      ? `get ${name}() { return ${name}; }, set ${name}(v) { ${name} = v; }`
      : name
  )).join(', ');

  const guard = GUARDS[rel];
  const inner = `${importCode}\n${body.trim()}`;
  const wrapped = guard ? `  if (${guard}) {\n${inner}\n  }` : inner;
  return `const ${modId(rel)} = (() => {\n${wrapped}\n  return { ${returns} };\n})();`;
}

// ---- build -----------------------------------------------------------------
function build() {
  const css = readFileSync(join(ROOT, 'css/styles.css'), 'utf8');
  const favicon = readFileSync(join(ROOT, 'favicon.svg'), 'utf8');
  const faviconUri = `data:image/svg+xml,${encodeURIComponent(favicon.replace(/\n\s*/g, ' ').trim())}`;

  const sourceCache = new Map();
  for (const rel of MODULES) sourceCache.set(rel, readFileSync(join(ROOT, rel), 'utf8'));

  const parts = MODULES.map((rel) => {
    const transformed = transformModule(rel, sourceCache.get(rel), sourceCache);
    return `// ═══════════════ ${rel} ═══════════════\n${transformed}\n`;
  });
  const js = parts.join('\n').replace(/<\/script/gi, '<\\/script');

  const sanity = [];
  if (/^import\s/m.test(js)) sanity.push('leftover import statement');
  if (/^export\s/m.test(js)) sanity.push('leftover export statement');
  if (sanity.length) throw new Error(`bundle sanity check failed: ${sanity.join(', ')}`);

  const shell = (title, theme, bodyHtml, bodyClass = '') => `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark light" />
  <meta name="theme-color" content="#0b1120" />
  <title>${title}</title>
  <link rel="icon" href="${faviconUri}" type="image/svg+xml" />
  <link rel="manifest" href="manifest.webmanifest" />
  <style>
${css}
  </style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${bodyHtml}
  <script type="module">
${js}
  </script>
</body>
</html>
`;

  const appHtml = shell(
    'Shop Ops · Dashboard',
    'dark',
    `  <div class="app">
    <aside id="sidebar" class="sidebar"></aside>
    <div class="main">
      <header id="topbar" class="topbar"></header>
      <main id="content" class="content"></main>
    </div>
  </div>

  <div id="search-results" class="search-results" role="listbox"></div>`,
  );

  const kioskHtml = shell(
    'Shop Ops · Wall Board',
    'kiosk',
    `  <div id="kiosk" class="kiosk">
    <div class="kiosk-loading">Connecting to the shop board…</div>
  </div>`,
    'kiosk-body',
  );

  writeFileSync(join(ROOT, 'index.html'), appHtml);
  writeFileSync(join(ROOT, 'display.html'), kioskHtml);
  console.log(`[build] index.html   ${(appHtml.length / 1024).toFixed(1)} KB`);
  console.log(`[build] display.html ${(kioskHtml.length / 1024).toFixed(1)} KB`);
}

build();
