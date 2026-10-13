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
      <form className="mx-auto mt-[12vh] max-w-sm" onSubmit={submit}>
        <h1 className="sec">Auth</h1>
        <div className="mt-6 flex items-center gap-3">
          <label htmlFor="pw" className="lbl">Password</label>
          <input id="pw" className="tfield flex-1" type="password" autoFocus autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="tb mt-6 w-full font-bold" disabled={busy || !password}>{busy ? "Вхожу…" : "Войти"}</button>
        <p className="mt-3 min-h-5 text-bad uppercase" role="alert">{error && `!! ${error.replace(/\.$/, "")}`}</p>
      </form>
    </div>
  );
}
