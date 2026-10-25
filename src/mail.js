// Envio de e-mail. Com SMTP configurado (ex.: Amazon SES) usa nodemailer; sem SMTP, escreve no log.
const config = require('./config');

let transporter = null;
if (config.smtp.host) {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function layout(titulo, corpo) {
  return `<!doctype html><html><body style="margin:0;background:#EEF4F3;font-family:Arial,sans-serif;color:#14211F">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0B3B36;color:#fff;padding:18px 24px;font-size:20px;font-weight:bold">Rout<span style="color:#E9B23A">Project</span></td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:18px">${esc(titulo)}</h2>${corpo}</td></tr>
<tr><td style="padding:14px 24px;color:#5B6B68;font-size:12px;border-top:1px solid #D2DEDB">Se você não pediu isto, ignore este e-mail.</td></tr>
</table></td></tr></table></body></html>`;
}

async function send(to, subject, html, text) {
  if (!transporter) {
    console.log(`[mail] (sem SMTP) Para: ${to} | ${subject}\n${text}`);
    return;
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, html, text });
}

function codeBlock(code) {
  return `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#E2F1EE;color:#0E6E63;text-align:center;padding:14px;border-radius:8px;margin:16px 0">${esc(code)}</p>`;
}

async function sendConfirmCode(to, nome, code) {
  const link = `${config.appUrl}/confirmar.html?email=${encodeURIComponent(to)}`;
  await send(to, 'RoutProject · Confirme seu e-mail',
    layout('Confirme seu e-mail', `<p>Olá, ${esc(nome)}. Use o código abaixo para confirmar seu cadastro:</p>${codeBlock(code)}<p>Ele vale por 30 minutos. <a href="${link}">Abrir a tela de confirmação</a>.</p>`),
    `Olá, ${nome}. Seu código de confirmação RoutProject: ${code} (vale 30 minutos). ${link}`);
}

async function sendResetCode(to, nome, code) {
  const link = `${config.appUrl}/redefinir.html?email=${encodeURIComponent(to)}`;
  await send(to, 'RoutProject · Recuperação de acesso',
    layout('Recuperação de acesso', `<p>Olá, ${esc(nome)}. Use o código abaixo para criar uma nova senha:</p>${codeBlock(code)}<p>Ele vale por 15 minutos. <a href="${link}">Abrir a tela de nova senha</a>.</p>`),
    `Olá, ${nome}. Seu código para nova senha RoutProject: ${code} (vale 15 minutos). ${link}`);
}

async function sendApproved(to, nome) {
  await send(to, 'RoutProject · Acesso liberado',
    layout('Acesso liberado', `<p>Olá, ${esc(nome)}. Seu acesso foi aprovado.</p><p><a href="${config.appUrl}/">Entrar no RoutProject</a></p>`),
    `Olá, ${nome}. Seu acesso ao RoutProject foi aprovado: ${config.appUrl}/`);
}

module.exports = { send, sendConfirmCode, sendResetCode, sendApproved };
