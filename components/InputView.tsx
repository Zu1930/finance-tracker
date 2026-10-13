"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTracker } from "./TrackerProvider";
import { AsciiBar } from "./AsciiBar";
import { MONTHS, activeCats, curMonthKey, fmt, monthKeyOf, amountChars, parseAmount, spentByCat, termName, todayStr, uid } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (ts: number) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

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
  const catName = (id: string) => termName(st.categories.find((c) => c.id === id)?.name ?? "Удалённая категория");

  const a = parseAmount(amount);
  const r = parseAmount(rate);
  const conv = isForeign && a && a > 0 && r && r > 0 ? `// ≈ ${fmt(a * r)} ${st.base}` : "";

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
    toast(`Записано: ${fmt(a)} ${currency} → ${termName(cat.name)}`, "Отменить", () => removeExpense(monthKeyOf(e.date), e.id));
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
  const limit = sel ? sel.limit : cats.reduce((acc, c) => acc + c.limit, 0);
  const used = sel ? spent[sel.id] ?? 0 : cats.reduce((acc, c) => acc + (spent[c.id] ?? 0), 0);
  const left = limit - used;

  return (
    <>
      <h1 className="sec">New entry</h1>
      <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_280px] items-baseline gap-4">
        <label htmlFor="amount" className="lbl shrink-0 text-xl font-bold text-ink sm:text-[28px]">Amount</label>
        <input
          id="amount"
          ref={amountRef}
          className="tfield min-h-0 w-0 flex-1 border-b-2 border-ink pt-0 pb-1 text-[34px] leading-none font-bold sm:text-[44px]"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(amountChars(e.target.value))}
          onKeyDown={onEnter}
        />
        </div>
        <div className="flex gap-2" role="group" aria-label="Валюта">
          {st.currencies.map((c) => (
            <button key={c} className="tb tb-tight" aria-pressed={c === currency} onClick={() => setCur(c)}>{c}</button>
          ))}
        </div>
      </div>
      {isForeign && (
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor="rate" className="lbl">Rate: 1 {currency} =</label>
          <input id="rate" className="tfield w-[12ch]" inputMode="decimal" autoComplete="off" placeholder="курс"
            value={rate} onChange={(e) => setRate(amountChars(e.target.value))} onKeyDown={onEnter} />
          <span className="text-muted">{st.base}</span>
          <output className="text-ink">{conv}</output>
        </div>
      )}
      <p className="mt-2 text-muted2 pointer-coarse:hidden">// МОЖНО СКЛАДЫВАТЬ: 450+120</p>

      <h2 className="sec mt-8">Category <span className="font-normal text-muted2">(Alt + 1..9)</span></h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cats.map((c, i) => (
          <button key={c.id} aria-pressed={c.id === catId}
            className="tbox min-h-11 gap-2 px-2 py-2 text-left sm:px-3"
            onClick={() => { setCatId(catId === c.id ? null : c.id); setError(""); amountRef.current?.focus(); }}>
            {i < 9 && <span aria-hidden="true" className="shrink-0">[{i + 1}]</span>}<span className="min-w-0 [overflow-wrap:anywhere]">{termName(c.name)}</span>
          </button>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex min-w-[240px] flex-[2_1_240px] items-center gap-3">
          <label htmlFor="note" className="lbl">Note</label>
          <input id="note" className="tfield flex-1" placeholder="необязательно" autoComplete="off"
            value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onEnter} />
        </div>
        <div className="flex flex-[1_1_200px] items-center gap-3">
          <label htmlFor="date" className="lbl">Date</label>
          <input id="date" className="tfield flex-1" type="date" value={date}
            onChange={(e) => setDate(e.target.value)} onKeyDown={onEnter} />
        </div>
        <button className="tb w-full font-bold sm:w-auto" onClick={submit}>Enter ↵ Записать</button>
      </div>
      <p className="mt-3 min-h-5 text-bad uppercase" role="alert">{error && `!! ${error.replace(/\.$/, "")}`}</p>

      <section className="mt-6 border-t border-dashed border-line pt-6" aria-live="polite">
        <h2 className="sec">{sel ? termName(sel.name) : "Все лимиты"}</h2>
        <div className="mt-3"><AsciiBar value={used} max={limit} label={sel ? sel.name : "Все лимиты"} /></div>
        <p className={`mt-2 uppercase ${left < 0 ? "text-bad" : "text-muted"}`}>
          {left < 0 ? `Перерасход ${fmt(-left)} ${st.base}` : `Осталось ${fmt(left)} из ${fmt(limit)} ${st.base}`}
        </p>
      </section>

      <section className="mt-10">
        <h2 className="sec">Recent logs</h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-muted uppercase">// За {monthName} записей пока нет</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <ul className="grid min-w-max grid-cols-[repeat(4,auto)_minmax(16ch,1fr)_auto_auto] gap-x-4">
              {recent.map((e) => (
                <li key={e.id} className="col-span-7 grid grid-cols-subgrid items-center border-b border-dashed border-line2 py-1 whitespace-nowrap">
                  <span className="text-muted">{e.date}</span>
                  <span className="text-muted">{timeOf(e.ts)}</span>
                  <span className="text-muted">[EXP]</span>
                  <span className="text-right font-bold">
                    -{fmt(e.amount)}
                    {e.currency !== st.base && <span className="ml-2 font-normal text-muted">(≈ {fmt(e.base)} {st.base})</span>}
                  </span>
                  <span className="min-w-0 truncate">// {catName(e.catId)}{e.note && <span className="ml-2 text-muted">{e.note}</span>}</span>
                  <span className="text-muted">[{e.currency}]</span>
                  <button className="xb" aria-label="Удалить трату"
                    onClick={() => remove(monthKeyOf(e.date), e.id)}>×</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
