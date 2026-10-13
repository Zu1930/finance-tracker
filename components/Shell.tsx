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
  if (status === "loading") body = <div className="py-16 text-center text-muted">Загружаю данные…</div>;
  else if (status === "error")
    body = (
      <div className="panel">
        <p className="mb-4">Не удалось загрузить данные. Проверьте подключение к Upstash Redis в настройках Vercel.</p>
        <button className="btn" onClick={() => void reload()}>Повторить</button>
      </div>
    );
  else if (!data.settings) body = <Setup />;
  else body = children;

  return (
    <div className="mx-auto max-w-[1120px] px-3 pt-3 pb-10 sm:px-7 sm:pt-6 sm:pb-16">
      <header className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 sm:mb-10">
        <div className="flex items-center gap-2 text-base font-bold tracking-tight sm:text-lg"><img src="/icon.svg" alt="" className="size-6 sm:size-7" />Траты</div>
        <nav className="order-last flex w-full gap-1 rounded-xl border border-line bg-paper p-1 shadow-card sm:order-none sm:w-auto">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={pathname === t.href ? "page" : undefined}
              className="flex-1 rounded-lg px-2 py-1.5 text-center text-[15px] font-medium sm:text-base sm:flex-none sm:px-4 sm:py-1.5 text-muted transition-colors hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-paper">
              {t.label}
            </Link>
          ))}
        </nav>
        <button className="ml-auto text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={logout}>Выйти</button>
      </header>
      <main>{body}</main>
      {toastState && (
        <div role="status" key={toastState.id}
          className="fixed bottom-[calc(24px+env(safe-area-inset-bottom,0px))] left-1/2 z-10 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-4 rounded-xl bg-ink px-4 py-3 text-paper shadow-2xl starting:translate-y-2 starting:opacity-0 transition duration-200">
          <span>{toastState.msg}</span>
          {toastState.actionLabel && (
            <button className="font-semibold underline underline-offset-4" onClick={() => { dismissToast(); toastState.action?.(); }}>{toastState.actionLabel}</button>
          )}
        </div>
      )}
    </div>
  );
}
