"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Expense, Goal, Income, Settings, TrackerData, UserSettings } from "@/lib/types";
import { curMonthKey } from "@/lib/utils";

type ToastState = { id: number; msg: string; actionLabel?: string; action?: () => void } | null;
export type Kind = "expense" | "income";
type Entry = Expense | Income;

type Ctx = {
  data: TrackerData;
  status: "loading" | "ready" | "error";
  /** force — применить ответ, даже если идут другие запросы (после 409) */
  reload: (force?: boolean) => Promise<void>;
  /** Новая запись. authorId выставит сервер; локально — текущий пользователь */
  addEntry: (kind: Kind, e: Entry) => void;
  /** Удаление; запись на сервере 10 минут лежит в корзине — restoreEntry вернёт её с исходным автором */
  removeEntry: (kind: Kind, e: Entry) => void;
  restoreEntry: (kind: Kind, e: Entry) => void;
  setSettings: (fn: (s: Settings | null) => Omit<Settings, "version">) => void;
  setMySettings: (fn: (s: UserSettings) => Omit<UserSettings, "version">) => void;
  setGoals: (fn: (g: Goal[]) => Goal[]) => void;
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
  goals: [],
  goalsVersion: 0,
  familyExpenses: {},
  myExpenses: {},
  incomes: {},
  partnerPersonalTotals: {},
  partnerPersonalDaily: {},
};

/** Пока вкладка видима, данные перечитываются раз в минуту — чтобы появлялись записи партнёра */
const POLL_MS = 60_000;
const CONFLICT = "Настройки изменил другой пользователь, проверьте и повторите.";
const SAVE_FAILED = "Не удалось сохранить. Проверьте соединение и обновите страницу.";

/** В какую группу ответа GET /api/data попадает запись */
const bucketOf = (kind: Kind, e: Entry): "incomes" | "familyExpenses" | "myExpenses" =>
  kind === "income" ? "incomes" : (e as Expense).scope === "personal" ? "myExpenses" : "familyExpenses";

function withEntry(d: TrackerData, kind: Kind, e: Entry, add: boolean): TrackerData {
  const bucket = bucketOf(kind, e);
  const m = e.date.slice(0, 7);
  const list = (d[bucket][m] ?? []) as Entry[];
  const next = add ? [...list.filter((x) => x.id !== e.id), e] : list.filter((x) => x.id !== e.id);
  return { ...d, [bucket]: { ...d[bucket], [m]: next } };
}

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
  const [month, setMonth] = useState(curMonthKey);
  const [toastState, setToast] = useState<ToastState>(null);
  const ref = useRef(data);
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

  const reload = useCallback(async (force = false) => {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as TrackerData;
      // Пока шла загрузка, пользователь мог что-то записать — свежий ответ подождёт следующего раза
      if (force || pending.current === 0) commit(next);
      setStatus("ready");
    } catch {
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, [commit]);

  useEffect(() => {
    void reload();
    const onVisible = () => document.visibilityState === "visible" && void reload();
    const timer = setInterval(() => document.visibilityState === "visible" && void reload(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

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

  /** Документ с версией: семейные настройки, мои настройки, копилки */
  const saveVersioned = useCallback(
    (doc: "settings" | "my-settings" | "goals", payload: () => { version: number; data: unknown }, setVersion: (v: number) => void) => {
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

  const value = useMemo<Ctx>(() => ({
    data,
    status,
    reload,
    month,
    setMonth,
    toast,
    toastState,
    dismissToast,
    addEntry: (kind, e) => {
      const local = { ...e, authorId: ref.current.me.id };
      commit(withEntry(ref.current, kind, local, true));
      void track(async () => (await send("/api/entries", "POST", { kind, entry: local })).ok).then((ok) => {
        if (ok) return;
        commit(withEntry(ref.current, kind, local, false));
        toast(SAVE_FAILED);
      });
    },
    removeEntry: (kind, e) => {
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
      commit(withEntry(ref.current, kind, e, true));
      void track(async () => (await send("/api/entries/restore", "POST", { id: e.id })).ok).then((ok) => {
        if (ok) return;
        commit(withEntry(ref.current, kind, e, false));
        toast("Вернуть уже нельзя.");
      });
    },
    setSettings: (fn) => {
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
    setGoals: (fn) => {
      commit({ ...ref.current, goals: fn(ref.current.goals) });
      saveVersioned(
        "goals",
        () => ({ version: ref.current.goalsVersion, data: ref.current.goals }),
        (v) => commit({ ...ref.current, goalsVersion: v }),
      );
    },
    updateRates: (rates, ratesUpdatedAt, base) => {
      const s = ref.current.settings;
      if (!s || (base && base !== s.base)) return;
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
  }), [data, status, reload, month, toast, toastState, dismissToast, commit, track, saveVersioned]);

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
}
