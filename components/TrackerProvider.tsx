"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Expense, Goal, Income, Settings, TrackerData } from "@/lib/types";
import { curMonthKey, incomeKeyOf, monthKeyOf } from "@/lib/utils";

type ToastState = { id: number; msg: string; actionLabel?: string; action?: () => void } | null;

type Ctx = {
  data: TrackerData;
  status: "loading" | "ready" | "error";
  reload: () => Promise<void>;
  setSettings: (fn: (s: Settings | null) => Settings) => void;
  addExpense: (e: Expense) => void;
  removeExpense: (monthKey: string, id: string) => Expense | undefined;
  addIncome: (i: Income) => void;
  removeIncome: (monthKey: string, id: string) => Income | undefined;
  setGoals: (fn: (g: Goal[]) => Goal[]) => void;
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

const EMPTY: TrackerData = { settings: null, goals: [], months: {}, incomes: {} };

export function TrackerProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TrackerData>(EMPTY);
  const [status, setStatus] = useState<Ctx["status"]>("loading");
  const [month, setMonth] = useState(curMonthKey);
  const [toastState, setToast] = useState<ToastState>(null);
  const ref = useRef(data);
  const queues = useRef<Record<string, Promise<void>>>({});
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

  /** Запись документов идёт по одной на документ, чтобы старая версия не перезаписала новую */
  const write = useCallback((doc: string, body: unknown) => {
    const run = (queues.current[doc] ?? Promise.resolve())
      .then(async () => {
        const res = await fetch(`/api/data/${doc}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(() => toast("Не удалось сохранить. Проверьте соединение и обновите страницу."));
    queues.current[doc] = run;
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      commit((await res.json()) as TrackerData);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [commit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<Ctx>(() => ({
    data,
    status,
    reload,
    month,
    setMonth,
    toast,
    toastState,
    dismissToast,
    setSettings: (fn) => {
      const settings = fn(ref.current.settings);
      commit({ ...ref.current, settings });
      write("settings", settings);
    },
    addExpense: (e) => {
      const key = monthKeyOf(e.date);
      const expenses = [...(ref.current.months[key]?.expenses ?? []), e];
      commit({ ...ref.current, months: { ...ref.current.months, [key]: { expenses } } });
      write(key, { expenses });
    },
    removeExpense: (key, id) => {
      const prev = ref.current.months[key]?.expenses ?? [];
      const gone = prev.find((x) => x.id === id);
      if (!gone) return undefined;
      const expenses = prev.filter((x) => x.id !== id);
      commit({ ...ref.current, months: { ...ref.current.months, [key]: { expenses } } });
      write(key, { expenses });
      return gone;
    },
    addIncome: (i) => {
      const key = incomeKeyOf(i.date);
      const items = [...(ref.current.incomes[key]?.items ?? []), i];
      commit({ ...ref.current, incomes: { ...ref.current.incomes, [key]: { items } } });
      write(key, { items });
    },
    removeIncome: (key, id) => {
      const prev = ref.current.incomes[key]?.items ?? [];
      const gone = prev.find((x) => x.id === id);
      if (!gone) return undefined;
      const items = prev.filter((x) => x.id !== id);
      commit({ ...ref.current, incomes: { ...ref.current.incomes, [key]: { items } } });
      write(key, { items });
      return gone;
    },
    setGoals: (fn) => {
      const goals = fn(ref.current.goals);
      commit({ ...ref.current, goals });
      write("goals", { items: goals });
    },
  }), [data, status, reload, month, toast, toastState, dismissToast, commit, write]);

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
}
