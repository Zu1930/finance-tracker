'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import { HUGE, useMedia, useNarrow } from '../AsciiBar'
import { BTN } from '../limits/parts'
import { Icon } from '../icons/Icon'
import { IconText } from '../icons/IconText'
import { t } from '@/lib/i18n'
import { abbr, monthIncome } from '@/lib/metrics'
import { equationTotal, hasPlan, planEquation } from '@/lib/plan-view'
import { spaceData } from '@/lib/space'
import { REQUIRED, bars, deltaOf, limitExtremes, recapKey, showRecap, summary, summaryData } from '@/lib/summary'
import type { Category, Scope } from '@/lib/types'
import { MONTHS_GEN, curMonthKey, fmt, monthName, monthTitle, shiftMonth, todayStr } from '@/lib/utils'

const META = 'text-xs text-muted uppercase'
const HINT = 'text-[0.8125rem] text-muted2'
const MONTHS = 6
const gen = (m: string) => MONTHS_GEN[Number(m.slice(5, 7)) - 1]

/** Имена строк «куда ушли деньги»: категории обоих бюджетов (и архивные), «Обязательные» */
function useNames() {
	const { data } = useTracker()
	const map = new Map<string, Category>()
	for (const c of data.settings?.familyCategories ?? []) map.set(`family:${c.id}`, c)
	for (const c of data.mySettings.personalCategories) map.set(`personal:${c.id}`, c)
	return (key: string) => (key === REQUIRED ? t('summary.required') : map.get(key)?.name ?? '—')
}

/** Скрытые итоги прошлого месяца — флаг в localStorage по месяцу */
const noop = () => () => {}
function useRecapHidden(month: string): [boolean, () => void] {
	const [hidden, setHidden] = useState(false)
	const stored = useSyncExternalStore(noop, () => { try { return localStorage.getItem(recapKey(month)) === '1' } catch { return false } }, () => true)
	const hide = () => {
		try { localStorage.setItem(recapKey(month), '1') } catch {}
		setHidden(true)
	}
	return [hidden || stored, hide]
}

/**
 * «Итоги»: сколько потрачено и как обычно ли это, куда ушли деньги, траты и доход по месяцам, итоги прошлого месяца.
 * Всё — по выбранному бюджету и месяцу. Телефон — одна колонка, десктоп — две
 */
export function SummaryView() {
	const narrow = useNarrow()
	const cur = curMonthKey()
	const [month, setMonth] = useState(cur)
	const first = shiftMonth(cur, -(MONTHS - 1))
	const nav = (
		<div className="flex items-center justify-between pb-2.5">
			<button className="ib" disabled={month <= first} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="back" size={24} label={t('limits.prevMonth')} /></button>
			<h1 className="text-lg font-bold uppercase">{monthTitle(month)}</h1>
			<button className="ib" disabled={month >= cur} onClick={() => setMonth(shiftMonth(month, 1))}>
				<Icon name="back" size={24} className="-scale-x-100" label={t('limits.nextMonth')} />
			</button>
		</div>
	)
	const recap = month === cur && <Recap onOpen={setMonth} />
	if (narrow)
		return (
			<div className="flex flex-col gap-2.5 pb-6">
				{nav}
				{recap}
				<Main month={month} />
				<ByMonth month={month} onPick={setMonth} />
			</div>
		)
	// Десктоп: колонки — .l-summary в app/globals.css; на 1920+ — третья: итоги прошлого месяца и сравнение со средним
	return (
		<div className="pb-10">
			<div className="max-w-md">{nav}</div>
			<div className="l-summary">
				<div className="flex flex-col gap-2.5 [grid-area:main]"><Main month={month} /></div>
				<ByMonth month={month} onPick={setMonth} tall className="[grid-area:months]" />
				<div className="flex flex-col gap-4 [grid-area:side]">
					{recap}
					<VsAverage month={month} className="hidden huge:flex" />
				</div>
			</div>
		</div>
	)
}

function useSummaryData() {
	const { data } = useTracker()
	const { view } = useSpace()
	return summaryData(spaceData(data, view))
}

/** Главное и «куда ушли деньги» */
function Main({ month }: { month: string }) {
	const sd = useSummaryData()
	const st = useTracker().data.settings!
	const name = useNames()
	const s = summary(sd, month, todayStr())
	const m = monthName(month)
	const h = s.headline
	const cat = h?.key ? name(h.key).toLowerCase() : ''
	const headline = !h ? null : h.kind === 'usual'
		? t(s.current ? 'summary.usualCur' : 'summary.usualPast', { m })
		: t(`summary.${h.kind}${s.current ? 'Cur' : 'Past'}` as 'summary.moreCur', { m, n: h.pct, c: cat })
	const max = Math.max(1, ...s.rows.map((r) => Math.max(r.amount, r.avg ?? 0)))

	return (
		<>
			<section aria-label={t('summary.where')} className="flex flex-col gap-1 pt-1 pb-1.5">
				<span className={META}>{s.current ? t('summary.spentSince', { m: gen(month) }) : t('summary.spentIn', { m })}</span>
				<p className="flex items-baseline gap-2">
					<b className="text-[2rem] leading-tight tracking-tight">{fmt(Math.round(s.spent))}</b>
					<span className={META}>{st.base}</span>
				</p>
				{headline && <p className="text-[0.9375rem]">{headline}</p>}
			</section>
			<div className="mt-1.5 flex justify-between">
				<h2 className="sec">{t('summary.where')}</h2>
				{s.avg !== null && <span className={META}>{t('summary.vsAvg')}</span>}
			</div>
			{s.rows.length === 0 && <p className={HINT}>{t('summary.none')}</p>}
			<ul>
				{s.rows.map((r) => {
					const d = deltaOf(r)
					const [scope, catId] = r.key === REQUIRED ? [null, REQUIRED] : (r.key.split(':') as [Scope, string])
					return (
						<li key={r.key}>
							<Link href={`/?cat=${encodeURIComponent(catId)}${scope ? `&scope=${scope}` : ''}&month=${month}`}
								className="flex flex-col gap-1.5 border-b border-dashed border-line2 py-2.5">
								<span className="flex justify-between gap-2">
									<span className="min-w-0 truncate uppercase">{name(r.key)} <span className="text-xs text-muted">{r.share}%</span></span>
									<span className="flex shrink-0 items-baseline gap-3">
										<b>{fmt(Math.round(r.amount))}</b>
										<span className={`min-w-[3.875rem] text-right text-xs uppercase ${d?.warn ? 'text-warn' : 'text-muted'}`}>
											{!d ? (s.avg !== null ? t('summary.new') : '') : d.kind === 'same' ? t('summary.same') : `${d.kind === 'up' ? '▲ +' : '▼ −'}${d.pct}%`}
										</span>
									</span>
								</span>
								<span aria-hidden="true" className="relative block h-1.5">
									<span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${(r.amount / max) * 100}%` }} />
									{r.avg !== null && r.avg > 0 && <span className="absolute -inset-y-0.5 w-0.5 bg-muted" style={{ left: `${Math.min(99, (r.avg / max) * 100)}%` }} />}
								</span>
							</Link>
						</li>
					)
				})}
			</ul>
			{s.current && s.avg !== null && s.rows.length > 0 && <p className={HINT}>{t('summary.avgHint')}</p>}
		</>
	)
}

/** :: ПО МЕСЯЦАМ — столбцы трат, риска дохода; столбец выбирает месяц */
function ByMonth({ month, onPick, tall = false, className = '' }: { month: string; onPick: (m: string) => void; tall?: boolean; className?: string }) {
	const sd = useSummaryData()
	const cur = curMonthKey()
	// 1920+: 12 месяцев и выше; иначе 6
	const huge = useMedia(HUGE) && tall
	const list = bars(sd, todayStr(), huge ? 12 : MONTHS)
	const cols = { gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }
	const max = Math.max(1, ...list.flatMap((b) => [b.expense, b.income]))
	const withIncome = list.some((b) => b.income > 0)
	return (
		<section aria-label={t('summary.byMonth')} className={`mt-3.5 ${className}`}>
			<h2 className="sec">{t('summary.byMonth')}</h2>
			<div style={cols} className={`mt-2 grid items-end gap-2 border-b border-line pt-2 ${tall ? 'h-[13.75rem] huge:h-[360px]' : 'h-[9.375rem]'}`}>
				{list.map((b) => (
					<button key={b.key} className="relative flex h-full items-end" aria-pressed={b.key === month}
						aria-label={t('summary.barAria', { m: monthName(b.key), x: fmt(Math.round(b.expense)), y: fmt(Math.round(b.income)) })} onClick={() => onPick(b.key)}>
						{b.income > 0 && <span className="absolute -inset-x-0.5 h-0.5 bg-muted" style={{ bottom: `${(b.income / max) * 100}%` }} />}
						<span className={`w-full border border-ink ${b.key === cur ? '' : b.key === month ? 'bg-ink' : 'bg-muted'}`} style={{ height: `${(b.expense / max) * 100}%` }} />
					</button>
				))}
			</div>
			<div style={cols} className="grid gap-2">
				{/* Подписи не мельче 12px */}
				{list.map((b) => <span key={b.key} className={`text-center text-xs ${b.key === month ? 'font-bold' : 'text-muted'}`}>{abbr(b.key)}</span>)}
			</div>
			<p className={`mt-1.5 flex flex-wrap gap-x-3.5 ${META}`}>
				<span>█ {t('summary.legendSpent')}</span>
				{withIncome && <span>— {t('summary.legendIncome')}</span>}
				<span>□ {t('summary.legendNow')}</span>
			</p>
			<p className={`mt-1 ${HINT}`}>{t('summary.pickHint')}</p>
		</section>
	)
}

/** 1920+: этот месяц против среднего по крупнейшим категориям — сумма, среднее и разница */
function VsAverage({ month, className = '' }: { month: string; className?: string }) {
	const sd = useSummaryData()
	const name = useNames()
	const s = summary(sd, month, todayStr())
	const top = s.rows.filter((r) => r.avg !== null).slice(0, 6)
	if (s.avg === null || top.length === 0) return null
	return (
		<section aria-label={t('summary.vsAvgTitle')} className={`mt-3.5 flex-col gap-1 ${className}`}>
			<h2 className="sec">{t('summary.vsAvgTitle')}</h2>
			<ul className="mt-2">
				{top.map((r) => {
					const d = deltaOf(r)
					return (
						<li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-b border-dashed border-line2 py-2 uppercase">
							<span className="truncate">{name(r.key)}</span>
							<span className="text-right"><b>{fmt(Math.round(r.amount))}</b> <span className={META}>/ {fmt(Math.round(r.avg!))}</span></span>
							<span className={`min-w-[3.875rem] text-right text-xs ${d?.warn ? 'text-warn' : 'text-muted'}`}>
								{!d ? '' : d.kind === 'same' ? t('summary.same') : `${d.kind === 'up' ? '▲ +' : '▼ −'}${d.pct}%`}
							</span>
						</li>
					)
				})}
			</ul>
			<p className={`mt-1.5 ${HINT}`}>{t('summary.vsAvgHint')}</p>
		</section>
	)
}

/** Итоги прошлого месяца: первые 7 дней, пока не скрыты */
function Recap({ onOpen }: { onOpen: (m: string) => void }) {
	const { data, isSolo } = useTracker()
	const { view } = useSpace()
	const sd = useSummaryData()
	const name = useNames()
	const today = todayStr()
	const prev = shiftMonth(curMonthKey(), -1)
	const [hidden, hide] = useRecapHidden(prev)
	const s = summary(sd, prev, today)
	if (!showRecap(today) || hidden || s.spent <= 0) return null
	// Личный бюджет без дохода: сколько потратили и сколько планировали всего
	const withIncome = isSolo || view !== 'personal'
	const fact = withIncome ? monthIncome(sd, prev) - s.spent : s.spent
	const e = hasPlan(data, view, isSolo, prev) ? planEquation(data, view, isSolo, prev, today) : null
	const planned = e ? (withIncome ? e.rest : equationTotal(e)) : null
	const groups = (isSolo || view === 'personal' ? ['personal'] : view === 'family' ? ['family'] : ['family', 'personal']) as Scope[]
	const ex = limitExtremes(sd, prev, groups.map((g) => ({ scope: g, cats: g === 'family' ? data.settings!.familyCategories : data.mySettings.personalCategories })))
	const extremes = [
		ex.over && t('summary.over', { c: name(ex.over.key), x: fmt(Math.round(ex.over.v)) }),
		ex.saved && t('summary.economy', { c: name(ex.saved.key), x: fmt(Math.round(ex.saved.v)) }),
	].filter(Boolean).join(' · ')
	return (
		<section aria-label={t('summary.recap', { m: gen(prev) })} className="flex flex-col gap-2 border border-ink p-3">
			<div className="flex items-center justify-between">
				<b className="uppercase"><IconText name="check">{t('summary.recap', { m: gen(prev) })}</IconText></b>
				<button className="ib -my-2" onClick={hide}><Icon name="close" size={20} label={t('summary.hideRecap')} /></button>
			</div>
			<span>
				{t(withIncome ? 'summary.saved' : 'summary.spent')} <b>{fmt(Math.round(fact))}</b>
				{planned !== null && planned > 0 && <span className={META}> · {t('summary.planWas', { x: fmt(Math.round(planned)) })}</span>}
			</span>
			{planned !== null && planned > 0 && (
				<span aria-hidden="true" className="flex h-1 bg-line2"><span className="bg-ink" style={{ width: `${Math.min(100, Math.max(0, (fact / planned) * 100))}%` }} /></span>
			)}
			{extremes && <span className={META}>{extremes}</span>}
			<button className={`${BTN} min-h-9 self-start uppercase`} onClick={() => onOpen(prev)}>{t('summary.open', { m: monthName(prev).toLowerCase() })}</button>
		</section>
	)
}
