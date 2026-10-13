// Показывает, какие файлы уйдут в репозиторий GitHub, с учётом .gitignore.
// Запуск: node tools-list-repo-files.js
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// Правила .gitignore (только те, что используются в проекте)
const ignorePatterns = [
    /^node_modules\//,
    /^\.env$/,
    /^\.env\.local$/,
    /^\.env\..*\.local$/,
    /^public\/uploads\//,
    /^uploads\//,
    /^\.pgdata-test\//,
    /\.log$/,
    /^\.DS_Store$/,
    /^Thumbs\.db$/,
    /^desktop\.ini$/,
    /^\.vscode\//,
    /^\.idea\//
];

function ignored(rel) {
    const normalized = rel.replace(/\\/g, '/');
    return ignorePatterns.some(re => re.test(normalized));
}

const files = [];
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(ROOT, abs);
        if (ignored(rel) || ignored(rel + '/')) continue;
        if (entry.isDirectory()) walk(abs);
        else files.push(rel.replace(/\\/g, '/'));
    }
})(ROOT);

files.sort();
let total = 0;
console.log('Файлы, которые попадут в репозиторий:\n');
for (const f of files) {
    const size = fs.statSync(path.join(ROOT, f)).size;
    total += size;
    console.log('  ' + f.padEnd(34) + (size / 1024).toFixed(1).padStart(8) + ' КБ');
}
console.log('\nИтого: ' + files.length + ' файлов, ' + (total / 1024 / 1024).toFixed(2) + ' МБ');
console.log('\nИсключено (в репозиторий не идёт):');
const excluded = [
    'node_modules/     — восстанавливается командой npm ci',
    '.env               — секреты, задаются в Render Environment',
    'public/uploads/    — пользовательские файлы'
];
excluded.forEach(e => console.log('  ' + e));
