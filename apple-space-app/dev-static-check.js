// ============================================================================
//  dev-static-check.js — статические проверки клиента:
//    * каждый inline-обработчик onclick/onchange вызывает существующую функцию
//    * каждый getElementById('...') ссылается на существующий id
//    * базовые проверки sw.js / manifest.json
//  Запуск: node dev-static-check.js
// ============================================================================
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, 'public');
const jsFiles = ['shared.js', 'game.js', 'portal.js'];
const htmlFiles = ['index.html', path.join('teach', 'index.html')];

let problems = 0;
const fail = (msg) => { problems++; console.log('  ❌ ' + msg); };
const pass = (msg) => console.log('  ✅ ' + msg);

const jsSource = jsFiles.map(f => fs.readFileSync(path.join(pub, f), 'utf8')).join('\n');
const htmlSource = htmlFiles.map(f => fs.readFileSync(path.join(pub, f), 'utf8')).join('\n');

// --- Собираем имена функций/переменных, доступных из inline-обработчиков ---
const defined = new Set();
const declRe = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
const varFnRe = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g;
const winAssignRe = /(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=/g;
const classRe = /(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)/g;
for (const re of [declRe, varFnRe, winAssignRe, classRe]) {
    let m;
    while ((m = re.exec(jsSource)) !== null) defined.add(m[1]);
}
// Глобальные функции, объявленные в inline-скриптах HTML
for (const m of htmlSource.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);

console.log('=== 1. Inline-обработчики ссылаются на существующие функции ===');
const handlerCalls = new Set();
// Вызовы функций внутри inline-обработчиков: не считаем методы объектов (foo.bar())
function collectHandlerFns(src) {
    for (const m of src.matchAll(/on(?:click|change|submit|input|load|error|mouseover|mouseout|keydown|blur|focus)\s*=\s*["'`]([^"'`]*)["'`]/gi)) {
        const body = m[1];
        // Убираем обращения к свойствам и методам: .foo( / window.foo(
        const cleaned = body.replace(/[A-Za-z_$][\w$]*\s*\.\s*[A-Za-z_$][\w$]*\s*\(/g, ' ');
        for (const c of cleaned.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) handlerCalls.add(c[1]);
    }
}
collectHandlerFns(jsSource);
collectHandlerFns(htmlSource);
const BUILTINS = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'catch', 'function', 'alert', 'console', 'JSON', 'Object', 'Array', 'String', 'Number', 'Math', 'Date', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'confirm', 'prompt', 'Boolean', 'Error', 'RegExp', 'Set', 'Map', 'URL', 'fetch', 'Blob', 'File', 'FormData', 'requestAnimationFrame', 'cancelAnimationFrame']);
const missingHandlers = [...handlerCalls].filter(fn => !defined.has(fn) && !BUILTINS.has(fn));
if (missingHandlers.length) fail('не определены функции из inline-обработчиков: ' + missingHandlers.join(', '));
else pass(`все ${handlerCalls.size} обработчиков указывают на существующие функции`);

console.log('\n=== 2. getElementById ссылается на существующие id ===');
const ids = new Set();
for (const m of htmlSource.matchAll(/\sid\s*=\s*"([^"]+)"/g)) ids.add(m[1]);
// id из шаблонных строк JS: id="hwMenu-${...}", id='file-preview-'+i
const dynamicIdPrefixes = [];
for (const m of jsSource.matchAll(/id\s*=\s*\\?["'`]([^"'`${]*)/g)) {
    if (m[1]) dynamicIdPrefixes.push(m[1]);
}
for (const m of jsSource.matchAll(/id\s*=\s*\\?["'`]([^"'`]*?)\\?["'`]\s*\+/g)) dynamicIdPrefixes.push(m[1]);
// id из HTML-строк внутри JS
for (const m of jsSource.matchAll(/id\s*=\s*\\?["'`]([^"'`$]+)\\?["'`]/g)) ids.add(m[1]);

const missingIds = [];
for (const m of jsSource.matchAll(/getElementById\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    const id = m[2];
    if (ids.has(id)) continue;
    if (dynamicIdPrefixes.some(p => p && id.startsWith(p))) continue;
    missingIds.push(id);
}
// Динамические id через шаблон: getElementById(`file-img-${i}`)
for (const m of jsSource.matchAll(/getElementById\(\s*`([^`]*)`\s*\)/g)) {
    const prefix = m[1].split('${')[0];
    if (!prefix) continue;
    if (dynamicIdPrefixes.some(p => p && p.startsWith(prefix))) continue;
    missingIds.push(prefix + '…');
}
const uniqMissingIds = [...new Set(missingIds)];
if (uniqMissingIds.length) fail('getElementById для несуществующих id: ' + uniqMissingIds.join(', '));
else pass('все ссылки на id разрешаются');

console.log('\n=== 3. Дубликаты объявлений функций верхлевела (перекрытие) ===');
// Проверяем только функции на верхнем уровне (nesting depth = 0): одноимённые
// функции внутри разных игровых фабрик — это нормально (разные области видимости).
function topLevelFunctions(src) {
    const names = {};
    let depth = 0;
    const lines = src.split('\n');
    for (const line of lines) {
        if (depth === 0) {
            const m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
            if (m) names[m[1]] = (names[m[1]] || 0) + 1;
        }
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
    }
    return names;
}
const perFileDupes = [];
for (const f of jsFiles) {
    const c = topLevelFunctions(fs.readFileSync(path.join(pub, f), 'utf8'));
    for (const [name, n] of Object.entries(c)) if (n > 1) perFileDupes.push(`${f}: ${name} (${n})`);
}
if (perFileDupes.length) fail('дубликаты функций верхнего уровня: ' + perFileDupes.join(', '));
else pass('одноимённых функций верхнего уровня нет');
// Перекрытие между файлами: portal.js грузится позже и переопределяет shared.js
const allNames = {};
for (const f of jsFiles) {
    const c = topLevelFunctions(fs.readFileSync(path.join(pub, f), 'utf8'));
    for (const name of Object.keys(c)) (allNames[name] = allNames[name] || []).push(f);
}
const crossDupes = Object.entries(allNames).filter(([, files]) => new Set(files).size > 1);
if (crossDupes.length) console.log('  ℹ️  переопределения между файлами: ' + crossDupes.map(([n, f]) => `${n} (${f.join('→')})`).join(', '));

console.log('\n=== 4. Обращения к user-данным внутри innerHTML (XSS) ===');
const xssRisky = [];
for (const f of jsFiles) {
    const src = fs.readFileSync(path.join(pub, f), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
        // Ищем интерполяцию вида ${...name...} без escapeHtml рядом
        const m = line.match(/\$\{([^}]*\b(?:full_name|username|avatar_emoji|student_name|subject_name|title)\b[^}]*)\}/);
        if (m && !/escapeHtml|textContent|JSON\.stringify/.test(line)) {
            xssRisky.push(`${f}:${i + 1}: ${m[1].trim().slice(0, 60)}`);
        }
    });
}
if (xssRisky.length) {
    console.log('  ⚠️  возможные неэкранированные вставки:');
    xssRisky.slice(0, 12).forEach(x => console.log('     ' + x));
} else pass('неэкранированных вставок пользовательских данных не найдено');

console.log('\n=== 5. sw.js и manifest.json ===');
const sw = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.json'), 'utf8'));
const manifestIcons = (manifest.icons || []).map(i => i.src);
const missingIcons = manifestIcons.filter(src => !fs.existsSync(path.join(pub, src.replace(/^\//, ''))));
if (missingIcons.length) fail('иконки из manifest.json отсутствуют: ' + missingIcons.join(', '));
else pass('все иконки manifest.json существуют (' + manifestIcons.join(', ') + ')');
const precache = [...sw.matchAll(/['"]\/([^'"]+)['"]/g)].map(m => m[1]).filter(p => !p.startsWith('api/') && !p.startsWith('socket.io'));
const missingCache = precache.filter(p => p && !fs.existsSync(path.join(pub, p)) && !p.includes('*'));
if (missingCache.length) fail('sw.js кэширует отсутствующие файлы: ' + missingCache.join(', '));
else pass('список предкэша sw.js корректен');

console.log('\n=== 6. Версии ассетов согласованы ===');
const idx = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const teach = fs.readFileSync(path.join(pub, 'teach', 'index.html'), 'utf8');
const shared = fs.readFileSync(path.join(pub, 'shared.js'), 'utf8');
const getVersion = (src, label) => {
    const m = src.match(new RegExp(label + "[^\\n]*?[?&]v=(\\d+)"));
    return m ? m[1] : null;
};
const versions = {
    'index.html APP_VERSION': (idx.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1],
    'index.html style.css': getVersion(idx, 'style\\.css'),
    'index.html shared.js': getVersion(idx, 'shared\\.js'),
    'index.html game.js': getVersion(idx, 'game\\.js'),
    'teach APP_VERSION': (teach.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1],
    'teach style.css': getVersion(teach, 'style\\.css'),
    'teach shared.js': getVersion(teach, 'shared\\.js'),
    'shared.js APP_ASSET_VERSION': (shared.match(/APP_ASSET_VERSION\s*=\s*'(\d+)'/) || [])[1],
    'sw.js CACHE_NAME': (sw.match(/CACHE_NAME\s*=\s*'workspaces-v(\d+)'/) || [])[1]
};
const distinct = [...new Set(Object.values(versions).filter(Boolean))];
console.log('  ℹ️  ' + Object.entries(versions).map(([k, v]) => `${k}=${v}`).join(', '));
if (distinct.length > 1) fail('версии ассетов различаются: ' + distinct.join(' / '));
else pass('единая версия ассетов: ' + distinct[0]);

console.log(`\n──────────────\nПроблем: ${problems}\n`);
process.exit(problems ? 1 : 0);
