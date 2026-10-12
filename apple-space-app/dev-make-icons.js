// Генерация PNG-иконок приложения (192 и 512) без внешних зависимостей.
// Рисуем брендовый значок: синий круг со стилизованными «слоями».
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0; // filter: none
        rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // RGBA
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// --- Рисование ---
const BRAND = [0x00, 0x88, 0xCC];

function blend(dst, i, r, g, b, a) {
    const inv = 1 - a;
    dst[i] = Math.round(r * a + dst[i] * inv);
    dst[i + 1] = Math.round(g * a + dst[i + 1] * inv);
    dst[i + 2] = Math.round(b * a + dst[i + 2] * inv);
    dst[i + 3] = Math.round(255 * a + dst[i + 3] * inv);
}

function dist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
}

function makeIcon(size) {
    const px = Buffer.alloc(size * size * 4, 0);
    const cx = size / 2, cy = size / 2;
    // Круг занимает ~88% холста (для maskable-иконки нужен safe zone)
    const R = size * 0.44;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
            const aa = Math.max(0, Math.min(1, R - d + 0.5));
            if (aa > 0) blend(px, i, BRAND[0], BRAND[1], BRAND[2], aa);
        }
    }

    // Геометрия как в SVG-логотипе: viewBox 0..24, stroke-width 2
    const side = size * 0.80;             // сторона квадрата 24×24
    const off = (size - side) / 2;
    const u = side / 24;                  // единица viewBox → пиксели
    const lw = Math.max(1.5, 2 * u);      // stroke-width 2
    const P = (x, y) => ({ x: off + x * u, y: off + y * u });

    // «Шапка» (ромб) и два шеврона — как в оригинальном логотипе
    const layers = [
        [P(12, 3), P(3, 7.5)],
        [P(12, 3), P(21, 7.5)],
        [P(3, 7.5), P(12, 12)],
        [P(21, 7.5), P(12, 12)],
        [P(3, 17), P(12, 21.5)],
        [P(21, 17), P(12, 21.5)],
        [P(3, 12.5), P(12, 17)],
        [P(21, 12.5), P(12, 17)]
    ];
    for (const [a, b] of layers) stroke(px, size, a, b, lw);
    return encodePng(size, size, px);
}

function stroke(px, size, a, b, lw) {
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - lw - 2));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(a.x, b.x) + lw + 2));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - lw - 2));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(a.y, b.y) + lw + 2));
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const d = dist(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y);
            const aa = Math.max(0, Math.min(1, lw / 2 - d + 0.5));
            if (aa > 0) blend(px, (y * size + x) * 4, 255, 255, 255, aa);
        }
    }
}

for (const size of [192, 512]) {
    const out = path.join(__dirname, 'public', `icon-${size}.png`);
    fs.writeFileSync(out, makeIcon(size));
    console.log('✅', out, fs.statSync(out).size, 'байт');
}
