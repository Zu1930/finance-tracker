"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setError(json.error ?? "Не удалось войти.");
    setBusy(false);
  };

  return (
    <div className="px-4">
      <form className="panel mx-auto mt-[12vh] max-w-[380px]" onSubmit={submit}>
        <h1 className="mb-5 flex items-center gap-2 text-2xl font-bold tracking-tight"><img src="/icon.svg" alt="" className="size-8" />Траты</h1>
        <label className="mb-2 block text-sm text-muted" htmlFor="pw">Пароль</label>
        <input id="pw" className="input w-full" type="password" autoFocus autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn mt-3 w-full" disabled={busy || !password}>{busy ? "Вхожу…" : "Войти"}</button>
        <div className="mt-3 min-h-5 text-sm text-bad" role="alert">{error}</div>
      </form>
    </div>
  );
}
