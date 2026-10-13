// Проверка кодировки всех текстовых файлов проекта: UTF-8 без BOM,
// отсутствие двойного кодирования (UTF-8, прочитанный как CP1251).
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SKIP_DIRS = new Set(['node_modules', '.git', 'uploads', '.pgdata-test']);
const EXTS = new Set(['.js', '.json', '.html', '.css', '.sql', '.md', '.txt', '.svg']);

// Обратная таблица CP1251 → Unicode
const cp1251ToUnicode = (() => {
    const t = new Array(256);
    for (let i = 0; i < 0x80; i++) t[i] = String.fromCharCode(i);
    const high = {
        0x80: 0x0402, 0x81: 0x0403, 0x82: 0x201A, 0x83: 0x0453, 0x84: 0x201E, 0x85: 0x2026,
        0x86: 0x2020, 0x87: 0x2021, 0x88: 0x20AC, 0x89: 0x2030, 0x8A: 0x0409, 0x8B: 0x2039,
        0x8C: 0x040A, 0x8D: 0x040C, 0x8E: 0x040B, 0x8F: 0x040F, 0x90: 0x0452, 0x91: 0x2018,
        0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
        0x99: 0x2122, 0x9A: 0x0459, 0x9B: 0x203A, 0x9C: 0x045A, 0x9D: 0x045C, 0x9E: 0x045B,
        0x9F: 0x045F, 0xA0: 0x00A0, 0xA1: 0x040E, 0xA2: 0x045E, 0xA3: 0x0408, 0xA4: 0x00A4,
        0xA5: 0x0490, 0xA6: 0x00A6, 0xA7: 0x00A7, 0xA8: 0x0401, 0xA9: 0x00A9, 0xAA: 0x0404,
        0xAB: 0x00AB, 0xAC: 0x00AC, 0xAD: 0x00AD, 0xAE: 0x00AE, 0xAF: 0x0407, 0xB0: 0x00B0,
        0xB1: 0x00B1, 0xB2: 0x0406, 0xB3: 0x0456, 0xB4: 0x0491, 0xB5: 0x00B5, 0xB6: 0x00B6,
        0xB7: 0x00B7, 0xB8: 0x0451, 0xB9: 0x2116, 0xBA: 0x0454, 0xBB: 0x00BB, 0xBC: 0x0458,
        0xBD: 0x0405, 0xBE: 0x0455, 0xBF: 0x0457
    };
    for (let i = 0x80; i < 0x100; i++) t[i] = String.fromCharCode(high[i] !== undefined ? high[i] : i);
    for (let i = 0xC0; i < 0x100; i++) t[i] = String.fromCharCode(0x0410 + (i - 0xC0));
    return t;
})();
const mojibakeChars = new Set(cp1251ToUnicode.filter(ch => ch.codePointAt(0) > 0x2010 || (ch.codePointAt(0) >= 0x0400 && ch.codePointAt(0) <= 0x045F)));

let problems = 0;
const files = [];
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (EXTS.has(path.extname(entry.name).toLowerCase())) {
            files.push(path.join(dir, entry.name));
        }
    }
})(ROOT);

for (const file of files) {
    const buf = fs.readFileSync(file);
    const rel = path.relative(ROOT, file);
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        console.log(`  ❌ ${rel}: BOM в начале файла (должен быть UTF-8 без BOM)`);
        problems++;
    }
    const text = buf.toString('utf8');
    if (text.includes('\uFFFD')) {
        console.log(`  ❌ ${rel}: содержит символ-замену U+FFFD — битая кодировка`);
        problems++;
        continue;
    }
    // Признак двойного кодирования: буквы Р/С, за которыми идут «мусорные»
    // символы из диапазона CP1251-артефактов (ª, ‡, ‘, — и т.п.).
    // Обычный русский текст таких сочетаний не даёт.
    const suspicious = text.match(/[\u0420\u0421][\u0080-\u00BF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u2020\u2021\u2030\u2039\u203A\u2122\u0402-\u040F\u0452-\u045F]/g);
    if (suspicious && suspicious.length > 5) {
        console.log(`  ❌ ${rel}: похоже на двойное кодирование (${suspicious.length} совпадений, напр. "${suspicious[0]}")`);
        problems++;
    }
}

console.log(`\nПроверено файлов: ${files.length}. Проблем: ${problems}`);
process.exit(problems ? 1 : 0);
