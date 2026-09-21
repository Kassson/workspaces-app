// ============================================================================
// storage.js — Yandex Object Storage (S3-совместимый)
// Загрузка, сжатие изображений, подписанные ссылки, удаление
// ============================================================================
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const crypto = require('crypto');

const S3 = new S3Client({
    region: process.env.YC_REGION || 'ru-central1',
    endpoint: process.env.YC_ENDPOINT || 'https://storage.yandexcloud.net',
    credentials: { accessKeyId: process.env.YC_ACCESS_KEY_ID, secretAccessKey: process.env.YC_SECRET_ACCESS_KEY }
});

const BUCKET = process.env.YC_BUCKET_NAME;
const SIGNED_URL_TTL = 60 * 60 * 24;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Некоторые мобильные браузеры присылают JPG/HEIC с нестандартным MIME.
const MIME_ALIASES = {
    'image/jpg': 'image/jpeg',
    'image/heic': 'image/jpeg',
    'image/heif': 'image/jpeg',
    'image/bmp': 'image/jpeg'
};

const ALLOWED_MIME = {
    'image/jpeg': { ext: 'jpg', compress: true, maxSize: 10 * 1024 * 1024 },
    'image/png': { ext: 'png', compress: true, maxSize: 10 * 1024 * 1024 },
    'image/webp': { ext: 'webp', compress: true, maxSize: 10 * 1024 * 1024 },
    'image/gif': { ext: 'gif', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/pdf': { ext: 'pdf', compress: false, maxSize: 10 * 1024 * 1024 },
    'application/msword': { ext: 'doc', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/vnd.ms-excel': { ext: 'xls', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/zip': { ext: 'zip', compress: false, maxSize: 5 * 1024 * 1024 },
    'application/x-rar-compressed': { ext: 'rar', compress: false, maxSize: 5 * 1024 * 1024 },
    'video/mp4': { ext: 'mp4', compress: false, maxSize: 20 * 1024 * 1024 },
    'video/webm': { ext: 'webm', compress: false, maxSize: 20 * 1024 * 1024 }
};

function normalizeMimeType(mime) {
    const value = String(mime || '').toLowerCase().trim();
    return MIME_ALIASES[value] || value;
}

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

function validateFile(mime, size) {
    const normalizedMime = normalizeMimeType(mime);
    const rule = ALLOWED_MIME[normalizedMime];
    if (!rule) throw new Error('Недопустимый тип файла: ' + mime);
    if (size > rule.maxSize) throw new Error(`Файл слишком большой. Максимум для этого типа: ${Math.round(rule.maxSize / 1024 / 1024)} МБ`);
    if (size > MAX_FILE_SIZE) throw new Error(`Файл слишком большой. Общий лимит: ${MAX_FILE_SIZE / 1024 / 1024} МБ`);
    return rule;
}

async function compressImage(buffer, mime) {
    const normalizedMime = normalizeMimeType(mime);
    if (!normalizedMime.startsWith('image/')) return { buffer, mime: normalizedMime, ext: ALLOWED_MIME[normalizedMime].ext };
    if (normalizedMime === 'image/gif') return { buffer, mime: normalizedMime, ext: 'gif' };
    try {
        const compressed = await sharp(buffer).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
        return { buffer: compressed, mime: 'image/webp', ext: 'webp' };
    } catch (e) {
        console.error('Ошибка сжатия изображения:', e.message);
        return { buffer, mime: normalizedMime, ext: ALLOWED_MIME[normalizedMime].ext };
    }
}

function generateKey(originalName, ext, prefix = 'chat') {
    const date = new Date();
    return `${prefix}/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
}

async function uploadFile(buffer, originalName, mime, prefix = 'chat') {
    const normalizedMime = normalizeMimeType(mime);
    validateFile(normalizedMime, buffer.length);
    const { buffer: finalBuffer, mime: finalMime, ext } = await compressImage(buffer, normalizedMime);
    const key = generateKey(originalName, ext, prefix);
    await S3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: finalBuffer, ContentType: finalMime, CacheControl: 'public, max-age=31536000' }));
    return { key, size: finalBuffer.length, mime: finalMime, originalName };
}

async function deleteFile(key) {
    try { await S3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
    catch (e) { console.error('Ошибка удаления файла:', e.message); return false; }
}

async function getSignedFileUrl(key) {
    if (!key) return null;
    try { return await getSignedUrl(S3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: SIGNED_URL_TTL }); }
    catch (e) { console.error('Ошибка создания ссылки:', e.message); return null; }
}

module.exports = { initStorage, uploadFile, deleteFile, getSignedFileUrl, validateFile, ALLOWED_MIME, MAX_FILE_SIZE, normalizeMimeType };
