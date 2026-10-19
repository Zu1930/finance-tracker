"use client";

import { useState } from "react";
import Link from "next/link";
import { useTracker } from "./TrackerProvider";
import { CommitInput } from "./CommitInput";
import { AsciiBar } from "./AsciiBar";
import { Contribution } from "./entry/Contribution";
import { byAuthor, fmtPct, monthIncome, savingsRate } from "@/lib/metrics";
import type { Category, Expense } from "@/lib/types";
import { activeCats, amountChars, curMonthKey, fmt, liveCats, monthTitle, parseAmount, shiftMonth, spentByCat, termName, uid } from "@/lib/utils";

const signed = (n: number) => `${n < 0 ? "−" : "+"}${fmt(Math.abs(n))}`;

export function LimitsView() {
  const { data, month, setMonth, setSettings, setMySettings } = useTracker();
  const st = data.settings!;
  const familyCats = activeCats(st);
  const myCats = liveCats(data.mySettings.personalCategories);
  const family = data.familyExpenses[month] ?? [];
  const mine = data.myExpenses[month] ?? [];
  const familySpent = spentByCat(family);
  const mySpent = spentByCat(mine);

  // Итог семьи — одинаковый у обоих: личное = мои личные + сумма личных партнёра
  const income = monthIncome(data, month);
  const familyTotal = family.reduce((a, e) => a + e.base, 0);
  const personalTotal = mine.reduce((a, e) => a + e.base, 0) + (data.partnerPersonalTotals[month] ?? 0);
  const expense = familyTotal + personalTotal;
  const rest = income - expense;
  const myLeft = myCats.reduce((a, c) => a + c.limit - (mySpent[c.id] ?? 0), 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <button className="tb" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>&lt;</button>
          <h1 className="min-w-[16ch] text-center text-lg font-bold uppercase">{monthTitle(month)}</h1>
          <button className="tb" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>&gt;</button>
        </div>
        {month !== curMonthKey() && (
          <button className="tb" onClick={() => setMonth(curMonthKey())}>Текущий месяц</button>
        )}
      </div>

      <section className="mt-6 border-t border-dashed border-line pt-5">
        <h2 className="sec">Итог</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 uppercase sm:grid-cols-[12ch_minmax(0,1fr)] sm:gap-y-1">
          <dt className="text-muted max-sm:mt-2">Доход</dt>
          <dd>
            <b>{signed(income)} {st.base}</b>
            <span className="text-muted"> // </span>
            <Contribution sums={byAuthor(data.incomes[month] ?? [])} sign="+" />
          </dd>
          <dt className="text-muted max-sm:mt-2">Расход</dt>
          <dd>
            <b>−{fmt(expense)} {st.base}</b>
            <span className="text-muted"> // семья {fmt(familyTotal)} · личное {fmt(personalTotal)}</span>
          </dd>
          <dt className="text-muted max-sm:mt-2">Остаток</dt>
          <dd>
            <b className={rest < 0 ? "text-bad" : ""}>{signed(rest)} {st.base}</b>
            <span className="text-muted"> // сбережения </span>
            {fmtPct(savingsRate(income, expense))}
          </dd>
        </dl>
      </section>

      <section className="mt-6 border-t border-dashed border-line pt-5">
        <h2 className="sec">Семья</h2>
        <LimitBlocks cats={familyCats} spent={familySpent} contribution={family} />
      </section>

      <section className="mt-6 border-t border-dashed border-line pt-5">
        <h2 className="sec">
          Личное // <span className={myLeft < 0 ? "text-bad" : ""}>осталось {fmt(myLeft)}</span>
        </h2>
        {myCats.length === 0 ? (
          <p className="mt-3 text-muted uppercase">Нет категорий — добавьте ниже</p>
        ) : (
          <LimitBlocks cats={myCats} spent={mySpent} />
        )}
      </section>

      <details className="group mt-4 border-t border-dashed border-line">
        <summary className="sec flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
          Категории и лимиты<span aria-hidden="true" className="group-open:hidden">[+]</span><span aria-hidden="true" className="hidden group-open:inline">[−]</span>
        </summary>
        <div className="max-w-3xl pt-3 pb-2">
          <h3 className="lbl">Семья, {st.base}</h3>
          <CategoryEditor
            cats={familyCats}
            update={(fn) => setSettings((s) => ({ ...s!, familyCategories: fn(s!.familyCategories) }))}
          />
          <h3 className="lbl mt-8">Личное, {st.base}</h3>
          <CategoryEditor
            cats={myCats}
            update={(fn) => setMySettings((s) => ({ ...s, personalCategories: fn(s.personalCategories) }))}
          />
          <p className="mt-6 text-muted uppercase">
            Валюты, основная валюта и данные →{" "}
            <Link href="/settings" className="tb">Настройки</Link>
          </p>
        </div>
      </details>
    </>
  );
}

/** Блоки лимитов в 2 колонки; для семейных — строка вклада по именам */
function LimitBlocks({ cats, spent, contribution }: { cats: Category[]; spent: Record<string, number>; contribution?: Expense[] }) {
  const { data } = useTracker();
  const base = data.settings!.base;
  return (
    <div className="mt-2 grid grid-cols-1 gap-x-12 sm:grid-cols-2">
      {cats.map((c) => {
        const s = spent[c.id] ?? 0;
        const left = c.limit - s;
        return (
          <section key={c.id} className="border-b border-dashed border-line2 py-4">
            <h3 className="font-bold uppercase">{termName(c.name)}</h3>
            <div className="mt-2"><AsciiBar value={s} max={c.limit} label={c.name} /></div>
            <p className={`mt-1 uppercase ${left < 0 ? "text-bad" : "text-muted"}`}>
              {left < 0 ? `Перерасход ${fmt(-left)} ${base}` : `Осталось ${fmt(left)} из ${fmt(c.limit)} ${base}`}
            </p>
            {contribution && (
              <p className="mt-1">
                <Contribution sums={byAuthor(contribution, (e) => e.catId === c.id)} />
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Названия, лимиты, удаление и добавление категорий одного списка */
function CategoryEditor({ cats, update }: { cats: Category[]; update: (fn: (all: Category[]) => Category[]) => void }) {
  const { toast } = useTracker();
  const [newCat, setNewCat] = useState("");
  const patch = (id: string, p: Partial<Category>) => update((all) => all.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const add = () => {
    const name = newCat.trim();
    if (!name) return;
    update((all) => [...all, { id: uid(), name: name.slice(0, 40), limit: 0 }]);
    setNewCat("");
  };

  return (
    <>
      {cats.map((c) => (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_12ch_auto] items-end gap-4" key={c.id}>
          <CommitInput className="tfield w-full" aria-label="Название категории" value={c.name}
            onCommit={(v) => { const n = v.trim(); if (!n) return false; patch(c.id, { name: n.slice(0, 40) }); }} />
          <CommitInput className="tfield w-full text-right" aria-label={`Лимит, ${c.name}`} inputMode="decimal" sanitize={amountChars} value={String(c.limit)}
            onCommit={(v) => {
              const n = parseAmount(v);
              if (n === null || !(n >= 0)) { toast("Лимит должен быть числом."); return false; }
              patch(c.id, { limit: n });
            }} />
          <button className="xb" aria-label={`Удалить категорию ${c.name}`} onClick={() => {
            patch(c.id, { archived: true });
            toast(`Категория ${termName(c.name)} удалена`, "Вернуть", () => patch(c.id, { archived: false }));
          }}>×</button>
        </div>
      ))}
      <div className="mt-4 flex items-end gap-4">
        <input className="tfield flex-1" placeholder="новая категория" aria-label="Новая категория" value={newCat}
          onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="tb" onClick={add}>Добавить</button>
      </div>
    </>
  );
}
