"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Expense, Settings, TrackerData, UserSettings } from "@/lib/types";
import { applyQueue, readQueue, withEntry, writeQueue, type Entry, type Kind, type Queued } from "@/lib/offline";
import { curMonthKey } from "@/lib/utils";

export type { Kind } from "@/lib/offline";

type ToastState = { id: number; msg: string; actionLabel?: string; action?: () => void } | null;

type Ctx = {
  data: TrackerData;
  status: "loading" | "ready" | "error";
  /** Нет связи: данные из офлайн-копии на savedAt (ISO; null — время неизвестно) */
  offline: { savedAt: string | null } | null;
  /** Записи без связи, ждут отправки */
  queued: number;
  /** force — применить ответ, даже если идут другие запросы (после 409) */
  reload: (force?: boolean) => Promise<void>;
  /** Новая запись. authorId выставит сервер; локально — текущий пользователь. Без связи — в очередь */
  addEntry: (kind: Kind, e: Entry) => void;
  /** Удаление; запись на сервере 10 минут лежит в корзине — restoreEntry вернёт её с исходным автором */
  removeEntry: (kind: Kind, e: Entry) => void;
  restoreEntry: (kind: Kind, e: Entry) => void;
  setSettings: (fn: (s: Settings | null) => Omit<Settings, "version">) => void;
  setMySettings: (fn: (s: UserSettings) => Omit<UserSettings, "version">) => void;
  /** Запрос к API сбережений и плана; после него данные перечитываются. null — ошибка (тост уже показан) */
  api: <T = unknown>(url: string, method: string, body?: unknown) => Promise<T | null>;
  /** Курсы сливаются на сервере без проверки версии: курс — «последний известный» */
  /** base — к какой базе посчитаны курсы: если её успели сменить, курсы отбрасываются */
  updateRates: (rates: Record<string, number>, ratesUpdatedAt?: string, base?: string) => void;
  month: string;
  setMonth: (m: string) => void;
  toast: (msg: string, actionLabel?: string, action?: () => void) => void;
  toastState: ToastState;
  dismissToast: () => void;
};

const TrackerContext = createContext<Ctx | null>(null);

export function useTracker() {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error("useTracker вне TrackerProvider");
  return ctx;
}

const NOBODY = { id: "", name: "" };
const EMPTY: TrackerData = {
  me: NOBODY,
  partner: NOBODY,
  settings: null,
  mySettings: { personalCategories: [], version: 0 },
  savings: { accounts: { family: [], mine: [] }, goals: { family: [], mine: [] }, partner: { total: 0, goalsAllocated: 0, lastUpdatedAt: null }, recons: [] },
  familyExpenses: {},
  myExpenses: {},
  incomes: {},
  partnerPersonalTotals: {},
  partnerPersonalDaily: {},
  partnerPlannedDaily: {},
    plans: {},
  partnerLimits: {},
  recurring: { family: [], mine: [] },
  partnerRecurring: {},
  partnerRecurringDaily: {},
};

/** Пока вкладка видима, данные перечитываются раз в минуту — чтобы появлялись записи партнёра */
const POLL_MS = 60_000;
const CONFLICT = "Настройки изменил другой пользователь, проверьте и повторите.";
const SAVE_FAILED = "Не удалось сохранить. Проверьте соединение и обновите страницу.";
const OFFLINE = "Нет связи — сейчас можно только записывать траты и доходы.";

async function send(url: string, method: string, body?: unknown): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) window.location.href = "/login";
  return res;
}

export function TrackerProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TrackerData>(EMPTY);
  const [status, setStatus] = useState<Ctx["status"]>("loading");
  const [offline, setOfflineState] = useState<Ctx["offline"]>(null);
  const [queued, setQueued] = useState(0);
  const [month, setMonth] = useState(curMonthKey);
  const [toastState, setToast] = useState<ToastState>(null);
  const ref = useRef(data);
  const offlineRef = useRef(offline);
  /** Очередь офлайн-записей текущего пользователя; источник правды — localStorage */
  const queue = useRef<Queued[]>([]);
  const flushing = useRef(false);
  /** Записи настроек одного документа идут по очереди: следующая берёт версию из ответа предыдущей */
  const queues = useRef<Record<string, Promise<void>>>({});
  /** Сколько запросов в полёте — пока они идут, фоновое перечитывание не затирает оптимистичные изменения */
  const pending = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback<Ctx["toast"]>((msg, actionLabel, action) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), msg, actionLabel, action });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const commit = useCallback((next: TrackerData) => {
    ref.current = next;
    setData(next);
  }, []);
  const setOffline = useCallback((o: Ctx["offline"]) => {
    offlineRef.current = o;
    setOfflineState(o);
  }, []);
  const saveQueue = useCallback((q: Queued[]) => {
    queue.current = q;
    writeQueue(ref.current.me.id, q);
    setQueued(q.length);
  }, []);

  /** Отправить очередь по одной записи. Нет сети — остановиться; сервер отказал — запись выбрасывается с тостом */
  const flush = useCallback(async () => {
    if (flushing.current || !queue.current.length) return;
    flushing.current = true;
    let sent = 0;
    try {
      while (queue.current.length) {
        const [first, ...rest] = queue.current;
        let res: Response;
        try {
          res = await send("/api/entries", "POST", { kind: first.kind, entry: first.entry });
        } catch {
          setOffline(offlineRef.current ?? { savedAt: null });
          break;
        }
        if (res.status === 401 || res.status >= 500) break;
        if (!res.ok) {
          commit(withEntry(ref.current, first.kind, first.entry, false));
          toast(`Запись без связи не сохранена: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.status}`);
        } else sent++;
        saveQueue(rest);
      }
    } finally {
      flushing.current = false;
    }
    if (sent) toast(`Отправлено записей без связи: ${sent}`);
  }, [commit, saveQueue, setOffline, toast]);

  const reload = useCallback(async (force = false) => {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as TrackerData;
      if (queue.current.length === 0 && next.me.id) {
        queue.current = readQueue(next.me.id);
        setQueued(queue.current.length);
      }
      // Пока шла загрузка, пользователь мог что-то записать — свежий ответ подождёт следующего раза
      if (force || pending.current === 0) commit(applyQueue(next, queue.current));
      setStatus("ready");
      // Ответ из офлайн-копии service worker'а
      if (res.headers.get("x-ft-offline")) setOffline({ savedAt: res.headers.get("x-ft-saved-at") });
      else {
        setOffline(null);
        void flush();
      }
    } catch {
      if (ref.current.me.id) setOffline(offlineRef.current ?? { savedAt: null });
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, [commit, flush, setOffline]);

  useEffect(() => {
    void reload();
    const onVisible = () => document.visibilityState === "visible" && void reload();
    const onOnline = () => void reload();
    const onOffline = () => setOffline(offlineRef.current ?? { savedAt: null });
    const timer = setInterval(() => document.visibilityState === "visible" && void reload(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [reload, setOffline]);

  /** Запрос с учётом pending; при ошибке — откат через reload и тост */
  const track = useCallback(async (run: () => Promise<boolean>) => {
    pending.current++;
    let ok = false;
    try {
      ok = await run();
    } catch {
      ok = false;
    } finally {
      pending.current--;
    }
    return ok;
  }, []);

  /** Без связи — только ввод: всё остальное не отправляется, чтобы не было конфликтов версий */
  const blocked = useCallback(() => {
    if (!offlineRef.current) return false;
    toast(OFFLINE);
    return true;
  }, [toast]);

  /** Документ с версией: семейные настройки, мои настройки */
  const saveVersioned = useCallback(
    (doc: "settings" | "my-settings", payload: () => { version: number; data: unknown }, setVersion: (v: number) => void) => {
      const run = (queues.current[doc] ?? Promise.resolve()).then(() =>
        track(async () => {
          const res = await send(`/api/${doc}`, "PUT", payload());
          if (res.status === 409) {
            await reload(true);
            toast(CONFLICT);
            return true;
          }
          if (!res.ok) return false;
          setVersion(((await res.json()) as { version: number }).version);
          return true;
        }).then((ok) => {
          if (!ok) {
            toast(SAVE_FAILED);
            void reload();
          }
        }),
      );
      queues.current[doc] = run;
    },
    [reload, toast, track],
  );

  const enqueue = useCallback((kind: Kind, e: Entry) => {
    saveQueue([...queue.current.filter((x) => x.entry.id !== e.id), { kind, entry: e }]);
  }, [saveQueue]);

  const value = useMemo<Ctx>(() => ({
    data,
    status,
    offline,
    queued,
    reload,
    month,
    setMonth,
    toast,
    toastState,
    dismissToast,
    addEntry: (kind, e) => {
      const local = { ...e, authorId: ref.current.me.id };
      commit(withEntry(ref.current, kind, local, true));
      if (offlineRef.current) return enqueue(kind, local);
      pending.current++;
      send("/api/entries", "POST", { kind, entry: local })
        .then((res) => {
          if (res.ok) return;
          commit(withEntry(ref.current, kind, local, false));
          toast(SAVE_FAILED);
        })
        // Сети нет — запись остаётся на экране и ждёт в очереди
        .catch(() => {
          setOffline(offlineRef.current ?? { savedAt: null });
          enqueue(kind, local);
        })
        .finally(() => pending.current--);
    },
    removeEntry: (kind, e) => {
      // Ещё не отправленная запись (отмена сразу после ввода без связи) убирается из очереди
      if (queue.current.some((x) => x.entry.id === e.id)) {
        saveQueue(queue.current.filter((x) => x.entry.id !== e.id));
        return commit(withEntry(ref.current, kind, e, false));
      }
      if (blocked()) return;
      commit(withEntry(ref.current, kind, e, false));
      const q = new URLSearchParams({ kind, scope: kind === "expense" ? (e as Expense).scope : "family", month: e.date.slice(0, 7) });
      void track(async () => {
        const res = await send(`/api/entries/${encodeURIComponent(e.id)}?${q}`, "DELETE");
        return res.ok || res.status === 404; // 404 — уже удалил партнёр
      }).then((ok) => {
        if (ok) return;
        commit(withEntry(ref.current, kind, e, true));
        toast("Не удалось удалить.");
      });
    },
    restoreEntry: (kind, e) => {
      if (blocked()) return;
      commit(withEntry(ref.current, kind, e, true));
      void track(async () => (await send("/api/entries/restore", "POST", { id: e.id })).ok).then((ok) => {
        if (ok) return;
        commit(withEntry(ref.current, kind, e, false));
        toast("Вернуть уже нельзя.");
      });
    },
    setSettings: (fn) => {
      if (blocked()) return;
      const cur = ref.current.settings;
      commit({ ...ref.current, settings: { ...fn(cur), version: cur?.version ?? 0 } });
      saveVersioned(
        "settings",
        () => {
          const { version, ...rest } = ref.current.settings!;
          return { version, data: rest };
        },
        (v) => commit({ ...ref.current, settings: { ...ref.current.settings!, version: v } }),
      );
    },
    setMySettings: (fn) => {
      if (blocked()) return;
      const cur = ref.current.mySettings;
      commit({ ...ref.current, mySettings: { ...fn(cur), version: cur.version } });
      saveVersioned(
        "my-settings",
        () => {
          const { version, ...rest } = ref.current.mySettings;
          return { version, data: rest };
        },
        (v) => commit({ ...ref.current, mySettings: { ...ref.current.mySettings, version: v } }),
      );
    },
    api: async <T,>(url: string, method: string, body?: unknown) => {
      if (blocked()) return null;
      let out: T | null = null;
      await track(async () => {
        const res = await send(url, method, body);
        const j = (await res.json().catch(() => ({}))) as T & { error?: string };
        if (res.ok) out = j;
        else toast(j.error ?? SAVE_FAILED);
        return true;
      }).then((ok) => ok || toast(SAVE_FAILED));
      // И после отказа: при 409 на экране должны оказаться свежие данные
      await reload(true);
      return out;
    },
    updateRates: (rates, ratesUpdatedAt, base) => {
      const s = ref.current.settings;
      // Без связи курсы не обновляются: ручной курс сохранится вместе с самой записью
      if (!s || (base && base !== s.base) || offlineRef.current) return;
      commit({ ...ref.current, settings: { ...s, rates: { ...s.rates, ...rates }, ...(ratesUpdatedAt ? { ratesUpdatedAt } : {}) } });
      void track(async () => {
        const res = await send("/api/settings/rates", "PATCH", { base: s.base, rates, ratesUpdatedAt });
        if (!res.ok) return false;
        const j = (await res.json()) as { rates: Settings["rates"] | null; ratesUpdatedAt: string | null; version: number };
        const cur = ref.current.settings;
        if (j.rates && cur && cur.base === s.base) {
          commit({ ...ref.current, settings: { ...cur, rates: j.rates, ratesUpdatedAt: j.ratesUpdatedAt ?? undefined, version: j.version } });
        }
        return true;
      });
    },
  }), [data, status, offline, queued, reload, month, toast, toastState, dismissToast, commit, track, saveVersioned, blocked, enqueue, saveQueue, setOffline]);

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
}
