"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useTracker } from "../TrackerProvider";
import { gapStatus, toBase, totals } from "@/lib/savings";
import type { Account, ReconView, Scope } from "@/lib/types";
import { amountChars, ddmm, fmt, localDay, parseAmount, signed, todayStr } from "@/lib/utils";

const STALE_DAYS = 14;

/** Счета семьи и мои, режим сверки, блок расхождения по последнему снимку */
export function Accounts() {
  const { data, api, toast } = useTracker();
  const st = data.settings!;
  const sv = data.savings;
  const family = sv.accounts.family.filter((a) => !a.archived);
  const mine = sv.accounts.mine.filter((a) => !a.archived);
  const list = [...family, ...mine];
  const last = sv.recons.at(-1);
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const start = () => {
    setVals(Object.fromEntries(list.map((a) => [a.id, String(a.balance)])));
    setTouched(new Set());
    setEditing(true);
    requestAnimationFrame(() => inputs.current[0]?.focus());
  };

  // Только изменённые и подтверждённые (Enter) поля: нетронутые счета сохраняют дату обновления
  const save = async () => {
    const balances: Record<string, number> = {}, versions: Record<string, number> = {};
    for (const a of list) {
      if (!touched.has(a.id)) continue;
      const v = parseAmount(vals[a.id] ?? "");
      if (v === null || Number.isNaN(v)) return toast(`Остаток ${a.name}: введите число.`);
      balances[a.id] = v;
      versions[a.id] = a.version;
    }
    const res = await api("/api/reconcile", "POST", { balances, versions, day: todayStr() });
    if (!res) return;
    setEditing(false);
    toast("Сверка сохранена");
  };

  const onKey = (e: KeyboardEvent, i: number, id: string) => {
    if (e.key !== "Enter") return;
    setTouched((t) => new Set(t).add(id));
    if (i + 1 < list.length) inputs.current[i + 1]?.focus();
    // Подтверждение последнего поля попадёт в состояние к следующему рендеру — сохраняем после него
    else setTimeout(() => document.getElementById("recon-save")?.click());
  };

  const archive = async (a: Account) => {
    if (a.balance !== 0) return toast("Сначала обнулите остаток сверкой.");
    const res = await api<{ item: Account }>(`/api/accounts/${a.id}`, "PATCH", { scope: a.scope, version: a.version, archived: true });
    if (res) toast(`Счёт ${a.name} убран`, "Вернуть", () => void api(`/api/accounts/${a.id}`, "PATCH", { scope: a.scope, version: res.item.version, archived: false }));
  };

  let idx = 0;
  const group = (scope: Scope, title: string, items: Account[]) => {
    const t = totals(items, st.base, st.rates);
    return (
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line pb-1">
          <h3 className="lbl">{title}</h3>
          <span className="text-muted">{items.some((a) => a.currency !== st.base) && "≈ "}{fmt(t.all)} {st.base}</span>
        </div>
        <ul>
          {items.map((a) => {
            const i = idx++;
            const inBase = a.currency === st.base ? null : toBase(a.balance, a.currency, st.base, st.rates);
            const day = localDay(a.updatedAt);
            return (
              <li key={a.id} className="flex min-h-11 flex-wrap items-center gap-x-4 border-b border-dashed border-line2 py-1 uppercase">
                <span className="min-w-[12ch] flex-1 truncate">{a.name}</span>
                {editing ? (
                  <label className="flex items-center gap-2">
                    <input ref={(el) => { inputs.current[i] = el; }} className="tfield w-[14ch] text-right" inputMode="decimal"
                      aria-label={`Остаток, ${a.name}`} value={vals[a.id] ?? ""}
                      onChange={(e) => { setVals((v) => ({ ...v, [a.id]: amountChars(e.target.value) })); setTouched((s) => new Set(s).add(a.id)); }}
                      onKeyDown={(e) => onKey(e, i, a.id)} />
                    <span className="text-muted">{a.currency}</span>
                  </label>
                ) : (
                  <>
                    <span className="text-right">
                      <b>{fmt(a.balance)} {a.currency}</b>
                      {a.currency !== st.base && (
                        <span className="text-muted2"> {inBase === null ? "КУРС?" : `≈ ${fmt(Math.round(inBase))}`}</span>
                      )}
                    </span>
                    <span className="w-[9ch] text-right text-muted">{day === todayStr() ? "Сегодня" : ddmm(day)}</span>
                    <button className="xb -mr-2" aria-label={`Убрать счёт ${a.name}`} onClick={() => void archive(a)}>×</button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {!editing && <NewAccount scope={scope} />}
      </div>
    );
  };

  return (
    <section className="mt-8 border-t border-dashed border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="sec">
          Счета // {last ? `последняя сверка ${ddmm(last.day)}` : "сверок ещё не было"}
        </h2>
        {!editing && list.length > 0 && <button className="tb" onClick={start}>Сверка</button>}
      </div>
      {editing && <p className="mt-2 text-muted2">// Впишите остатки. Enter — к следующему счёту, на последнем — сохранить</p>}
      {group("family", "Семья", family)}
      {group("personal", "Личное", mine)}
      {editing && (
        <div className="mt-4 flex gap-2">
          <button className="tb" onClick={() => setEditing(false)}>Отмена</button>
          <button id="recon-save" className="tb font-bold" onClick={() => void save()}>Сохранить</button>
        </div>
      )}
      <ReconBlock recons={sv.recons} base={st.base} />
      {sv.partner.lastUpdatedAt && Date.now() - Date.parse(sv.partner.lastUpdatedAt) > STALE_DAYS * 864e5 && (
        <p className="mt-2 text-muted2 uppercase">
          Счета {data.partner.name} обновлены {ddmm(localDay(sv.partner.lastUpdatedAt))} — расхождение может быть неточным
        </p>
      )}
    </section>
  );
}

/** Ожидалось / факт / неучтено по последнему снимку; без снимков — точка отсчёта */
function ReconBlock({ recons, base }: { recons: ReconView[]; base: string }) {
  const r = recons.at(-1);
  const prev = recons.at(-2);
  const status = r && gapStatus(r);
  return (
    <div className="mt-5 space-y-1 border border-dashed border-line2 px-3 py-2 uppercase">
      {!r || !status || !prev || r.expected === null ? (
        <p className="text-muted">{r ? `Сверка ${ddmm(r.day)} — точка отсчёта. Следующая покажет расхождение` : "Первая сверка — точка отсчёта"}</p>
      ) : (
        <>
          <p>
            <span className="text-muted">С {ddmm(prev.day)} ожидалось </span><b>{signed(r.expected)}</b>
            <span className="text-muted"> // доходы {fmt(r.income ?? 0)} − расходы {fmt(r.expense ?? 0)}</span>
          </p>
          <p><span className="text-muted">Факт </span><b>{signed(r.fact ?? 0)}</b></p>
          <p className={status.warn ? "text-warn" : ""}>
            <span className={status.warn ? "" : "text-muted"}>Неучтено </span>
            {status.kind === "ok" && <b>≈ 0 — всё сходится</b>}
            {status.kind === "expense" && <><b>{fmt(r.gap!)} {base}</b> — возможно, не все траты записаны</>}
            {status.kind === "income" && <><b>+{fmt(-r.gap!)} {base}</b> — возможно, не все доходы записаны</>}
          </p>
        </>
      )}
    </div>
  );
}

/** [ + СЧЁТ ] → инлайн-форма: имя, валюта, остаток */
function NewAccount({ scope }: { scope: Scope }) {
  const { data, api, toast } = useTracker();
  const st = data.settings!;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cur, setCur] = useState(st.base);
  const [bal, setBal] = useState("");
  const id = `acc-${scope}`;

  const add = async () => {
    const n = name.trim();
    const b = bal.trim() ? parseAmount(bal) : 0;
    if (!n) return toast("Назовите счёт.");
    if (b === null || Number.isNaN(b)) return toast("Остаток должен быть числом.");
    const res = await api("/api/accounts", "POST", { name: n, currency: st.currencies.includes(cur) ? cur : st.base, scope, balance: b });
    if (!res) return;
    setName("");
    setBal("");
    setOpen(false);
  };

  if (!open) return <button className="tb mt-3" onClick={() => setOpen(true)}>+ Счёт</button>;
  return (
    <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="flex min-w-[200px] flex-[2_1_200px] items-center gap-3">
        <label htmlFor={`${id}-name`} className="lbl">Name</label>
        <input id={`${id}-name`} autoFocus className="tfield flex-1" placeholder="например, наличные" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
      </div>
      <div className="flex gap-2" role="group" aria-label="Валюта счёта">
        {st.currencies.map((c) => (
          <button key={c} className="tb tb-tight" aria-pressed={cur === c} onClick={() => setCur(c)}>{c}</button>
        ))}
      </div>
      <div className="flex min-w-[160px] flex-[1_1_160px] items-center gap-3">
        <label htmlFor={`${id}-bal`} className="lbl">Balance</label>
        <input id={`${id}-bal`} className="tfield flex-1 text-right" inputMode="decimal" placeholder="0" value={bal}
          onChange={(e) => setBal(amountChars(e.target.value))} onKeyDown={(e) => e.key === "Enter" && void add()} />
      </div>
      <div className="flex gap-2">
        <button className="tb" onClick={() => setOpen(false)}>Отмена</button>
        <button className="tb font-bold" onClick={() => void add()}>Добавить</button>
      </div>
    </div>
  );
}
