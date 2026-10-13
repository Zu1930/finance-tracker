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
    <div className="wrap">
      <form className="panel login" onSubmit={submit}>
        <h1>Траты</h1>
        <label className="field-label" htmlFor="pw" style={{ marginTop: 0 }}>Пароль</label>
        <input id="pw" className="input" type="password" autoFocus autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn" disabled={busy || !password}>{busy ? "Вхожу…" : "Войти"}</button>
        <div className="error" role="alert">{error}</div>
      </form>
    </div>
  );
}
