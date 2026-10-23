/**
 * Письма: SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS — например Gmail с паролем приложения), иначе Resend
 * (RESEND_API_KEY). Отправитель — MAIL_FROM (для SMTP по умолчанию SMTP_USER). Ни того ни другого — письмо пишется
 * в консоль и в outbox: так работают разработка и тесты. Тексты простые, моноширинные, без картинок и брендинга
 */
import nodemailer, { type Transporter } from "nodemailer";

export type Mail = { to: string; subject: string; text: string };

/** Отправленные без ключа письма (разработка и тесты) */
export const outbox: Mail[] = [];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Ссылки в тексте — кликабельные; всё остальное — как в терминале
const html = (text: string) =>
  `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(text).replace(/https?:\/\/\S+/g, (u) => `<a href="${u}">${u}</a>`)}</pre>`;

let smtp: Transporter | null = null;
const smtpTransport = () => {
  const port = Number(process.env.SMTP_PORT || 465);
  return (smtp ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 — TLS сразу; 587 — STARTTLS. SMTP_SECURE=false — без TLS (только локальные проверки)
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    ...(process.env.SMTP_USER && { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }),
  }));
};

export async function sendMail(mail: Mail): Promise<void> {
  if (process.env.SMTP_HOST) {
    const from = process.env.MAIL_FROM || (process.env.SMTP_USER ? `SPEND.LOG <${process.env.SMTP_USER}>` : "SPEND.LOG <noreply@localhost>");
    await smtpTransport().sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: html(mail.text) });
    return;
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    outbox.push(mail);
    if (process.env.NODE_ENV !== "test") console.log(`[mail] ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM || "SPEND.LOG <onboarding@resend.dev>", to: [mail.to], subject: mail.subject, text: mail.text, html: html(mail.text) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const sign = "\n--\nSPEND.LOG\nЕсли это были не вы — просто проигнорируйте письмо.";

export const mails = {
  verify: (to: string, url: string): Mail => ({
    to,
    subject: "Подтвердите email",
    text: `:: ПОДТВЕРЖДЕНИЕ EMAIL\n\n> Чтобы закончить регистрацию, откройте ссылку:\n\n${url}\n\nСсылка действует 24 часа.${sign}`,
  }),
  reset: (to: string, url: string): Mail => ({
    to,
    subject: "Сброс пароля",
    text: `:: СБРОС ПАРОЛЯ\n\n> Чтобы задать новый пароль, откройте ссылку:\n\n${url}\n\nСсылка действует 1 час. Пароль не изменится, пока вы не зададите новый.${sign}`,
  }),
  passwordChanged: (to: string): Mail => ({
    to,
    subject: "Пароль изменён",
    text: `:: ПАРОЛЬ ИЗМЕНЁН\n\n> Пароль вашего аккаунта только что изменили. Другие устройства вышли из аккаунта.\n\nЕсли это были не вы — сбросьте пароль на странице входа («Забыли пароль») и напишите владельцу сервиса.\n--\nSPEND.LOG`,
  }),
  accountDeleted: (to: string): Mail => ({
    to,
    subject: "Аккаунт удалён",
    text: `:: АККАУНТ УДАЛЁН\n\n> Ваш аккаунт и личные данные удалены. Восстановить их нельзя.\n\nВаши записи в семейном бюджете остались у других участников и показываются от «удалённого пользователя».\n--\nSPEND.LOG`,
  }),
};
