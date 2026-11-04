'use client'

import { Fragment } from 'react'
import { useTracker } from '../TrackerProvider'
import { useSpace, useSpaceData } from '../SpaceProvider'
import { useNarrow } from '../AsciiBar'
import { CommitInput } from '../CommitInput'
import { usePlan, withOverride } from './usePlan'
import { limitsSum, monthLimit, planIncome, planSummary } from '@/lib/plan'
import { average, monthRecurring } from '@/lib/metrics'
import type { Category } from '@/lib/types'
import { SPACE, inSpace, spaceGroups, spaceItems } from '@/lib/space'
import { Icon } from '../icons/Icon'
import { IconText, Problem, spaceIcon } from '../icons/IconText'
import { aliveIn, amountChars, fmt, minus, monthName, numIn, parseAmount, signed, termName, todayStr } from '@/lib/utils'

const BAR = 48

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
	const narrow = useNarrow()
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

		// Шкала: █ лимиты (с регулярными внутри), ▓ покупки, ░ остаток. План больше дохода — делим по плану, справа +!!
	const w = narrow ? 24 : BAR
	const fixed = s.limits.total
	const total = fixed + s.planned.total
	const scale = income !== null && income > 0 && !s.short ? income : total
	const cells = (v: number) => (scale > 0 ? Math.round((v / scale) * w) : 0)
		const lim = Math.min(w, cells(fixed))
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
			<h2 className="sec"><IconText name="plan">План</IconText></h2>
			{/* Мобильный: подпись | число, пояснение строкой 12px под числом; на десктопе число стоит в подписи */}
			<dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 uppercase sm:grid-cols-[max-content_minmax(0,1fr)] [&>dt]:whitespace-nowrap">
				{withIncome && (readOnly ? (
					<>
						<dt className="text-muted">Доход</dt>
						<dd className="max-sm:text-right"><b>{income === null ? '—' : fmt(Math.round(income))}</b></dd>
					</>
				) : (
					<>
						<dt className="text-muted"><label htmlFor="plan-income">Доход</label></dt>
						<dd className="flex flex-wrap items-center gap-x-4 gap-y-1 max-sm:justify-end">
							<CommitInput id="plan-income" inputMode="decimal" sanitize={amountChars}
								className={`tfield w-[14ch] text-right ${override === null && avg === null ? 'border-warn' : ''}`}
								value={income === null ? '' : String(Math.round(income))} placeholder={st.base}
								onCommit={commitIncome} />
							<span className="flex flex-wrap items-center gap-y-1 max-sm:w-full max-sm:justify-end max-sm:text-right max-sm:text-xs">{caption}</span>
						</dd>
					</>
				))}
								{[
					{ mark: <span aria-hidden="true">█ </span>, label: 'Лимиты', value: <b>{minus(s.limits.total)}</b>,
						note: `Вместе с регулярными${split ? ` · семья ${fmt(s.limits.family)} · личное ${fmt(s.limits.mine + s.limits.partner)}` : ''}` },
					// Регулярные — часть лимитов: справочно, в остаток отдельно не вычитаются
					{ mark: <Icon name="recurring" size={16} className="mr-2 text-muted" />, label: 'Из них регулярные', value: <b className="font-normal">{fmt(s.recurring.total)}</b>,
						note: `${split ? `Семья ${fmt(s.recurring.family)} · Личное ${fmt(s.recurring.mine + s.recurring.partner)}` : ''}${s.recurring.total > s.limits.total ? `${split ? ' · ' : ''}больше лимитов — поднимите лимиты` : ''}` },
					{ mark: <span aria-hidden="true" className="text-muted">▓ </span>, label: 'Покупки', value: <b>{minus(s.planned.total)}</b>,
						note: `${s.planned.count} шт.${s.planned.partner > 0 && data.partner ? ` · вкл. ${data.partner.name} ${fmt(s.planned.partner)}` : ''}` },
					...(withIncome ? [{ mark: <span aria-hidden="true" className="text-dim">░ </span>, label: 'Останется',
						value: <b className={s.short ? 'text-bad' : ''}>{s.rest === null ? '—' : signed(s.rest)}</b>,
						note: s.rest === null ? 'Нужен доход' : `В сбережения · ${pct}% дохода` }] : []),
				].map((r) => (
					<Fragment key={r.label}>
						<dt>{r.mark}{r.label}<span className="max-sm:hidden"> {r.value}</span></dt>
						<dd className="text-muted max-sm:text-right">
							<span className="text-ink sm:hidden">{r.value}</span>
							<span className="max-sm:block max-sm:text-xs">{r.note}</span>
						</dd>
					</Fragment>
				))}
			</dl>
			<p className="mt-4 whitespace-pre" aria-hidden="true">
				<span className="text-ink">{'█'.repeat(lim)}</span>
				<span className="text-muted">{'▓'.repeat(buy)}</span>
				<span className="text-dim">{'░'.repeat(Math.max(0, rest))}</span>
				{s.short && <b className="text-bad"> +<Icon name="warning" size={16} /></b>}
			</p>
			{s.short && (
				<p className="mt-2 uppercase" role="alert">
					<Problem>Не хватает {fmt(-s.rest!)} — перенесите покупку или возьмите из копилки</Problem>
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
