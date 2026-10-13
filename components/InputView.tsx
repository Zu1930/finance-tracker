"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTracker } from "./TrackerProvider";
import { MONTHS, activeCats, curMonthKey, fmt, monthKeyOf, amountChars, parseAmount, spentByCat, todayStr, uid } from "@/lib/utils";

const CUR_KEY = "ft:cur";

export function InputView() {
  const { data, setSettings, addExpense, removeExpense, toast } = useTracker();
  const st = data.settings!;
  const cats = activeCats(st);

  const [cur, setCurState] = useState(st.base);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayStr);
  const [catId, setCatId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  // Последняя выбранная валюта запоминается в браузере
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CUR_KEY);
      if (saved && st.currencies.includes(saved)) setCurState(saved);
    } catch {}
    amountRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currency = st.currencies.includes(cur) ? cur : st.base;
  const isForeign = currency !== st.base;

  const setCur = (c: string) => {
    setCurState(c);
    setRate(c === st.base ? "" : String(st.rates[c] ?? ""));
    try { localStorage.setItem(CUR_KEY, c); } catch {}
  };

  // Подставить последний курс, когда валюта выбрана из localStorage
  useEffect(() => {
    if (isForeign && rate === "") setRate(String(st.rates[currency] ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  // Alt + 1..9 — выбрать категорию
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !/^Digit[1-9]$/.test(e.code)) return;
      const c = cats[Number(e.code.slice(5)) - 1];
      if (c) {
        e.preventDefault();
        setCatId(c.id);
        setError("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cats]);

  const key = curMonthKey();
  const monthName = MONTHS[new Date().getMonth()].toLowerCase();
  const expenses = data.months[key]?.expenses ?? [];
  const spent = useMemo(() => spentByCat(expenses), [expenses]);
  const recent = useMemo(
    () => [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts).slice(0, 20),
    [expenses],
  );
  const catName = (id: string) => st.categories.find((c) => c.id === id)?.name ?? "Удалённая категория";

  const a = parseAmount(amount);
  const r = parseAmount(rate);
  const conv = isForeign && a && a > 0 && r && r > 0 ? `≈ ${fmt(a * r)} ${st.base}` : "";

  const submit = () => {
    if (a === null) return setError("Введите сумму.");
    if (!(a > 0)) return setError("Сумма должна быть числом больше нуля.");
    const cat = cats.find((c) => c.id === catId);
    if (!cat) return setError("Выберите категорию.");
    const usedRate = isForeign ? r : 1;
    if (!(usedRate && usedRate > 0)) return setError(`Укажите курс ${currency} к ${st.base}.`);

    if (isForeign && st.rates[currency] !== usedRate) {
      setSettings((s) => ({ ...s!, rates: { ...s!.rates, [currency]: usedRate } }));
    }
    const e = {
      id: uid(), amount: a, currency, rate: usedRate, base: Math.round(a * usedRate * 100) / 100,
      catId: cat.id, note: note.trim().slice(0, 140), date: date || todayStr(), ts: Date.now(),
    };
    addExpense(e);
    setAmount("");
    setNote("");
    setCatId(null);
    setError("");
    amountRef.current?.focus();
    toast(`Записано: ${fmt(a)} ${currency} в «${cat.name}»`, "Отменить", () => removeExpense(monthKeyOf(e.date), e.id));
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const remove = (mKey: string, id: string) => {
    const gone = removeExpense(mKey, id);
    if (gone) toast("Трата удалена", "Вернуть", () => addExpense(gone));
  };

  const sel = cats.find((c) => c.id === catId);
  let side: React.ReactNode;
  if (sel) {
    const s = spent[sel.id] ?? 0, left = sel.limit - s, p = sel.limit ? Math.min(100, (s / sel.limit) * 100) : 100;
    const col = left < 0 ? "bg-bad" : p >= 80 ? "bg-warn" : "bg-ok";
    side = (
      <>
        <h3 className="text-sm font-semibold sm:mb-1 sm:text-[15px]">{sel.name}</h3>
        <div className={`text-2xl font-semibold tracking-tight sm:text-[28px] ${left < 0 ? "text-bad" : ""}`}>
          {left < 0 ? "−" : ""}{fmt(Math.abs(left))} <small className="text-[15px] font-normal text-muted">{st.base}</small>
        </div>
        <div className="hint">{left < 0 ? "перерасход" : "осталось"} в {monthName}е</div>
        <div className="mt-2 mb-1.5 h-2 overflow-hidden sm:mt-3 sm:mb-2 rounded-full bg-bg"><i className={`block h-full rounded-full transition-[width] duration-500 ${col}`} style={{ width: `${p}%` }} /></div>
        <div className="hint">Потрачено {fmt(s)} из {fmt(sel.limit)}</div>
      </>
    );
  } else {
    const totalL = cats.reduce((acc, c) => acc + c.limit, 0);
    const totalS = cats.reduce((acc, c) => acc + (spent[c.id] ?? 0), 0);
    side = (
      <>
        <h3 className="text-sm font-semibold sm:mb-1 sm:text-[15px]">{MONTHS[new Date().getMonth()]}</h3>
        <div className="text-2xl font-semibold tracking-tight sm:text-[28px]">{fmt(totalL - totalS)} <small className="text-[15px] font-normal text-muted">{st.base}</small></div>
        <div className="hint">осталось по всем лимитам</div>
        <div className="mt-2 mb-1.5 h-2 overflow-hidden sm:mt-3 sm:mb-2 rounded-full bg-bg"><i className="block h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${totalL ? Math.min(100, (totalS / totalL) * 100) : 0}%` }} /></div>
        <div className="hint max-sm:hidden">Выберите категорию, чтобы увидеть её остаток.</div>
      </>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-3 sm:gap-7 md:grid-cols-[minmax(0,1fr)_300px]">
        <section className="panel">
          <div className="flex items-stretch gap-3">
            <input
              ref={amountRef}
              className="min-w-0 flex-1 rounded-none border-0 border-b-2 border-line bg-transparent pt-1 pb-1.5 text-[34px] font-semibold tracking-tight transition-colors placeholder:text-line focus:border-accent focus:outline-none md:text-[44px]"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label="Сумма"
              value={amount}
              onChange={(e) => setAmount(amountChars(e.target.value))}
              onKeyDown={onEnter}
            />
            <div className="seg" role="group" aria-label="Валюта">
              {st.currencies.map((c) => (
                <button key={c} aria-pressed={c === currency} onClick={() => setCur(c)}>{c}</button>
              ))}
            </div>
          </div>
          {isForeign && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[15px] text-muted">
              <label htmlFor="rate">Курс: 1 {currency} =</label>
              <input id="rate" className="input w-[120px] text-ink" inputMode="decimal" autoComplete="off" placeholder="курс"
                value={rate} onChange={(e) => setRate(amountChars(e.target.value))} onKeyDown={onEnter} />
              <span>{st.base}</span>
              <output className="ml-1.5 font-medium text-ink">{conv}</output>
            </div>
          )}
          <div className="hint mt-2 pointer-coarse:hidden">Можно складывать: 450+120. Enter — записать.</div>

          <span className="mt-4 mb-2 block text-sm text-muted sm:mt-6">Категория<span className="pointer-coarse:hidden"> · Alt + цифра</span></span>
          <div className="flex flex-wrap gap-1.5 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-2">
            {cats.map((c, i) => (
              <button key={c.id} aria-pressed={c.id === catId}
                className="group flex max-w-full items-center gap-2.5 rounded-full border border-line bg-bg px-3.5 py-2 text-left text-[15px] transition sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-base hover:border-muted/50 active:scale-[.98] aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper"
                onClick={() => { setCatId(catId === c.id ? null : c.id); setError(""); amountRef.current?.focus(); }}>
                {i < 9 && <kbd className="min-w-5 pointer-coarse:hidden rounded-md border border-line px-1 text-center text-xs text-muted group-aria-pressed:border-paper/40 group-aria-pressed:text-paper">{i + 1}</kbd>}
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 sm:mt-6 sm:gap-3">
            <input className="input min-w-0 basis-full sm:basis-auto sm:min-w-[180px] sm:flex-1" placeholder="Комментарий, необязательно" autoComplete="off"
              value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onEnter} />
            <input className="input min-w-0 flex-1 sm:flex-none" type="date" aria-label="Дата" value={date}
              onChange={(e) => setDate(e.target.value)} onKeyDown={onEnter} />
            <button className="btn flex-1 sm:flex-none" onClick={submit}>Записать</button>
          </div>
          <div className="mt-2 text-sm text-bad empty:mt-0 sm:mt-3 sm:min-h-5" role="alert">{error}</div>
        </section>
        <aside className="panel md:sticky md:top-6" aria-live="polite">{side}</aside>
      </div>

      <section className="mt-6 sm:mt-12">
        <h2 className="mb-2 text-base font-semibold sm:mb-4">Траты за {monthName}</h2>
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper shadow-card">
          {recent.length === 0 && (
            <div className="px-4 py-5 text-muted sm:px-5">В этом месяце трат пока нет. Введите сумму сверху и выберите категорию.</div>
          )}
          {recent.map((e) => (
            <div className="grid grid-cols-[44px_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2.5 sm:grid-cols-[70px_minmax(0,1fr)_auto_auto] sm:gap-3 sm:px-5 transition-colors hover:bg-bg/60" key={e.id}>
              <span className="text-sm text-muted">{e.date.slice(8)}.{e.date.slice(5, 7)}</span>
              <span className="min-w-0"><span className="block truncate sm:inline">{catName(e.catId)}</span>{e.note && <small className="block truncate text-sm text-muted sm:ml-2 sm:inline">{e.note}</small>}</span>
              <span className="text-right font-semibold">
                {fmt(e.amount)} {e.currency}
                {e.currency !== st.base && <small className="block text-xs font-normal text-muted">{fmt(e.base)} {st.base}</small>}
              </span>
              <button className="x-btn" aria-label="Удалить трату" onClick={() => remove(monthKeyOf(e.date), e.id)}>×</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
