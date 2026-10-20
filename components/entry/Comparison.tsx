'use client'

import type { ReactNode } from 'react'
import { useTracker } from '../TrackerProvider'
import {
	abbr,
	fmtChange,
	fmtPct,
	forecast,
	monthOf,
	monthPlannedForecast,
	periodCompare,
	savingsRates,
	shiftKey
} from '@/lib/metrics'
import { fmt, todayStr } from '@/lib/utils'

/** Рост расходов выше этого порога подсвечивается как предупреждение */
const WARN_GROWTH = 0.1

/** Прогнозы приблизительны: от сотни округляем до целых, мелкие суммы (EUR) оставляем с копейками */
const money = (n: number) => fmt(Math.abs(n) >= 100 ? Math.round(n) : n)
/** «−211 000 RSD», «+55 120 RSD», «0 RSD» */
const signed = (n: number, base: string) =>
	`${n < 0 ? '−' : n > 0 ? '+' : ''}${money(Math.abs(n))} ${base}`

/** Таблица сравнения под балансом месяца. Пустые значения — «—», строки не исчезают */
export function Comparison() {
	const { data } = useTracker()
	const base = data.settings!.base
	const today = todayStr()
	const rates = savingsRates(data, today)
	const f = forecast(data, today)
	const cmp = periodCompare(data, today)
	const prevAbbr = abbr(shiftKey(monthOf(today), -1))
	// Покупки по плану: max(план, факт) по каждому пункту, включая партнёра
	const planned = monthPlannedForecast(data, monthOf(today))
	const lowData = <span className="text-muted">— // мало данных</span>

	return (
		<div className="mt-6">
			<h3 className="sec">Сравнение</h3>
			{/* На мобильном метка и значение в столбик, чтобы ничего не скроллилось */}
			<dl className="mt-3 grid grid-cols-1 gap-x-6 uppercase sm:grid-cols-[18ch_minmax(0,1fr)] sm:gap-y-1">
				<Row label="Норма сбережений">
					<span className={rates.current !== null && rates.current < 0 ? 'text-bad' : ''}>
						{fmtPct(rates.current)}
					</span>
					<span className="text-muted">
						{' '}
						// {prevAbbr} {fmtPct(rates.previous)} // среднее 3 мес{' '}
						{fmtPct(rates.average)}
					</span>
				</Row>

				<Row label="Прогноз расходов">
					{f ? (
						<>
							<span className={f.vsAverage !== null && f.vsAverage > WARN_GROWTH ? 'text-warn' : ''}>
								{signed(-f.forecastRegular, base)}
							</span>
							<span className="text-muted">
								{' '}
								// среднее 3 мес{' '}
								{f.averageExpense === null ? '—' : `−${money(f.averageExpense)}`}
								{f.vsAverage !== null && ` (${fmtChange(f.vsAverage)})`}
							</span>
						</>
					) : (
						lowData
					)}
				</Row>

				{planned > 0 && <Row label="Плановые">{signed(-planned, base)}</Row>}

				<Row label="Прогноз остатка">
					{f ? (
						<>
							<span className={f.forecastBalance < 0 ? 'text-warn' : ''}>
								{signed(f.forecastBalance, base)}
							</span>
							<span className="text-muted">
								{' '}
								на {f.lastDay}.{today.slice(5, 7)}
							</span>
							{f.incomeIsExpected && (
								<span className="text-muted2"> (доход ожидается по среднему)</span>
							)}
						</>
					) : (
						lowData
					)}
				</Row>

				<Row label={`К 1–${cmp.prevDays} ${prevAbbr}`}>
					<span className="text-muted">доход </span>
					{fmtChange(cmp.income)}
					<span className="text-muted">{'   '}расход </span>
					<span className={cmp.expense !== null && cmp.expense > WARN_GROWTH ? 'text-warn' : ''}>
						{fmtChange(cmp.expense)}
					</span>
				</Row>
			</dl>
		</div>
	)
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<dt className="text-muted max-sm:mt-2">{label}</dt>
			<dd className="whitespace-pre-wrap text-ink">{children}</dd>
		</>
	)
}
