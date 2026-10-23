// Отправка писем по SMTP: фейковый SMTP-сервер принимает письмо, проверяем отправителя, получателя и текст.
// Запуск: npm run test
import { test, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

// Минимальный SMTP без TLS и авторизации: только чтобы увидеть, что ушло
const got = [];
const server = net.createServer((sock) => {
  let data = null, buf = "";
  const say = (s) => sock.write(s + "\r\n");
  say("220 fake");
  sock.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = data !== null ? buf.indexOf("\r\n.\r\n") : buf.indexOf("\r\n")) >= 0) {
      if (data !== null) {
        got.push({ ...data, body: buf.slice(0, i) });
        buf = buf.slice(i + 5);
        data = null;
        say("250 queued");
        continue;
      }
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO" || cmd === "HELO") say("250 fake");
      else if (cmd === "MAIL") (got.from = line), say("250 ok");
      else if (cmd === "RCPT") (got.to = line), say("250 ok");
      else if (cmd === "DATA") (data = { from: got.from, to: got.to }), say("354 go");
      else if (cmd === "QUIT") say("221 bye"), sock.end();
      else say("250 ok");
    }
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
after(() => server.close());
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(server.address().port), SMTP_SECURE: "false", MAIL_FROM: "SPEND.LOG <me@example.com>" });
const { sendMail, mails, outbox } = await import("./mail.ts");

test("SMTP: письмо уходит на сервер с отправителем MAIL_FROM, получателем и текстом; outbox не используется", async () => {
  await sendMail(mails.verify("new@example.com", "https://app.example/api/auth/verify-email?token=abc"));
  assert.equal(got.length, 1);
  assert.match(got[0].from, /<me@example\.com>/);
  assert.match(got[0].to, /<new@example\.com>/);
  assert.match(got[0].body, /Subject: =\?UTF-8\?/i, "тема в UTF-8");
  assert.match(got[0].body, /verify-email\?token=3Dabc|verify-email\?token=abc/, "ссылка в тексте");
  assert.match(got[0].body, /text\/html/, "есть и HTML-версия");
  assert.equal(outbox.length, 0);
});
