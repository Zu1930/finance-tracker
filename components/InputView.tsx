"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTracker } from "./TrackerProvider";
import { MONTHS, activeCats, curMonthKey, fmt, monthKeyOf, parseAmount, spentByCat, todayStr, uid } from "@/lib/utils";

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
    const col = left < 0 ? "var(--bad)" : p >= 80 ? "var(--warn)" : "var(--ok)";
    side = (
      <>
        <h3>{sel.name}</h3>
        <div className="big" style={{ color: left < 0 ? "var(--bad)" : undefined }}>
          {left < 0 ? "−" : ""}{fmt(Math.abs(left))} <small>{st.base}</small>
        </div>
        <div className="hint" style={{ margin: 0 }}>{left < 0 ? "перерасход" : "осталось"} в {monthName}е</div>
        <div className="meter"><i style={{ width: `${p}%`, background: col }} /></div>
        <div className="hint">Потрачено {fmt(s)} из {fmt(sel.limit)}</div>
      </>
    );
  } else {
    const totalL = cats.reduce((acc, c) => acc + c.limit, 0);
    const totalS = cats.reduce((acc, c) => acc + (spent[c.id] ?? 0), 0);
    side = (
      <>
        <h3>{MONTHS[new Date().getMonth()]}</h3>
        <div className="big">{fmt(totalL - totalS)} <small>{st.base}</small></div>
        <div className="hint" style={{ margin: 0 }}>осталось по всем лимитам</div>
        <div className="meter"><i style={{ width: `${totalL ? Math.min(100, (totalS / totalL) * 100) : 0}%`, background: "var(--ok)" }} /></div>
        <div className="hint">Выберите категорию, чтобы увидеть её остаток.</div>
      </>
    );
  }

  return (
    <>
      <div className="entry">
        <section className="panel">
          <div className="amount-row">
            <input
              ref={amountRef}
              className="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label="Сумма"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={onEnter}
            />
            <div className="seg" role="group" aria-label="Валюта">
              {st.currencies.map((c) => (
                <button key={c} aria-pressed={c === currency} onClick={() => setCur(c)}>{c}</button>
              ))}
            </div>
          </div>
          {isForeign && (
            <div className="rate-row">
              <label htmlFor="rate">Курс: 1 {currency} =</label>
              <input id="rate" className="input" inputMode="decimal" autoComplete="off" placeholder="курс"
                value={rate} onChange={(e) => setRate(e.target.value)} onKeyDown={onEnter} />
              <span>{st.base}</span>
              <output>{conv}</output>
            </div>
          )}
          <div className="hint">Можно складывать: 450+120. Enter — записать.</div>

          <span className="field-label">Категория · Alt + цифра</span>
          <div className="cats">
            {cats.map((c, i) => (
              <button key={c.id} className="cat" aria-pressed={c.id === catId}
                onClick={() => { setCatId(catId === c.id ? null : c.id); setError(""); amountRef.current?.focus(); }}>
                {i < 9 && <kbd>{i + 1}</kbd>}
                <span>{c.name}</span>
              </button>
            ))}
          </div>

          <div className="row">
            <input className="input note" placeholder="Комментарий, необязательно" autoComplete="off"
              value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onEnter} />
            <input className="input" type="date" aria-label="Дата" value={date}
              onChange={(e) => setDate(e.target.value)} onKeyDown={onEnter} />
            <button className="btn" onClick={submit}>Записать</button>
          </div>
          <div className="error" role="alert">{error}</div>
        </section>
        <aside className="panel side" aria-live="polite">{side}</aside>
      </div>

      <section className="recent">
        <h2>Траты за {monthName}</h2>
        <div className="list">
          {recent.length === 0 && (
            <div className="empty">В этом месяце трат пока нет. Введите сумму сверху и выберите категорию.</div>
          )}
          {recent.map((e) => (
            <div className="item" key={e.id}>
              <span className="d">{e.date.slice(8)}.{e.date.slice(5, 7)}</span>
              <span className="n">{catName(e.catId)}{e.note && <small>{e.note}</small>}</span>
              <span className="a">
                {fmt(e.amount)} {e.currency}
                {e.currency !== st.base && <small>{fmt(e.base)} {st.base}</small>}
              </span>
              <button className="x" aria-label="Удалить трату" onClick={() => remove(monthKeyOf(e.date), e.id)}>×</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
