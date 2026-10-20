"use client";

import { useState } from "react";
import { useTracker } from "../TrackerProvider";
import { AsciiBar } from "../AsciiBar";
import { toBase } from "@/lib/savings";
import type { Goal, Scope } from "@/lib/types";
import { amountChars, ddmm, fmt, parseAmount, termName, todayStr } from "@/lib/utils";

/** Копилки: распределение общей суммы. allocated и free — в базе, сама копилка — в своей валюте */
export function Goals({ allocated, free, missing, empty }: { allocated: number; free: number; missing: string[]; empty: boolean }) {
  const { data } = useTracker();
  const base = data.settings!.base;
  const goals = [...data.savings.goals.family, ...data.savings.goals.mine];
  // Счетов ещё нет и копилок нет — распределять нечего
  if (empty && goals.length === 0)
    return (
      <section className="mt-8 border-t border-dashed border-line pt-5">
        <h2 className="sec">Копилки</h2>
        <p className="mt-3 text-muted uppercase">Появятся после первой сверки</p>
      </section>
    );
  return (
    <section className="mt-8 border-t border-dashed border-line pt-5">
      <h2 className="sec">
        Копилки // распределено {fmt(Math.round(allocated))} {base} //{" "}
        {empty ? (
          <span>заведите счета и сделайте сверку</span>
        ) : free < 0 ? (
          <span className="text-bad">!! Распределено больше, чем есть: −{fmt(Math.round(-free))} {base}</span>
        ) : (
          <span>свободно {fmt(Math.round(free))} {base}</span>
        )}
      </h2>
      {missing.length > 0 && <p className="mt-1 text-muted2 uppercase">// Без курса, не входят в распределено: {missing.join(", ")}</p>}
      {goals.length > 0 ? (
        <div className="mt-2 grid grid-cols-1 gap-x-12 sm:grid-cols-2">{goals.map((g) => <GoalCard key={g.id} g={g} />)}</div>
      ) : (
        <p className="mt-4 text-muted uppercase">// Копилок пока нет. Назовите цель и сумму ниже</p>
      )}
      <NewGoal />
    </section>
  );
}

function GoalCard({ g }: { g: Goal }) {
  const { data, api, toast } = useTracker();
  const st = data.settings!;
  const [val, setVal] = useState("");
  const inBase = g.currency === st.base ? null : toBase(g.allocated, g.currency, st.base, st.rates);
  const last = g.ops.at(-1);
  const opUrl = `/api/goals/${g.id}/ops`;

  const move = async (sign: 1 | -1) => {
    const v = parseAmount(val);
    if (!v || !(v > 0)) return toast("Введите сумму больше нуля.");
    if (sign < 0 && v > g.allocated) return toast(`В копилке только ${fmt(g.allocated)} ${g.currency}.`);
    const res = await api(opUrl, "POST", { scope: g.scope, amount: sign * v, date: todayStr() });
    if (!res) return;
    setVal("");
    toast(`${sign > 0 ? "Выделено" : "Возвращено"} ${fmt(v)} ${g.currency} → ${termName(g.name)}`, "Отменить", () =>
      void api(opUrl, "POST", { scope: g.scope, amount: -sign * v, date: todayStr() }),
    );
  };

  const remove = async () => {
    if (g.allocated !== 0) return toast("Сначала верните деньги.");
    if (!(await api(`/api/goals/${g.id}?scope=${g.scope}`, "DELETE"))) return;
    toast(`Копилка ${termName(g.name)} удалена`, "Вернуть", () =>
      void api("/api/goals", "POST", { name: g.name, target: g.target, currency: g.currency, scope: g.scope }),
    );
  };

  return (
    <section className="border-b border-dashed border-line2 py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="pt-3 font-bold uppercase">
          {termName(g.name)} <span className="font-normal text-muted">[{g.scope === "family" ? "СЕМ" : "ЛИЧН"}]</span>
        </h3>
        <button className="xb -mr-2" aria-label={`Удалить копилку ${g.name}`} onClick={() => void remove()}>×</button>
      </div>
      <div className="mt-1"><AsciiBar value={g.allocated} max={g.target} variant="goal" label={g.name} /></div>
      <p className="mt-2 text-muted uppercase">
        Отведено {fmt(g.allocated)} из {fmt(g.target)} {g.currency}
        {g.currency !== st.base && <span className="text-muted2"> // {inBase === null ? "КУРС?" : `≈ ${fmt(Math.round(inBase))} ${st.base}`}</span>}
      </p>
      {last && <p className="text-muted2">// {last.amount > 0 ? "+" : "−"}{fmt(Math.abs(last.amount))} · {ddmm(last.date)}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
        <input className="tfield min-w-[10ch] flex-1 max-sm:basis-full" inputMode="decimal" placeholder="сумма" aria-label={`Сумма для ${g.name}`}
          value={val} onChange={(e) => setVal(amountChars(e.target.value))} onKeyDown={(e) => e.key === "Enter" && void move(1)} />
        <div className="tgroup max-sm:w-full">
          <button className="tb max-sm:h-11" onClick={() => void move(1)}>+ Выделить</button>
          <button className="tb max-sm:h-11" onClick={() => void move(-1)}>− Вернуть</button>
        </div>
      </div>
    </section>
  );
}

function NewGoal() {
  const { data, api, toast } = useTracker();
  const st = data.settings!;
  const [scope, setScope] = useState<Scope>("family");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [cur, setCur] = useState(st.base);
  const currency = st.currencies.includes(cur) ? cur : st.base;

  const add = async () => {
    const n = name.trim();
    const t = parseAmount(target);
    if (!n) return;
    if (!t || !(t > 0)) return toast("Укажите сумму цели.");
    if (!(await api("/api/goals", "POST", { name: n, target: t, currency, scope }))) return;
    setName("");
    setTarget("");
  };

  return (
    <section className="mt-6">
      <h2 className="sec">New goal</h2>
      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="tgroup max-sm:w-full" role="group" aria-label="Чья копилка">
          <button className="tb" aria-pressed={scope === "family"} onClick={() => setScope("family")}>Семья</button>
          <button className="tb" aria-pressed={scope === "personal"} onClick={() => setScope("personal")}>Личное</button>
        </div>
        <div className="flex min-w-[220px] flex-[2_1_220px] items-center gap-3">
          <label htmlFor="goal-name" className="lbl">Name</label>
          <input id="goal-name" className="tfield flex-1" placeholder="например, отпуск" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        </div>
        <div className="flex min-w-[180px] flex-[1_1_180px] items-center gap-3">
          <label htmlFor="goal-target" className="lbl">Target</label>
          <input id="goal-target" className="tfield flex-1" inputMode="decimal" placeholder={currency} value={target}
            onChange={(e) => setTarget(amountChars(e.target.value))} onKeyDown={(e) => e.key === "Enter" && void add()} />
        </div>
        <div className="tgroup max-sm:w-full" role="group" aria-label="Валюта копилки">
          {st.currencies.map((c) => (
            <button key={c} className="tb tb-tight" aria-pressed={currency === c} onClick={() => setCur(c)}>{c}</button>
          ))}
        </div>
        <button className="tb max-sm:h-12 max-sm:w-full" onClick={() => void add()}>Создать</button>
      </div>
    </section>
  );
}
