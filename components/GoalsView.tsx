"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import type { Goal } from "@/lib/types";
import { fmt, parseAmount, todayStr, uid } from "@/lib/utils";

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
    <article className={`card goal ${p >= 100 ? "done" : ""}`}>
      <div className="fill" style={{ height: `${Math.max(0, Math.min(100, p))}%` }} />
      <button className="x del" aria-label="Удалить копилку" onClick={remove}>×</button>
      <h3>{g.name}</h3>
      <span className="pct">{Math.round(p)}%</span>
      <div className="left">{fmt(s)} <small>{base}</small></div>
      <div className="of">
        {left > 0 ? `осталось ${fmt(left)} из ${fmt(g.target)}` : `цель ${fmt(g.target)} собрана`}
        {last && ` · ${last.amount > 0 ? "+" : "−"}${fmt(Math.abs(last.amount))} ${last.date.slice(8)}.${last.date.slice(5, 7)}`}
      </div>
      <div className="goal-act">
        <input className="input" inputMode="decimal" placeholder="Сумма" aria-label={`Сумма для ${g.name}`}
          value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && move(1)} />
        <button className="btn" onClick={() => move(1)}>Положить</button>
        <button className="btn ghost" onClick={() => move(-1)}>Взять</button>
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
      <div className="limits-head">
        <h1 className="page-title">Копилки</h1>
        <div className="total">Отложено всего <b>{fmt(total)} {base}</b></div>
      </div>
      {data.goals.length > 0 ? (
        <div className="grid">{data.goals.map((g) => <GoalCard key={g.id} g={g} />)}</div>
      ) : (
        <div className="panel empty">Копилок пока нет. Назовите цель и сумму, которую хотите собрать.</div>
      )}
      <div className="newgoal">
        <input className="input" placeholder="На что копим, например «Отпуск»" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <input className="input" inputMode="decimal" placeholder={`Цель, ${base}`} style={{ flex: "0 1 180px" }}
          value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" onClick={add}>Создать копилку</button>
      </div>
    </>
  );
}
