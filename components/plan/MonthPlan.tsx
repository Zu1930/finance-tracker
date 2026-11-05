'use client'

import { useTracker } from '../TrackerProvider'
import { useSpace, useSpaceData } from '../SpaceProvider'
import { useBarCells } from '../AsciiBar'
import { PlanEquation, type EquationNotes } from '../limits/parts'
import { planEquation } from '@/lib/plan-view'
import { t } from '@/lib/i18n'
import { CommitInput } from '../CommitInput'
import { usePlan, withOverride } from './usePlan'
import { limitsSum, monthLimit, planIncome, planSummary } from '@/lib/plan'
import { average, monthRecurring } from '@/lib/metrics'
import type { Category } from '@/lib/types'
import { SPACE, inSpace, spaceGroups, spaceItems } from '@/lib/space'
import { Icon } from '../icons/Icon'
import { IconText, Problem, spaceIcon } from '../icons/IconText'
import { aliveIn, amountChars, fmt, monthName, numIn, parseAmount, signed, termName, todayStr } from '@/lib/utils'

/**
 * :: ПЛАН — доход, лимиты, покупки, остаток и шкала распределения дохода. Семья — её лимиты, покупки и доход;
 * личное — мои лимиты и покупки, без дохода; всё вместе — общий план, как раньше (суммы партнёра одной цифрой), только чтение
 */
export function PlanSummary({ month }: { month: string }) {
	const { data, toast, isSolo } = useTracker()
	const { view, readOnly } = useSpace()
	const sd = useSpaceData()
	const st = data.settings!
	const { plan, items, savePlan } = usePlan(month)
	const fam = view !== 'personal', mine = view !== 'family'
	// Личный бюджет без дохода: доход и остаток — у семьи
	const withIncome = isSolo || view !== 'personal'
	const avg = withIncome ? (average(sd, todayStr())?.income ?? null) : null
	const override = withIncome ? plan.incomeOverride : null
	const rec = monthRecurring(sd, month, todayStr())
	const s = planSummary({
		income: withIncome ? planIncome(override, avg) : null,
		familyLimits: fam ? limitsSum(st.familyCategories, month, plan.familyOverrides) : 0,
		myLimits: mine ? limitsSum(data.mySettings.personalCategories, month, plan.myOverrides) : 0,
		partnerLimits: view === 'all' ? (data.partnerLimits[month] ?? 0) : 0,
		items: spaceItems(items, view),
		partnerPlanned: view === 'all' ? plan.partner.plannedTotal : 0,
		recurring: rec
	})
	const income = s.income
	const split = !isSolo && view === 'all'

	const commitIncome = (v: string) => {
		const n = parseAmount(v)
		// Пусто — к среднему (или к «не задан», если среднего нет)
		if (n === null) return void savePlan({ incomeOverride: null })
		if (Number.isNaN(n) || n < 0) return toast('Доход должен быть числом.'), false
		void savePlan({ incomeOverride: n })
	}

	// Те же строки, что на телефоне и в мастере; пояснения — второй строкой под суммой
	const e = planEquation(data, view, isSolo, month, todayStr())
	const pct = income && s.rest !== null ? Math.round((s.rest / income) * 100) : null
	const notes: EquationNotes = {
		income: !withIncome ? null : override === null ? (
			avg !== null ? t('plan.noteAvg') : <span className="text-warn">{t('plan.noteNoAvg')}</span>
		) : (
			<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
				{avg === null ? t('plan.noteManualNoAvg') : t('plan.noteManual', { x: fmt(Math.round(avg)) })}
				{avg !== null && !readOnly && <button className="tb" onClick={() => void savePlan({ incomeOverride: null })}>{t('plan.toAverage')}</button>}
			</span>
		),
		required: s.recurring.total > s.limits.total ? <span className="text-warn">{t('plan.noteOver')}</span> : null,
		living: split ? t('plan.noteSplit', { f: fmt(s.limits.family), p: fmt(s.limits.mine + s.limits.partner) }) : null,
		purchases: [t('plan.noteCount', { n: s.planned.count }), ...(s.planned.partner > 0 && data.partner ? [t('plan.notePartner', { name: data.partner.name, x: fmt(s.planned.partner) })] : [])].join(' · '),
		rest: e.rest === null ? null : pct === null ? t('plan.noteNeedIncome') : t('plan.notePct', { n: pct }),
	}
	const incomeField = withIncome && !readOnly ? (
		<CommitInput id="plan-income" aria-label={t('plan.income')} inputMode="decimal" sanitize={amountChars}
			className={`tfield w-[14ch] max-w-full text-right ${override === null && avg === null ? 'border-warn' : ''}`}
			value={income === null ? '' : String(Math.round(income))} placeholder={st.base}
			onCommit={commitIncome} />
	) : undefined

	// Шкала: █ лимиты (с обязательными внутри), ▓ покупки, ░ остаток — шириной в свой блок. План больше дохода — делим по плану
	const { box, bar, cells: w } = useBarCells()
	const fixed = s.limits.total
	const total = fixed + s.planned.total
	const scale = income !== null && income > 0 && !s.short ? income : total
	const cells = (v: number) => (scale > 0 ? Math.round((v / scale) * w) : 0)
	const lim = Math.min(w, cells(fixed))
	const buy = Math.min(w - lim, cells(s.planned.total))
	const rest = income === null ? 0 : w - lim - buy

	return (
		<section className="mt-6 min-w-0 border-t border-dashed border-line pt-5 uppercase">
			<h2 className="sec"><IconText name="plan">{t('plan.title')}</IconText></h2>
			<div className="mt-3"><PlanEquation e={e} notes={notes} income={incomeField} adaptive /></div>
			<div ref={box} data-plan-bar className="mt-4 flex max-w-full min-w-0 items-baseline gap-1 overflow-hidden">
				<span ref={bar} className="whitespace-pre" aria-hidden="true">
					<span className="text-ink">{'█'.repeat(lim)}</span>
					<span className="text-muted">{'▓'.repeat(buy)}</span>
					<span className="text-dim">{'░'.repeat(Math.max(0, rest))}</span>
				</span>
				{s.short && <b className="shrink-0 text-bad"><Icon name="warning" size={16} /></b>}
			</div>
			{s.short && (
				<p className="mt-2 uppercase" role="alert">
					<Problem>{t('plan.shortHint', { x: fmt(-s.rest!) })}</Problem>
				</p>
			)}
		</section>
	)
}

/** :: ЛИМИТЫ // НОЯБРЬ — поправки только на этот месяц, категории выбранного бюджета; в «всё вместе» — две секции для чтения */
export function PlanLimits({ month }: { month: string }) {
	const { data, isSolo } = useTracker()
	const { view, readOnly } = useSpace()
	const { plan, savePlan, saveMyPlan } = usePlan(month)
	const rows: { c: Category; scope: 'family' | 'personal' }[] = [
		...(isSolo ? [] : data.settings!.familyCategories).filter((c) => aliveIn(c, month)).map((c) => ({ c, scope: 'family' as const })),
		...data.mySettings.personalCategories.filter((c) => aliveIn(c, month)).map((c) => ({ c, scope: 'personal' as const }))
	].filter((r) => inSpace(r.scope, view))
	const name = monthName(month)

	return (
		<section className="mt-6 border-t border-dashed border-line pt-5">
			<h2 className="sec">Лимиты // {name}</h2>
			{(readOnly ? spaceGroups(view) : [null]).map((g) => (
			<div key={g ?? 'one'}>
			{g && <h3 className="mt-4 text-muted uppercase"><IconText name={spaceIcon(g)}>{SPACE[g].name}</IconText></h3>}
			<ul className="mt-2">
				{rows.filter((r) => !g || r.scope === g).map(({ c, scope }) => {
					const ov = scope === 'family' ? plan.familyOverrides : plan.myOverrides
					const usual = monthLimit(c, month)
					const cur = monthLimit(c, month, ov)
					const diff = cur - usual
					const save = (v: number | null) =>
						scope === 'family' ? savePlan({ limitOverrides: withOverride(ov, c.id, v) }) : saveMyPlan(withOverride(ov, c.id, v))
					return (
						// Мобильный: имя и scope строкой, ниже обычный лимит, поле и разница
						<li key={c.id} className="grid grid-cols-[minmax(0,1fr)_12ch_9ch] items-center gap-x-4 border-b border-dashed border-line2 py-1 uppercase sm:grid-cols-[minmax(0,1fr)_7ch_12ch_12ch_9ch]">
							<span className="truncate max-sm:col-span-3 max-sm:pt-1">
								{termName(c.name)}
							</span>
							<span className="max-sm:hidden" />
							<span className="text-muted sm:text-right">{fmt(usual)}</span>
							{readOnly ? <b className="text-right">{fmt(cur)}</b> : <CommitInput className="tfield w-full text-right" inputMode="decimal" sanitize={amountChars}
								aria-label={`Лимит на ${name}, ${c.name}`} value={numIn(cur)}
								onCommit={(v) => {
									const n = parseAmount(v)
									if (n === null) return void save(null)
									if (Number.isNaN(n) || n < 0) return false
									void save(n === usual ? null : n)
								}} />}
							<span className={`text-right ${diff > 0 ? 'text-warn' : 'text-muted'}`}>{diff === 0 ? '' : signed(diff)}</span>
						</li>
					)
				})}
			</ul>
			</div>
			))}
			{!readOnly && <p className="mt-3 text-muted2 uppercase">Изменения — только на {name}</p>}
		</section>
	)
}
