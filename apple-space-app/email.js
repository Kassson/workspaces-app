// ============================================================================
//  email.js — отправка писем через Gmail SMTP
// ============================================================================
const nodemailer = require('nodemailer');

let transporter = null;

function initEmail() {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.warn('⚠️ Gmail SMTP не настроен — письма отключены');
        return false;
    }
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    });
    console.log('✅ Gmail SMTP подключён');
    return true;
}

function emailLayout(title, bodyHtml) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
    <tr><td style="background:linear-gradient(135deg,#00a8e8,#0077b3);padding:28px;text-align:center;">
        <div style="color:#fff;font-size:24px;font-weight:700;">Workspaces</div>
    </td></tr>
    <tr><td style="padding:32px 28px;">
        <h1 style="margin:0 0 16px;font-size:20px;color:#000;">${title}</h1>
        ${bodyHtml}
    </td></tr>
    <tr><td style="padding:20px 28px;background:#fafafa;text-align:center;color:#707579;font-size:12px;">
        Это письмо отправлено автоматически. Не отвечайте на него.<br>
        © Workspaces
    </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function emailButton(text, url) {
    return `<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:12px;background:#0088cc;">
        <a href="${url}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">${text}</a>
    </td></tr></table>`;
}

async function sendPasswordReset(toEmail, fullName, token) {
    if (!transporter) return false;
    const link = `${process.env.APP_URL || 'https://workspaces-app.onrender.com'}/?reset=${token}`;
    const html = emailLayout('Сброс пароля', `
        <p style="margin:0 0 8px;color:#333;font-size:15px;">Здравствуйте, ${fullName || ''}!</p>
        <p style="margin:0 0 8px;color:#333;font-size:15px;">Кто-то запросил сброс пароля для вашего аккаунта в Workspaces.</p>
        <p style="margin:0;color:#333;font-size:15px;">Если это были вы — нажмите кнопку ниже. Ссылка действует <b>1 час</b>.</p>
        ${emailButton('Сбросить пароль', link)}
        <p style="margin:0;color:#707579;font-size:13px;">Если вы не запрашивали сброс — просто проигнорируйте это письмо.</p>
    `);
    try {
        await transporter.sendMail({
            from: `"Workspaces" <${process.env.GMAIL_USER}>`,
            to: toEmail,
            subject: 'Сброс пароля — Workspaces',
            html
        });
        return true;
    } catch (e) {
        console.error('Ошибка отправки письма (reset):', e.message);
        return false;
    }
}

async function sendEmailVerification(toEmail, fullName, token) {
    if (!transporter) return false;
    const link = `${process.env.APP_URL || 'https://workspaces-app.onrender.com'}/api/auth/verify-email?token=${token}`;
    const html = emailLayout('Подтверждение почты', `
        <p style="margin:0 0 8px;color:#333;font-size:15px;">Здравствуйте, ${fullName || ''}!</p>
        <p style="margin:0 0 8px;color:#333;font-size:15px;">Спасибо за регистрацию в Workspaces. Осталось подтвердить адрес электронной почты.</p>
        ${emailButton('Подтвердить почту', link)}
        <p style="margin:0;color:#707579;font-size:13px;">Ссылка действует 24 часа.</p>
    `);
    try {
        await transporter.sendMail({
            from: `"Workspaces" <${process.env.GMAIL_USER}>`,
            to: toEmail,
            subject: 'Подтверждение почты — Workspaces',
            html
        });
        return true;
    } catch (e) {
        console.error('Ошибка отправки письма (verify):', e.message);
        return false;
    }
}

module.exports = {
    initEmail,
    sendPasswordReset,
    sendEmailVerification
};