'use client'

import { useTracker } from '../TrackerProvider'
import { useNarrow } from '../AsciiBar'
import { CommitInput } from '../CommitInput'
import { usePlan, withOverride } from './usePlan'
import { limitsSum, monthLimit, planIncome, planSummary } from '@/lib/plan'
import { average } from '@/lib/metrics'
import type { Category } from '@/lib/types'
import { aliveIn, amountChars, fmt, monthName, parseAmount, signed, termName, todayStr } from '@/lib/utils'

const BAR = 48

/** :: ПЛАН — доход, лимиты, покупки, остаток и шкала распределения дохода */
export function PlanSummary({ month }: { month: string }) {
	const { data, toast } = useTracker()
	const st = data.settings!
	const { plan, items, savePlan } = usePlan(month)
	const narrow = useNarrow()
	const avg = average(data, todayStr())?.income ?? null
	const override = plan.incomeOverride
	const s = planSummary({
		income: planIncome(override, avg),
		familyLimits: limitsSum(st.familyCategories, month, plan.familyOverrides),
		myLimits: limitsSum(data.mySettings.personalCategories, month, plan.myOverrides),
		partnerLimits: data.partnerLimits[month] ?? 0,
		items,
		partnerPlanned: plan.partner.plannedTotal
	})
	const income = s.income

	const commitIncome = (v: string) => {
		const n = parseAmount(v)
		// Пусто — к среднему (или к «не задан», если среднего нет)
		if (n === null) return void savePlan({ incomeOverride: null })
		if (Number.isNaN(n) || n < 0) return toast('Доход должен быть числом.'), false
		void savePlan({ incomeOverride: n })
	}

	// Шкала: █ лимиты, ▓ покупки, ░ остаток. План больше дохода — делим по плану, справа +!!
	const w = narrow ? 24 : BAR
	const total = s.limits.total + s.planned.total
	const scale = income !== null && income > 0 && !s.short ? income : total
	const cells = (v: number) => (scale > 0 ? Math.round((v / scale) * w) : 0)
	const lim = Math.min(w, cells(s.limits.total))
	const buy = Math.min(w - lim, cells(s.planned.total))
	const rest = income === null ? 0 : w - lim - buy
	const pct = income && s.rest !== null ? Math.round((s.rest / income) * 100) : null

	let caption
	if (override === null && avg !== null) caption = <span className="text-muted">Среднее за 3 мес</span>
	else if (override === null) caption = <span className="text-warn">Среднего ещё нет — впишите ожидаемый доход</span>
	else
		caption = (
			<>
				<span className="text-muted">Вручную // {avg === null ? 'среднего ещё нет' : `среднее ${fmt(Math.round(avg))}`}</span>
				{avg !== null && <button className="tb ml-3" onClick={() => void savePlan({ incomeOverride: null })}>= Среднее</button>}
			</>
		)

	return (
		<section className="mt-6 border-t border-dashed border-line pt-5">
			<h2 className="sec">План</h2>
			<dl className="mt-3 grid grid-cols-1 items-baseline gap-x-6 uppercase sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-2 [&>dt]:whitespace-nowrap">
				<dt className="text-muted max-sm:mt-2"><label htmlFor="plan-income">Доход</label></dt>
				<dd className="flex flex-wrap items-center gap-x-4 gap-y-1">
					<CommitInput id="plan-income" inputMode="decimal" sanitize={amountChars}
						className={`tfield w-[14ch] text-right ${override === null && avg === null ? 'border-warn' : ''}`}
						value={income === null ? '' : String(Math.round(income))} placeholder={st.base}
						onCommit={commitIncome} />
					<span className="flex items-center">{caption}</span>
				</dd>
				<dt className="max-sm:mt-2"><span aria-hidden="true">█ </span>Лимиты <b>−{fmt(s.limits.total)}</b></dt>
				<dd className="text-muted">Семья {fmt(s.limits.family)} · Личное {fmt(s.limits.mine + s.limits.partner)}</dd>
				<dt className="max-sm:mt-2"><span aria-hidden="true" className="text-muted">▓ </span>Покупки <b>−{fmt(s.planned.total)}</b></dt>
				<dd className="text-muted">
					{s.planned.count} шт.{s.planned.partner > 0 && ` · вкл. ${data.partner.name} ${fmt(s.planned.partner)}`}
				</dd>
				<dt className="max-sm:mt-2">
					<span aria-hidden="true" className="text-dim">░ </span>Останется{' '}
					<b className={s.short ? 'text-bad' : ''}>{s.rest === null ? '—' : signed(s.rest)}</b>
				</dt>
				<dd className="text-muted">{s.rest === null ? 'Нужен доход' : `В сбережения · ${pct}% дохода`}</dd>
			</dl>
			<p className="mt-4 whitespace-pre" aria-hidden="true">
				<span className="text-ink">{'█'.repeat(lim)}</span>
				<span className="text-muted">{'▓'.repeat(buy)}</span>
				<span className="text-dim">{'░'.repeat(Math.max(0, rest))}</span>
				{s.short && <b className="text-bad"> +!!</b>}
			</p>
			{s.short && (
				<p className="mt-2 text-bad uppercase" role="alert">
					!! Не хватает {fmt(-s.rest!)} — перенесите покупку или возьмите из копилки
				</p>
			)}
		</section>
	)
}

/** :: ЛИМИТЫ // НОЯБРЬ — поправки только на этот месяц */
export function PlanLimits({ month }: { month: string }) {
	const { data } = useTracker()
	const { plan, savePlan, saveMyPlan } = usePlan(month)
	const rows: { c: Category; scope: 'family' | 'personal' }[] = [
		...data.settings!.familyCategories.filter((c) => aliveIn(c, month)).map((c) => ({ c, scope: 'family' as const })),
		...data.mySettings.personalCategories.filter((c) => aliveIn(c, month)).map((c) => ({ c, scope: 'personal' as const }))
	]
	const name = monthName(month)

	return (
		<section className="mt-6 border-t border-dashed border-line pt-5">
			<h2 className="sec">Лимиты // {name}</h2>
			<ul className="mt-2">
				{rows.map(({ c, scope }) => {
					const ov = scope === 'family' ? plan.familyOverrides : plan.myOverrides
					const usual = monthLimit(c, month)
					const cur = monthLimit(c, month, ov)
					const diff = cur - usual
					const save = (v: number | null) =>
						scope === 'family' ? savePlan({ limitOverrides: withOverride(ov, c.id, v) }) : saveMyPlan(withOverride(ov, c.id, v))
					return (
						<li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto_12ch] items-center gap-x-4 border-b border-dashed border-line2 py-1 uppercase sm:grid-cols-[minmax(0,1fr)_7ch_12ch_12ch_9ch]">
							<span className="truncate max-sm:col-span-3">{termName(c.name)}</span>
							<span className="text-muted max-sm:order-first max-sm:hidden">[{scope === 'family' ? 'СЕМ' : 'ЛИЧН'}]</span>
							<span className="text-right text-muted">{fmt(usual)}</span>
							<CommitInput className="tfield w-full text-right" inputMode="decimal" sanitize={amountChars}
								aria-label={`Лимит на ${name}, ${c.name}`} value={String(cur)}
								onCommit={(v) => {
									const n = parseAmount(v)
									if (n === null) return void save(null)
									if (Number.isNaN(n) || n < 0) return false
									void save(n === usual ? null : n)
								}} />
							<span className={`text-right ${diff > 0 ? 'text-warn' : 'text-muted'}`}>{diff === 0 ? '' : signed(diff)}</span>
						</li>
					)
				})}
			</ul>
			<p className="mt-3 text-muted2 uppercase">Изменения — только на {name}</p>
		</section>
	)
}
