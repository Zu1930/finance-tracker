"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import type { Goal } from "@/lib/types";
import { amountChars, fmt, parseAmount, todayStr, uid } from "@/lib/utils";

const saved = (g: Goal) => g.ops.reduce((a, o) => a + o.amount, 0);

function GoalCard({ g }: { g: Goal }) {
  const { data, setGoals, toast } = useTracker();
  const base = data.settings!.base;
  const [val, setVal] = useState("");
  const s = saved(g);
  const p = g.target ? (s / g.target) * 100 : 0;
  const left = g.target - s;
  const last = g.ops[g.ops.length - 1];

  const move = (sign: 1 | -1) => {
    const v = parseAmount(val);
    if (!v || !(v > 0)) return toast("Введите сумму больше нуля.");
    if (sign < 0 && v > s) return toast(`В копилке только ${fmt(s)} ${base}.`);
    const op = { id: uid(), amount: sign * v, date: todayStr(), ts: Date.now() };
    setGoals((gs) => gs.map((x) => (x.id === g.id ? { ...x, ops: [...x.ops, op] } : x)));
    setVal("");
    toast(`${sign > 0 ? "Положено" : "Взято"} ${fmt(v)} ${base} · «${g.name}»`, "Отменить", () =>
      setGoals((gs) => gs.map((x) => (x.id === g.id ? { ...x, ops: x.ops.filter((o) => o.id !== op.id) } : x))),
    );
  };

  const remove = () => {
    let idx = -1;
    setGoals((gs) => { idx = gs.findIndex((x) => x.id === g.id); return gs.filter((x) => x.id !== g.id); });
    toast(`Копилка «${g.name}» удалена`, "Вернуть", () =>
      setGoals((gs) => { const next = [...gs]; next.splice(Math.max(0, idx), 0, g); return next; }),
    );
  };

  return (
    <article className="card min-h-[240px]">
      <div className={`fill -z-10 ${p >= 100 ? "bg-okt border-ok" : "bg-acct border-accent"}`} style={{ height: `${Math.max(0, Math.min(100, p))}%` }} />
      <button className="x-btn absolute top-4 right-4" aria-label="Удалить копилку" onClick={remove}>×</button>
      <h3 className="pr-20 text-[17px] font-semibold">{g.name}</h3>
      <span className="absolute top-6 right-14 text-sm font-medium text-muted">{Math.round(p)}%</span>
      <div className="mt-auto text-3xl leading-tight font-bold tracking-tight">{fmt(s)} <small className="text-sm font-medium tracking-normal text-muted">{base}</small></div>
      <div className="mt-2 text-sm text-muted">
        {left > 0 ? `осталось ${fmt(left)} из ${fmt(g.target)}` : `цель ${fmt(g.target)} собрана`}
        {last && ` · ${last.amount > 0 ? "+" : "−"}${fmt(Math.abs(last.amount))} ${last.date.slice(8)}.${last.date.slice(5, 7)}`}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <input className="input min-w-0 basis-full bg-paper" inputMode="decimal" placeholder="Сумма" aria-label={`Сумма для ${g.name}`}
          value={val} onChange={(e) => setVal(amountChars(e.target.value))} onKeyDown={(e) => e.key === "Enter" && move(1)} />
        <button className="btn flex-1 px-3" onClick={() => move(1)}>Положить</button>
        <button className="btn-ghost flex-1 bg-paper px-3" onClick={() => move(-1)}>Взять</button>
      </div>
    </article>
  );
}

export function GoalsView() {
  const { data, setGoals, toast } = useTracker();
  const base = data.settings!.base;
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const total = data.goals.reduce((a, g) => a + saved(g), 0);

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
      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <h1 className="m-0 text-3xl font-bold tracking-tight">Копилки</h1>
        <div className="ml-auto text-muted">Отложено всего <b className="font-semibold text-ink">{fmt(total)} {base}</b></div>
      </div>
      {data.goals.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">{data.goals.map((g) => <GoalCard key={g.id} g={g} />)}</div>
      ) : (
        <div className="panel text-muted">Копилок пока нет. Назовите цель и сумму, которую хотите собрать.</div>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <input className="input min-w-[160px] flex-1" placeholder="На что копим, например «Отпуск»" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <input className="input min-w-0 flex-[0_1_180px]" inputMode="decimal" placeholder={`Цель, ${base}`}
          value={target} onChange={(e) => setTarget(amountChars(e.target.value))} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" onClick={add}>Создать копилку</button>
      </div>
    </>
  );
}
