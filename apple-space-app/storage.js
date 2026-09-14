// ============================================================================
//  storage.js — Yandex Object Storage (S3-совместимый)
//  Загрузка, сжатие изображений, подписанные ссылки, удаление
// ============================================================================
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const crypto = require('crypto');

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

// === Лимиты ===
const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10 МБ
const MAX_IMAGES_PER_MESSAGE = 10;

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

// ============================================================================
//  Проверка конфигурации при старте
// ============================================================================
function initStorage() {
    const required = ['YC_ACCESS_KEY_ID', 'YC_SECRET_ACCESS_KEY', 'YC_BUCKET_NAME'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length) {
        console.warn('⚠️ Yandex Object Storage не настроен. Отсутствуют:', missing.join(', '));
        return false;
    }
    console.log('✅ Yandex Object Storage подключён (bucket:', BUCKET + ')');
    return true;
}

// ============================================================================
//  Проверка MIME и размера
// ============================================================================
function validateFile(mime, size) {
    if (!ALLOWED_MIME[mime]) {
        throw new Error('Недопустимый тип файла: ' + mime);
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
    return `${prefix}/${year}/${month}/${hash}.${ext}`;
}

// ============================================================================
//  Загрузка файла
// ============================================================================
async function uploadFile(buffer, originalName, mime, prefix = 'chat') {
    const rule = validateFile(mime, buffer.length);
    const { buffer: finalBuffer, mime: finalMime, ext } = await compressImage(buffer, mime);
    const key = generateKey(originalName, ext, prefix);

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
    try {
        await S3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
        return true;
    } catch (e) {
        console.error('Ошибка удаления файла:', e.message);
        return false;
    }
}

// ============================================================================
//  Подписанная ссылка на файл (живёт 24 часа)
// ============================================================================
async function getSignedFileUrl(key) {
    if (!key) return null;
    try {
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        return await getSignedUrl(S3, command, { expiresIn: SIGNED_URL_TTL });
    } catch (e) {
        console.error('Ошибка создания ссылки:', e.message);
        return null;
    }
}

// ============================================================================
//  Подписанные ссылки для массива ключей
// ============================================================================
async function getSignedUrls(keys) {
    if (!keys || !keys.length) return [];
    return Promise.all(keys.map(k => getSignedFileUrl(k)));
}

// ============================================================================
//  Presigned PUT (для прямой загрузки с клиента)
// ============================================================================
async function getUploadUrl(key, mime) {
    const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: mime });
    return await getSignedUrl(S3, command, { expiresIn: 600 });
}

module.exports = {
    initStorage,
    uploadFile,
    deleteFile,
    getSignedFileUrl,
    getSignedUrls,
    getUploadUrl,
    validateFile,
    ALLOWED_MIME,
    MAX_FILE_SIZE,
    MAX_IMAGES_PER_MESSAGE
};