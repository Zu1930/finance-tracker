"use client";

import { useState } from "react";
import { useTracker } from "../TrackerProvider";
import { downloadJson } from "../ImportExport";
import { rebaseData, type LimitRounding } from "@/lib/rebase";
import { monthExpense } from "@/lib/metrics";
import type { TrackerData } from "@/lib/types";
import { activeCats, liveCats, amountChars, curMonthKey, fmt, fmtRate, parseAmount, termName, todayStr } from "@/lib/utils";

const ROUNDINGS: LimitRounding[] = [0, 1, 10, 100];
const defaultRounding = (cur: string): LimitRounding => (cur === "EUR" || cur === "USD" ? 10 : 100);

const monthSpent = (d: TrackerData) => monthExpense(d, curMonthKey());

/** Смена базовой валюты: выбор валюты и курса, превью пересчёта, применение через /api/rebase */
export function BaseCurrency() {
  const { data, reload, toast } = useTracker();
  const st = data.settings!;
  const others = st.currencies.filter((c) => c !== st.base);
  const [picked, setPicked] = useState(others[0] ?? "");
  const [custom, setCustom] = useState("");
  // null — взять значение по умолчанию для выбранной валюты
  const [rateStr, setRateStr] = useState<string | null>(null);
  const [rounding, setRounding] = useState<LimitRounding | null>(null);
  const [busy, setBusy] = useState(false);
  // null — ошибки нет; строка (возможно пустая) — пересчёт не выполнен, с причиной от сервера
  const [error, setError] = useState<string | null>(null);

  const to = custom.trim().toUpperCase() || picked;
  const validTo = /^[A-Z]{3,5}$/.test(to) && to !== st.base;
  const rateText = rateStr ?? String(st.rates[to] ?? "");
  const rate = parseAmount(rateText);
  const step = rounding ?? defaultRounding(to);
  const ready = validTo && rate !== null && rate > 0;
  const params = { from: st.base, to, rate: rate ?? 0, limitRounding: step };
  const preview = ready ? rebaseData(data, params, todayStr()) : null;

  const choose = (c: string) => {
    setPicked(c);
    setCustom("");
    setRateStr(null);
    setRounding(null);
    setError(null);
  };

  const apply = async () => {
    if (!ready || busy) return;
    downloadJson({ version: 2, ...data }, `traty-backup-before-${to}-${todayStr()}.json`);
    const ok = window.confirm(
      `Все суммы будут пересчитаны по курсу 1 ${to} = ${fmtRate(params.rate)} ${st.base}. Резервная копия скачана. Продолжить?`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rebase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "");
      }
      const oldBase = st.base;
      await reload();
      toast(`Учёт переведён в ${to}`);
      // Следующая смена по умолчанию — обратно в прежнюю валюту
      choose(oldBase);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="uppercase">
        Текущая: <b>{st.base}</b>
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2" role="group" aria-label="Новая базовая валюта">
        {others.map((c) => (
          <button key={c} className="tb tb-tight" aria-pressed={!custom && picked === c} onClick={() => choose(c)}>
            {c}
          </button>
        ))}
        <input
          className="tfield w-full uppercase sm:ml-2 sm:w-[16ch]"
          placeholder="другой код"
          aria-label="Код новой базовой валюты"
          maxLength={5}
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value.replace(/[^a-z]/gi, ""));
            setRateStr(null);
            setRounding(null);
            setError(null);
          }}
        />
      </div>

      {validTo && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
            <label htmlFor="rebase-rate" className="lbl">
              1 {to} =
            </label>
            <input
              id="rebase-rate"
              className="tfield w-[12ch]"
              inputMode="decimal"
              autoComplete="off"
              placeholder="курс"
              value={rateText}
              onChange={(e) => setRateStr(amountChars(e.target.value))}
            />
            <span className="text-muted">{st.base}</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-2 text-muted uppercase max-sm:w-full">Округление лимитов</span>
            <div className="tgroup max-sm:w-full" role="group" aria-label="Округление лимитов">
              {ROUNDINGS.map((r) => (
                <button key={r} className="tb" aria-pressed={step === r} onClick={() => setRounding(r)}>
                  {r === 0 ? "Без" : r}
                </button>
              ))}
            </div>
          </div>

          {preview && (
            <ul className="mt-4 border-t border-dashed border-line2 pt-3" aria-label="Превью пересчёта">
              {[
                ...activeCats(preview.settings).map((c) => ({ c, was: st.familyCategories, prefix: "" })),
                // Свои личные лимиты тоже пересчитываются; личные партнёра сервер пересчитает так же, но здесь их не видно
                ...liveCats(preview.mySettings.personalCategories).map((c) => ({ c, was: data.mySettings.personalCategories, prefix: "ЛИЧНОЕ · " })),
              ].map(({ c, was, prefix }) => (
                <li key={c.id} className="flex justify-between gap-4 py-0.5">
                  <span className="min-w-0 truncate">{prefix}{termName(c.name)}</span>
                  <span className="shrink-0 text-muted">
                    {fmt(was.find((o) => o.id === c.id)?.limit ?? 0)} {st.base} → <b className="text-ink">{fmt(c.limit)} {to}</b>
                  </span>
                </li>
              ))}
              <li className="mt-2 flex justify-between gap-4 border-t border-dashed border-line2 pt-2">
                <span className="uppercase">Траты за месяц</span>
                <span className="shrink-0 text-muted">
                  {fmt(monthSpent(data))} {st.base} → <b className="text-ink">{fmt(monthSpent(preview))} {to}</b>
                </span>
              </li>
              <li className="mt-1 text-muted2">// Счета и копилки остаются в своих валютах, история сверок пересчитается</li>
            </ul>
          )}

          <button className="tb mt-4 font-bold max-sm:h-12 max-sm:w-full" disabled={!ready || busy} onClick={apply}>
            {busy ? "Пересчёт…" : `Перевести учёт в ${to}`}
          </button>
        </>
      )}

      <p className="mt-3 min-h-5 text-bad uppercase" role="alert">
        {error !== null && `!! Пересчёт не выполнен${error ? ` // ${error.replace(/\.$/, "")}` : ""}`}
      </p>

      <p className="text-muted">
        {validTo
          ? `Записи в ${to} сохранят точные суммы, остальные пересчитаются по этому курсу. Вернуть ${st.base} можно так же, обратной сменой.`
          : "Записи в новой валюте сохранят точные суммы, остальные пересчитаются по указанному курсу. Вернуть прежнюю валюту можно так же, обратной сменой."}
      </p>

      {(st.baseHistory?.length ?? 0) > 0 && (
        <ul className="mt-3 text-muted2" aria-label="История смен базовой валюты">
          {st.baseHistory!.map((h, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {h.at}  {h.from} → {h.to}  // 1 {h.to} = {fmtRate(h.rate)} {h.from}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
