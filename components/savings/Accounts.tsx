"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useTracker } from "../TrackerProvider";
import { gapStatus, toBase, totals } from "@/lib/savings";
import type { Account, ReconView, Scope } from "@/lib/types";
import { amountChars, ddmm, fmt, localDay, parseAmount, signed, todayStr } from "@/lib/utils";

const STALE_DAYS = 14;

/** Счета семьи и мои, режим сверки, блок расхождения по последнему снимку */
export function Accounts({ openFamily = false }: { openFamily?: boolean }) {
  const { data, isSolo, api, toast } = useTracker();
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
          <span className="text-muted">{items.length === 0 ? "—" : <>{items.some((a) => a.currency !== st.base) && "≈ "}{fmt(t.all)} {st.base}</>}</span>
        </div>
        <ul>
          {items.map((a) => {
            const i = idx++;
            const inBase = a.currency === st.base ? null : toBase(a.balance, a.currency, st.base, st.rates);
            const day = localDay(a.updatedAt);
            return (
              // Мобильный: имя | остаток, ниже 12px «≈ X · обновлён 01.10»; в сверке поле — на всю ширину под именем
              <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-dashed border-line2 py-1 uppercase sm:flex sm:min-h-11 sm:flex-wrap">
                <span className={`min-w-[12ch] truncate sm:flex-1 ${editing ? "max-sm:col-span-2 max-sm:pt-2" : ""}`}>{a.name}</span>
                {editing ? (
                  <label className="flex items-center gap-2 max-sm:col-span-2">
                    <input ref={(el) => { inputs.current[i] = el; }} className="tfield text-right max-sm:flex-1 sm:w-[14ch]" inputMode="decimal"
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
                        <span className="text-muted2 max-sm:hidden"> {inBase === null ? "КУРС?" : `≈ ${fmt(Math.round(inBase))}`}</span>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted sm:hidden">
                      {a.currency !== st.base && `${inBase === null ? "КУРС?" : `≈ ${fmt(Math.round(inBase))}`} · `}
                      Обновлён {day === todayStr() ? "сегодня" : ddmm(day)}
                    </span>
                    <span className="w-[9ch] text-right text-muted max-sm:hidden">{day === todayStr() ? "Сегодня" : ddmm(day)}</span>
                    <button className="xb -mr-2 justify-self-end" aria-label={`Убрать счёт ${a.name}`} onClick={() => void archive(a)}>×</button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {!editing && <NewAccount key={scope === (isSolo ? "personal" : "family") ? String(openFamily) : scope} scope={scope} defaultOpen={scope === (isSolo ? "personal" : "family") && openFamily} />}
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
      {!isSolo && group("family", "Семья", family)}
      {group("personal", isSolo ? "Мои счета" : "Личное", mine)}
      {editing && (
        <div className="tgroup mt-4">
          <button className="tb max-sm:h-12" onClick={() => setEditing(false)}>Отмена</button>
          <button id="recon-save" className="tb font-bold max-sm:h-12" onClick={() => void save()}>Сохранить</button>
        </div>
      )}
      <ReconBlock recons={sv.recons} base={st.base} />
      {data.partner && sv.partner.lastUpdatedAt && Date.now() - Date.parse(sv.partner.lastUpdatedAt) > STALE_DAYS * 864e5 && (
        <p className="mt-2 text-muted2 uppercase">
          Счета {data.partner?.name} обновлены {ddmm(localDay(sv.partner.lastUpdatedAt))} — расхождение может быть неточным
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
    <div className="mt-5 space-y-2 border-y border-dashed border-line2 py-2 uppercase sm:space-y-1 sm:border-x sm:px-3">
      {!r || !status || !prev || r.expected === null ? (
        <p className="text-muted">{r ? `Сверка ${ddmm(r.day)} — точка отсчёта. Следующая покажет расхождение` : "Первая сверка — точка отсчёта"}</p>
      ) : (
        <>
          <p>
            <span className="text-muted max-sm:block max-sm:text-xs">С {ddmm(prev.day)} ожидалось </span><b>{signed(r.expected)}</b>
            <span className="text-muted max-sm:block max-sm:text-xs"><span className="max-sm:hidden"> // </span>доходы {fmt(r.income ?? 0)} − расходы {fmt(r.expense ?? 0)}</span>
          </p>
          <p><span className="text-muted max-sm:block max-sm:text-xs">Факт </span><b>{signed(r.fact ?? 0)}</b></p>
          <p className={status.warn ? "text-warn" : ""}>
            <span className={`max-sm:block max-sm:text-xs ${status.warn ? "" : "text-muted"}`}>Неучтено </span>
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
function NewAccount({ scope, defaultOpen = false }: { scope: Scope; defaultOpen?: boolean }) {
  const { data, api, toast } = useTracker();
  const st = data.settings!;
  const [open, setOpen] = useState(defaultOpen);
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
      <div className="tgroup max-sm:w-full" role="group" aria-label="Валюта счёта">
        {st.currencies.map((c) => (
          <button key={c} className="tb tb-tight" aria-pressed={cur === c} onClick={() => setCur(c)}>{c}</button>
        ))}
      </div>
      <div className="flex min-w-[160px] flex-[1_1_160px] items-center gap-3">
        <label htmlFor={`${id}-bal`} className="lbl">Balance</label>
        <input id={`${id}-bal`} className="tfield flex-1 text-right" inputMode="decimal" placeholder="0" value={bal}
          onChange={(e) => setBal(amountChars(e.target.value))} onKeyDown={(e) => e.key === "Enter" && void add()} />
      </div>
      <div className="tgroup max-sm:w-full">
        <button className="tb" onClick={() => setOpen(false)}>Отмена</button>
        <button className="tb font-bold" onClick={() => void add()}>Добавить</button>
      </div>
    </div>
  );
}
