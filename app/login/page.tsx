"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const LAST_EMAIL_KEY = "ft:login-email";
/** Куда вернуться после входа (?next=): только свой путь, не //чужой.сайт */
const safeNext = (v: string | null) => (v && /^\/(?![\/\\])/.test(v) ? v : "/");

/** Вход по email и паролю (Better Auth). Ответ не уточняет, что неверно: email или пароль */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [next, setNext] = useState("/");

  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
    try {
      const last = localStorage.getItem(LAST_EMAIL_KEY);
      if (last) {
        setEmail(last);
        document.getElementById("pw")?.focus();
      }
    } catch {}
  }, []);

  // Пришли по ссылке-приглашению: регистрация — по этому приглашению, без кода
  const invite = /^\/join\/([\w-]+)$/.exec(next)?.[1];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setUnverified(false);
    const res = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    }).catch(() => null);
    if (res?.ok) {
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email.trim());
      } catch {}
      window.location.href = next;
      return;
    }
    if (res?.status === 403) setUnverified(true);
    setError(!res ? "Сервер недоступен" : res.status === 403 ? "Email не подтверждён" : res.status === 429 ? "Слишком много попыток, подождите" : res.status < 500 ? "Неверный email или пароль" : "Не удалось войти");
    setBusy(false);
  };

  return (
    <div className="px-4">
      <form className="mx-auto mt-[12vh] max-w-sm" onSubmit={submit}>
        <h1 className="sec">Auth</h1>
        <div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor="email" className="lbl w-[11ch]">Email</label>
          <input id="email" className="tfield flex-1" type="email" inputMode="email" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="mt-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor="pw" className="lbl w-[11ch]">Password</label>
          <input id="pw" className="tfield flex-1" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="tb mt-6 h-12 w-full font-bold sm:h-auto" disabled={busy || !password || !email.trim()}>{busy ? "Вхожу…" : "Войти"}</button>
        <p className="mt-3 min-h-5 text-bad uppercase" role="alert">{error && `!! ${error}`}</p>
        {unverified && (
          <p className="mt-1 uppercase">
            <Link href={`/check-email?email=${encodeURIComponent(email.trim())}${invite ? `&invite=${encodeURIComponent(invite)}` : ""}`} className="tb">Отправить письмо ещё раз</Link>
          </p>
        )}
        <div className="mt-8 flex flex-wrap gap-x-4 gap-y-2 uppercase">
          <Link href={invite ? `/signup?invite=${encodeURIComponent(invite)}` : "/signup"} className="tb">Регистрация</Link>
          <Link href="/forgot-password" className="tb">Забыли пароль</Link>
        </div>
      </form>
    </div>
  );
}
