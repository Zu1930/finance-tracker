"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import { AsciiBar } from "./AsciiBar";
import { runwayMonths } from "@/lib/metrics";
import type { Goal } from "@/lib/types";
import { amountChars, fmt, parseAmount, termName, todayStr, uid } from "@/lib/utils";

const saved = (g: Goal) => g.ops.reduce((a, o) => a + o.amount, 0);

function GoalCard({ g }: { g: Goal }) {
  const { data, setGoals, toast } = useTracker();
  const base = data.settings!.base;
  const [val, setVal] = useState("");
  const s = saved(g);
  const last = g.ops[g.ops.length - 1];

  const move = (sign: 1 | -1) => {
    const v = parseAmount(val);
    if (!v || !(v > 0)) return toast("Введите сумму больше нуля.");
    if (sign < 0 && v > s) return toast(`В копилке только ${fmt(s)} ${base}.`);
    const op = { id: uid(), amount: sign * v, date: todayStr(), ts: Date.now() };
    setGoals((gs) => gs.map((x) => (x.id === g.id ? { ...x, ops: [...x.ops, op] } : x)));
    setVal("");
    toast(`${sign > 0 ? "Положено" : "Взято"} ${fmt(v)} ${base} → ${termName(g.name)}`, "Отменить", () =>
      setGoals((gs) => gs.map((x) => (x.id === g.id ? { ...x, ops: x.ops.filter((o) => o.id !== op.id) } : x))),
    );
  };

  const remove = () => {
    let idx = -1;
    setGoals((gs) => { idx = gs.findIndex((x) => x.id === g.id); return gs.filter((x) => x.id !== g.id); });
    toast(`Копилка ${termName(g.name)} удалена`, "Вернуть", () =>
      setGoals((gs) => { const next = [...gs]; next.splice(Math.max(0, idx), 0, g); return next; }),
    );
  };

  return (
    <section className="border-t border-dashed border-line py-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="sec pt-3">{termName(g.name)}</h2>
        <button className="xb -mr-2" aria-label={`Удалить копилку ${g.name}`} onClick={remove}>×</button>
      </div>
      <div className="mt-1"><AsciiBar value={s} max={g.target} variant="goal" label={g.name} /></div>
      <p className="mt-2 text-muted uppercase">Собрано {fmt(s)} из {fmt(g.target)} {base}</p>
      {last && (
        <p className="text-muted2">
          // {last.amount > 0 ? "+" : "−"}{fmt(Math.abs(last.amount))} · {last.date.slice(8)}.{last.date.slice(5, 7)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
        <input className="tfield min-w-[10ch] flex-1" inputMode="decimal" placeholder="сумма" aria-label={`Сумма для ${g.name}`}
          value={val} onChange={(e) => setVal(amountChars(e.target.value))} onKeyDown={(e) => e.key === "Enter" && move(1)} />
        <div className="flex gap-2">
          <button className="tb" onClick={() => move(1)}>+ Положить</button>
          <button className="tb" onClick={() => move(-1)}>− Взять</button>
        </div>
      </div>
    </section>
  );
}

export function GoalsView() {
  const { data, setGoals, toast } = useTracker();
  const base = data.settings!.base;
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const total = data.goals.reduce((a, g) => a + saved(g), 0);
  const runway = runwayMonths(data, todayStr());

  const add = () => {
    const n = name.trim();
    const t = parseAmount(target);
    if (!n) return;
    if (!t || !(t > 0)) return toast("Укажите сумму цели.");
    setGoals((gs) => [...gs, { id: uid(), name: n.slice(0, 40), target: t, ops: [] }]);
    setName("");
    setTarget("");
  };

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h1 className="sec">Goals</h1>
        <p className="flex flex-wrap gap-x-4 text-muted uppercase sm:ml-auto">
          <span>Отложено всего <b className="text-ink">{fmt(total)} {base}</b></span>
          {/* Запас прочности: на сколько месяцев среднего расхода хватит накоплений */}
          <span>
            [ Запас:{" "}
            {runway === null ? "—" : <b className={runway < 1 ? "text-warn" : "text-ink"}>{fmt(runway)} мес расходов</b>} ]
          </span>
        </p>
      </div>
      {data.goals.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-x-12 sm:grid-cols-2">{data.goals.map((g) => <GoalCard key={g.id} g={g} />)}</div>
      ) : (
        <p className="mt-6 border-t border-dashed border-line pt-5 text-muted uppercase">// Копилок пока нет. Назовите цель и сумму, которую хотите собрать</p>
      )}

      <section className="mt-4 border-t border-dashed border-line pt-6">
        <h2 className="sec">New goal</h2>
        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="flex min-w-[240px] flex-[2_1_240px] items-center gap-3">
            <label htmlFor="goal-name" className="lbl">Name</label>
            <input id="goal-name" className="tfield flex-1" placeholder="например, отпуск" value={name}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          </div>
          <div className="flex min-w-[200px] flex-[1_1_200px] items-center gap-3">
            <label htmlFor="goal-target" className="lbl">Target</label>
            <input id="goal-target" className="tfield flex-1" inputMode="decimal" placeholder={base}
              value={target} onChange={(e) => setTarget(amountChars(e.target.value))} onKeyDown={(e) => e.key === "Enter" && add()} />
          </div>
          <button className="tb" onClick={add}>Создать</button>
        </div>
      </section>
    </>
  );
}
