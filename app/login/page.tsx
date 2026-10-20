"use client";

import { useEffect, useState } from "react";

type User = { id: string; name: string };
const LAST_USER_KEY = "ft:login-user";

export default function LoginPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: User[]) => {
        setUsers(list);
        let last = "";
        try {
          last = localStorage.getItem(LAST_USER_KEY) ?? "";
        } catch {}
        setUserId(list.some((u) => u.id === last) ? last : (list[0]?.id ?? ""));
      })
      .catch(() => setError("Сервер недоступен."));
  }, []);

  const pick = (id: string) => {
    setUserId(id);
    setError("");
    try {
      localStorage.setItem(LAST_USER_KEY, id);
    } catch {}
    document.getElementById("pw")?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, password }),
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
        <div className="tgroup mt-6" role="group" aria-label="Пользователь">
          {users.map((u) => (
            <button key={u.id} type="button" className="tb h-12 sm:h-auto" aria-pressed={userId === u.id} onClick={() => pick(u.id)}>
              {u.name}
            </button>
          ))}
        </div>
        <div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor="pw" className="lbl">Password</label>
          <input id="pw" className="tfield flex-1" type="password" autoFocus autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="tb mt-6 h-12 w-full font-bold sm:h-auto" disabled={busy || !password || !userId}>{busy ? "Вхожу…" : "Войти"}</button>
        <p className="mt-3 min-h-5 text-bad uppercase" role="alert">{error && `!! ${error.replace(/\.$/, "")}`}</p>
      </form>
    </div>
  );
}
