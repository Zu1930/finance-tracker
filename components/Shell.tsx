"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTracker } from "./TrackerProvider";
import { Setup } from "./Setup";

const TABS = [
  { href: "/", label: "Ввод" },
  { href: "/limits", label: "Лимиты" },
  { href: "/goals", label: "Копилки" },
  { href: "/chart", label: "График" },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, data, reload, toastState, dismissToast } = useTracker();

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  };

  let body: ReactNode;
  if (status === "loading") body = <div className="loading">Загружаю данные…</div>;
  else if (status === "error")
    body = (
      <div className="panel">
        <p>Не удалось загрузить данные. Проверьте подключение к Upstash Redis в настройках Vercel.</p>
        <button className="btn" onClick={() => void reload()}>Повторить</button>
      </div>
    );
  else if (!data.settings) body = <Setup />;
  else body = children;

  return (
    <div className="wrap">
      <header>
        <div className="brand">Траты</div>
        <nav>
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={pathname === t.href ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <button className="link-btn" onClick={logout}>Выйти</button>
      </header>
      <main>{body}</main>
      {toastState && (
        <div className="toast" role="status" key={toastState.id}>
          <span>{toastState.msg}</span>
          {toastState.actionLabel && (
            <button onClick={() => { dismissToast(); toastState.action?.(); }}>{toastState.actionLabel}</button>
          )}
        </div>
      )}
    </div>
  );
}
