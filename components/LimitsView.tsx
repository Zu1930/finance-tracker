"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTracker } from "./TrackerProvider";
import { CommitInput } from "./CommitInput";
import { AsciiBar } from "./AsciiBar";
import { Contribution } from "./entry/Contribution";
import { CarryOver } from "./plan/CarryOver";
import { PlanItems } from "./plan/PlanItems";
import { PlanLimits, PlanSummary } from "./plan/MonthPlan";
import { usePlan, withOverride } from "./plan/usePlan";
import { RecurringSection } from "./recurring/RecurringSection";
import { RecurringManager, openOnHash } from "./recurring/RecurringManager";
import { Hint } from "./onboarding/Hint";
import { byAuthor, fmtPct, monthIncome, monthOccurrences, savingsRate } from "@/lib/metrics";
import { MAX_AHEAD, isMonth, itemStatus, linkedByItem, monthLimit, monthsAhead, planSpentByCat } from "@/lib/plan";
import type { Category, Expense, PlanItem } from "@/lib/types";
import { activeCats, amountChars, catsIn, curMonthKey, fmt, liveCats, minus, monthName, monthTitle, numIn, parseAmount, setLimit, shiftMonth, signed, termName, todayStr, uid } from "@/lib/utils";

export function LimitsView() {
  const { month, setMonth } = useTracker();
  const cur = curMonthKey();
  const ahead = monthsAhead(cur, month);
  // /limits?month=YYYY-MM — из пуша «пора спланировать»: открыть этот месяц (не дальше 12 вперёд)
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("month");
    if (m && isMonth(m) && monthsAhead(cur, m) <= MAX_AHEAD) setMonth(m);
  }, [cur, setMonth]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <button className="tb" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>&lt;</button>
          <h1 className="min-w-[16ch] text-center text-lg font-bold uppercase">{monthTitle(month)}</h1>
          <button className="tb" aria-label="Следующий месяц" disabled={ahead >= MAX_AHEAD} onClick={() => setMonth(shiftMonth(month, 1))}>&gt;</button>
        </div>
        {/* Мобильный: метка и возврат — следующей строкой */}
        {(ahead > 0 || month !== cur) && (
          <div className="flex items-center gap-3 max-sm:w-full sm:contents">
            {ahead > 0 && <span className="border border-dashed border-line2 px-1.5 py-0.5 text-muted uppercase">План</span>}
            {month !== cur && (
              <button className="tb max-sm:ml-auto sm:ml-auto" onClick={() => setMonth(cur)}>
                {ahead > 0 ? "← " : ""}Текущий<span className="max-sm:hidden"> месяц</span>{ahead > 0 ? "" : " →"}
              </button>
            )}
          </div>
        )}
      </div>
      {ahead > 0 ? (
        <>
          <Hint id="plan" className="mt-6" />
          <PlanSummary month={month} />
          <RecurringSection month={month} future />
          <PlanItems month={month} withStatus={false} />
          <PlanLimits month={month} />
        </>
      ) : (
        <MonthLimits />
      )}
    </>
  );
}

/** Текущий и прошлые месяцы: итог, покупки по плану, шкалы категорий (без плановых трат, кроме превышения) */
function MonthLimits() {
  const { data, isSolo, month, setSettings, setMySettings } = useTracker();
  const st = data.settings!;
  const cur = curMonthKey();
  const { plan, items, savePlan, saveMyPlan } = usePlan(month);
  const family = data.familyExpenses[month] ?? [];
  const mine = data.myExpenses[month] ?? [];
  const familySpent = planSpentByCat(family, plan.items.family);
  const mySpent = planSpentByCat(mine, plan.items.mine);
  // Блоки — как было в выбранном месяце, с поправками плана на месяц; редактор — действующие категории
  const familyCats = catsIn(st.familyCategories, month, familySpent, plan.familyOverrides);
  const myCats = catsIn(data.mySettings.personalCategories, month, mySpent, plan.myOverrides);
  // Правка лимита в текущем месяце: навсегда (с этого месяца) или только на этот месяц
  const [onlyMonth, setOnlyMonth] = useState(false);
  const perMonth = onlyMonth && month === cur;

  // Итог семьи — одинаковый у обоих: личное = мои личные + сумма личных партнёра
  const income = monthIncome(data, month);
  const familyTotal = family.reduce((a, e) => a + e.base, 0);
  const personalTotal = mine.reduce((a, e) => a + e.base, 0) + (data.partnerPersonalTotals[month] ?? 0);
  const expense = familyTotal + personalTotal;
  const rest = income - expense;
    const myLeft = myCats.reduce((a, c) => a + c.limit - (mySpent[c.id] ?? 0), 0);
  // Регулярные по категориям: факт оплаченных или оценка — для строки под шкалой
  const occ = monthOccurrences(data, month, todayStr());
  const byCat = (list: typeof occ.family) => list.reduce<Record<string, number>>((a, o) => ({ ...a, [o.categoryId]: (a[o.categoryId] ?? 0) + (o.paidBase ?? o.estimateBase ?? 0) }), {});
  const recurringByCat = { family: byCat(occ.family), mine: byCat(occ.mine) };

  return (
    <>
      {month === cur && !data.readonly && <CarryOver />}
      <section className="mt-6 border-t border-dashed border-line pt-5">
        <h2 className="sec">Итог</h2>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 uppercase sm:grid-cols-[12ch_minmax(0,1fr)] sm:gap-y-1">
          <dt className="text-muted">Доход</dt>
          <dd className="max-sm:text-right">
            <b>{signed(income)} {st.base}</b>
            <span className="text-muted max-sm:hidden"> // </span>
            <span className="max-sm:block max-sm:text-xs"><Contribution sums={byAuthor(data.incomes[month] ?? [])} sign="+" /></span>
          </dd>
          <dt className="text-muted">Расход</dt>
          <dd className="max-sm:text-right">
            <b>{minus(expense)} {st.base}</b>
            {!isSolo && !data.readonly && <span className="text-muted max-sm:block max-sm:text-xs"><span className="max-sm:hidden"> // </span>семья {fmt(familyTotal)} · личное {fmt(personalTotal)}</span>}
          </dd>
          <dt className="text-muted">Остаток</dt>
          <dd className="max-sm:text-right">
            <b className={rest < 0 ? "text-bad" : ""}>{signed(rest)} {st.base}</b>
            <span className="max-sm:block max-sm:text-xs"><span className="text-muted"><span className="max-sm:hidden"> //</span> сбережения </span>
            {fmtPct(savingsRate(income, expense))}</span>
          </dd>
        </dl>
      </section>

      {month === cur && !data.readonly && <PlanSummary month={month} />}
      {!data.readonly && data.recurring.family.length + data.recurring.mine.length > 0 && <Hint id="recurring" className="mt-6" />}
      <RecurringSection month={month} future={false} />
      {!data.readonly && <Hint id="limits" className="mt-6" />}
      {items.length > 0 && <PlanItems month={month} withStatus form={false} />}

      {!isSolo && (
        <section className="mt-6 border-t border-dashed border-line pt-5">
          <h2 className="sec">Семья</h2>
          <LimitBlocks cats={familyCats} spent={familySpent} contribution={family} planned={plan.items.family} recurring={recurringByCat.family} />
        </section>
      )}

      {/* В solo — единственный список: заголовок «Лимиты» вместо «Семья» / «Личное» */}
      <section className="mt-6 border-t border-dashed border-line pt-5">
        <h2 className="sec">
          {isSolo ? "Лимиты" : "Личное"} // <span className={myLeft < 0 ? "text-bad" : ""}>осталось {fmt(myLeft)}</span>
        </h2>
        {myCats.length === 0 ? (
          <p className="mt-3 text-muted uppercase">Нет категорий — добавьте ниже</p>
        ) : (
          <LimitBlocks cats={myCats} spent={mySpent} planned={plan.items.mine} recurring={recurringByCat.mine} />
        )}
      </section>

      {!data.readonly && (<>
      <details id="categories" ref={openOnHash} className="group mt-4 border-t border-dashed border-line">
        <summary className="sec flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
          Категории и лимиты<span aria-hidden="true" className="group-open:hidden">[+]</span><span aria-hidden="true" className="hidden group-open:inline">[−]</span>
        </summary>
        <div className="max-w-3xl pt-3 pb-2">
          {month === cur && (
            <div className="tgroup mb-4" role="group" aria-label="Изменения лимитов">
              <button className="tb" aria-pressed={!onlyMonth} onClick={() => setOnlyMonth(false)}>Всегда</button>
              <button className="tb" aria-pressed={onlyMonth} onClick={() => setOnlyMonth(true)}>Только {monthName(cur)}</button>
            </div>
          )}
          {!isSolo && (
            <>
              <h3 className="lbl">Семья, {st.base}</h3>
              <CategoryEditor
                cats={activeCats(st)}
                month={perMonth ? { overrides: plan.familyOverrides, save: (o) => void savePlan({ limitOverrides: o }) } : undefined}
                update={(fn) => setSettings((s) => ({ ...s!, familyCategories: fn(s!.familyCategories) }))}
              />
            </>
          )}
          <h3 className={`lbl ${isSolo ? "" : "mt-8"}`}>{isSolo ? "Категории" : "Личное"}, {st.base}</h3>
          <CategoryEditor
            cats={liveCats(data.mySettings.personalCategories)}
            month={perMonth ? { overrides: plan.myOverrides, save: (o) => void saveMyPlan(o) } : undefined}
            update={(fn) => setMySettings((s) => ({ ...s, personalCategories: fn(s.personalCategories) }))}
          />
          <p className="mt-6 text-muted uppercase">// {perMonth ? `Изменения — только на ${monthName(cur)}` : "Изменения действуют с текущего месяца, прошлые не меняются"}</p>
          <p className="mt-2 text-muted uppercase">
            Валюты, основная валюта и данные →{" "}
            <Link href="/settings/currency" className="tb">Настройки</Link>
          </p>
        </div>
      </details>
      <RecurringManager />
      </>)}
    </>
  );
}

/** Блоки лимитов в 2 колонки; для семейных — строка вклада по именам; под шкалой — покупки по плану в категории */
function LimitBlocks({ cats, spent, contribution, planned, recurring }: {
  cats: Category[]; spent: Record<string, number>; contribution?: Expense[]; planned: PlanItem[];
  /** Регулярные месяца по категориям: в шкалу не входят, строкой под ней */
  recurring: Record<string, number>;
}) {
  const { data, month } = useTracker();
  const base = data.settings!.base;
  const linked = linkedByItem([...(data.familyExpenses[month] ?? []), ...(data.myExpenses[month] ?? [])], planned);
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
            {recurring[c.id] > 0 && <p className="mt-1 text-muted2 uppercase">↻ Регулярные {fmt(Math.round(recurring[c.id]))} — отдельно</p>}
            {planned.filter((it) => it.categoryId === c.id).map((it) => {
              const status = itemStatus(it, linked[it.id] ?? 0);
              return (
                <p key={it.id} className="mt-1 text-muted2 uppercase">
                  План: {termName(it.name)} {minus(it.amount)}{status === "done" ? " ✓" : status === "partial" ? ` ~ ${fmt(linked[it.id])}` : ""}
                </p>
              );
            })}
            {contribution && (
              <p className="mt-1">
                <span className="max-sm:text-xs"><Contribution sums={byAuthor(contribution, (e) => e.catId === c.id)} /></span>
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Названия, лимиты, удаление и добавление категорий одного списка.
 * month — режим «только текущий месяц»: поле лимита пишет поправку плана, а не сам лимит
 */
function CategoryEditor({ cats, update, month }: {
  cats: Category[];
  update: (fn: (all: Category[]) => Category[]) => void;
  month?: { overrides: Record<string, number>; save: (o: Record<string, number>) => void };
}) {
  const cur = curMonthKey();
  const { toast } = useTracker();
  const [newCat, setNewCat] = useState("");
  const patch = (id: string, p: (c: Category) => Category) => update((all) => all.map((c) => (c.id === id ? p(c) : c)));
  const add = () => {
    const name = newCat.trim();
    if (!name) return;
    update((all) => [...all, { id: uid(), name: name.slice(0, 40), limit: 0, since: curMonthKey() }]);
    setNewCat("");
  };

  return (
    <>
      {cats.map((c) => (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_12ch_auto] items-end gap-4" key={c.id}>
          <CommitInput className="tfield w-full" aria-label="Название категории" value={c.name}
            onCommit={(v) => { const n = v.trim(); if (!n) return false; patch(c.id, (x) => ({ ...x, name: n.slice(0, 40) })); }} />
          <CommitInput className="tfield w-full text-right" aria-label={`Лимит, ${c.name}`} inputMode="decimal" sanitize={amountChars}
            value={numIn(month ? monthLimit(c, cur, month.overrides) : c.limit)}
            onCommit={(v) => {
              const n = parseAmount(v);
              if (n === null || !(n >= 0)) { toast("Лимит должен быть числом."); return false; }
              if (month) return void month.save(withOverride(month.overrides, c.id, n === monthLimit(c, cur) ? null : n));
              patch(c.id, (x) => setLimit(x, n, cur));
            }} />
          <button className="xb" aria-label={`Удалить категорию ${c.name}`} onClick={() => {
            patch(c.id, (x) => ({ ...x, archived: true, archivedFrom: curMonthKey() }));
            toast(`Категория ${termName(c.name)} удалена`, "Вернуть", () => patch(c.id, ({ archivedFrom: _, ...x }) => ({ ...x, archived: false })));
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
