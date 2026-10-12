// ============================================================================
//  storage.js — хранилище файлов
//  Основной режим  : Yandex Object Storage (S3-совместимый)
//  Резервный режим : локальный диск (public/uploads), включается автоматически,
//                    если не заданы переменные окружения YC_*.
//  Загрузка, сжатие изображений, ссылки, удаление
// ============================================================================
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

// === Конфигурация из переменных окружения ===
const S3 = new S3Client({
    region: process.env.YC_REGION || 'ru-central1',
    endpoint: process.env.YC_ENDPOINT || 'https://storage.yandexcloud.net',
    credentials: {
        accessKeyId: process.env.YC_ACCESS_KEY_ID,
        secretAccessKey: process.env.YC_SECRET_ACCESS_KEY
    }
});

const BUCKET = process.env.YC_BUCKET_NAME;
const SIGNED_URL_TTL = 60 * 60 * 24; // 24 часа

// === Локальное хранилище (резервный режим) ===
const LOCAL_ROOT = process.env.LOCAL_UPLOAD_DIR
    ? path.resolve(process.env.LOCAL_UPLOAD_DIR)
    : path.join(__dirname, 'public', 'uploads');
const LOCAL_URL_PREFIX = '/uploads';
// Публичный адрес, по которому раздаётся локальное хранилище
const LOCAL_PUBLIC_PATH = '/api/local-files';

let useLocalStorage = false;

// === Лимиты ===
const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10 МБ

// === Разрешённые MIME-типы ===
const ALLOWED_MIME = {
    'image/jpeg': { ext: 'jpg',  compress: true,  maxSize: 10 * 1024 * 1024 },
    'image/png':  { ext: 'png',  compress: true,  maxSize: 10 * 1024 * 1024 },
    'image/webp': { ext: 'webp', compress: true,  maxSize: 10 * 1024 * 1024 },
    'image/gif':  { ext: 'gif',  compress: false, maxSize: 5  * 1024 * 1024 },
    'application/pdf': { ext: 'pdf', compress: false, maxSize: 10 * 1024 * 1024 },
    'application/msword': { ext: 'doc', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/vnd.ms-excel': { ext: 'xls', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/zip': { ext: 'zip', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/x-rar-compressed': { ext: 'rar', compress: false, maxSize: 5 * 1024 * 1024 },
    'video/mp4':  { ext: 'mp4',  compress: false, maxSize: 20 * 1024 * 1024 },
    'video/webm': { ext: 'webm', compress: false, maxSize: 20 * 1024 * 1024 }
};

// Дополнительные расширения → MIME, если браузер прислал пустой/неверный тип
const EXT_TO_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip', rar: 'application/x-rar-compressed',
    mp4: 'video/mp4', webm: 'video/webm'
};

// ============================================================================
//  Определение MIME по имени файла (когда браузер прислал octet-stream)
// ============================================================================
function guessMime(originalName, mime) {
    if (mime && ALLOWED_MIME[mime]) return mime;
    const ext = String(originalName || '').split('.').pop().toLowerCase();
    if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
    return mime;
}

// ============================================================================
//  Проверка конфигурации при старте
// ============================================================================
function initStorage() {
    const required = ['YC_ACCESS_KEY_ID', 'YC_SECRET_ACCESS_KEY', 'YC_BUCKET_NAME'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length) {
        useLocalStorage = true;
        try {
            fs.mkdirSync(LOCAL_ROOT, { recursive: true });
            console.warn('⚠️ Yandex Object Storage не настроен. Отсутствуют:', missing.join(', '));
            console.log('📁 Файлы сохраняются локально:', LOCAL_ROOT);
        } catch (e) {
            console.error('❌ Не удалось создать каталог локального хранилища:', e.message);
        }
        return false;
    }
    useLocalStorage = false;
    console.log('✅ Yandex Object Storage подключён (bucket:', BUCKET + ')');
    return true;
}

function isLocalMode() { return useLocalStorage; }

// ============================================================================
//  Проверка MIME и размера
// ============================================================================
function validateFile(mime, size) {
    if (!ALLOWED_MIME[mime]) {
        throw new Error('Недопустимый тип файла: ' + (mime || 'неизвестно'));
    }
    const rule = ALLOWED_MIME[mime];
    if (size > rule.maxSize) {
        const mb = Math.round(rule.maxSize / 1024 / 1024);
        throw new Error(`Файл слишком большой. Максимум для этого типа: ${mb} МБ`);
    }
    if (size > MAX_FILE_SIZE) {
        throw new Error(`Файл слишком большой. Общий лимит: ${MAX_FILE_SIZE / 1024 / 1024} МБ`);
    }
    return rule;
}

// ============================================================================
//  Сжатие изображений (WebP, 1600px, 75%)
// ============================================================================
async function compressImage(buffer, mime) {
    if (!mime.startsWith('image/')) return { buffer, mime, ext: ALLOWED_MIME[mime].ext };
    if (mime === 'image/gif') return { buffer, mime, ext: 'gif' };

    try {
        const compressed = await sharp(buffer)
            .rotate() // учитываем EXIF-ориентацию
            .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer();
        return { buffer: compressed, mime: 'image/webp', ext: 'webp' };
    } catch (e) {
        console.error('Ошибка сжатия изображения:', e.message);
        return { buffer, mime, ext: ALLOWED_MIME[mime].ext };
    }
}

// ============================================================================
//  Генерация уникального имени файла
// ============================================================================
function generateKey(originalName, ext, prefix = 'chat') {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hash = crypto.randomBytes(8).toString('hex');
    const safePrefix = String(prefix || 'chat').replace(/[^a-zA-Z0-9/_-]/g, '').replace(/^\/+|\/+$/g, '') || 'chat';
    return `${safePrefix}/${year}/${month}/${hash}.${ext}`;
}

// ============================================================================
//  Загрузка файла
// ============================================================================
async function uploadFile(buffer, originalName, mime, prefix = 'chat') {
    const finalInputMime = guessMime(originalName, mime);
    validateFile(finalInputMime, buffer.length);
    const { buffer: finalBuffer, mime: finalMime, ext } = await compressImage(buffer, finalInputMime);
    const key = generateKey(originalName, ext, prefix);

    if (useLocalStorage) {
        const abs = localPathFor(key);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, finalBuffer);
        return { key, size: finalBuffer.length, mime: finalMime, originalName };
    }

    await S3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: finalBuffer,
        ContentType: finalMime,
        CacheControl: 'public, max-age=31536000'
    }));

    return {
        key,
        size: finalBuffer.length,
        mime: finalMime,
        originalName
    };
}

// ============================================================================
//  Удаление файла
// ============================================================================
async function deleteFile(key) {
    if (!key) return false;
    const realKey = extractKeyFromValue(key);
    if (!realKey) return false;

    if (useLocalStorage) {
        try {
            await fsp.unlink(localPathFor(realKey));
            return true;
        } catch (e) {
            if (e.code !== 'ENOENT') console.error('Ошибка удаления локального файла:', e.message);
            return false;
        }
    }

    try {
        await S3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: realKey }));
        return true;
    } catch (e) {
        console.error('Ошибка удаления файла:', e.message);
        return false;
    }
}

// ============================================================================
//  Локальные пути
// ============================================================================
function localPathFor(key) {
    const normalized = String(key).replace(/\\/g, '/').replace(/^\/+/, '');
    // Защита от path traversal
    if (normalized.includes('..')) throw new Error('Недопустимый ключ файла');
    const abs = path.resolve(LOCAL_ROOT, normalized);
    const rootResolved = path.resolve(LOCAL_ROOT);
    if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
        throw new Error('Недопустимый ключ файла');
    }
    return abs;
}

// ============================================================================
//  Извлечение ключа из значения, которое может быть ключом ИЛИ уже ссылкой
//  (в БД исторически попадали полные подписанные URL — они истекают за 24 ч)
// ============================================================================
function extractKeyFromValue(value) {
    if (!value || typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;

    if (!/^https?:\/\//i.test(raw)) {
        return raw.replace(/^\/+/, '');
    }

    try {
        const url = new URL(raw);
        const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        if (pathname.startsWith('api/local-files/')) {
            return pathname.slice('api/local-files/'.length);
        }
        if (pathname.startsWith('uploads/')) {
            return pathname.slice('uploads/'.length);
        }
        // Yandex Object Storage: /<bucket>/<key>
        if (BUCKET && pathname.startsWith(BUCKET + '/')) {
            return pathname.slice(BUCKET.length + 1);
        }
        // Прочие S3-совместимые адреса вида /<bucket>/<key>
        const parts = pathname.split('/');
        if (parts.length > 1) return parts.slice(1).join('/');
        return pathname;
    } catch (e) {
        return null;
    }
}

// ============================================================================
//  Ссылка на файл
//  - локальный режим  → стабильный относительный URL
//  - Object Storage   → подписанная ссылка (живёт 24 часа)
// ============================================================================
async function getSignedFileUrl(key) {
    if (!key) return null;
    const realKey = extractKeyFromValue(key);
    if (!realKey) return null;

    if (useLocalStorage) {
        const encoded = realKey.split('/').map(encodeURIComponent).join('/');
        return `${LOCAL_PUBLIC_PATH}/${encoded}`;
    }

    try {
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: realKey });
        return await getSignedUrl(S3, command, { expiresIn: SIGNED_URL_TTL });
    } catch (e) {
        console.error('Ошибка создания ссылки:', e.message);
        return null;
    }
}

// ============================================================================
//  Пакетное получение ссылок (с дедупликацией)
// ============================================================================
async function getSignedFileUrls(keys) {
    const list = Array.isArray(keys) ? keys : [];
    const unique = [...new Set(list.filter(k => !!k))];
    const resolved = await Promise.all(unique.map(k => getSignedFileUrl(k).catch(() => null)));
    const map = new Map();
    unique.forEach((k, i) => map.set(k, resolved[i]));
    return map;
}

module.exports = {
    initStorage,
    isLocalMode,
    uploadFile,
    deleteFile,
    getSignedFileUrl,
    getSignedFileUrls,
    extractKeyFromValue,
    validateFile,
    guessMime,
    ALLOWED_MIME,
    MAX_FILE_SIZE,
    LOCAL_ROOT
};
