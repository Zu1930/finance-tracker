'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import { CommitInput } from '../CommitInput'
import { CategoriesBlock } from '../LimitsView'
import { RecurringManager } from '../recurring/RecurringManager'
import { PayControl } from '../recurring/PayControl'
import { useRecurring } from '../recurring/useRecurring'
import { usePlan, withOverride } from '../plan/usePlan'
import { PlanWizard } from './PlanWizard'
import { BTN, PRIMARY, PlanEquation, PlanTotal, Sheet } from './parts'
import { Icon } from '../icons/Icon'
import { IconText, spaceIcon } from '../icons/IconText'
import { t } from '@/lib/i18n'
import { MAX_AHEAD, monthsAhead, planSpentByCat } from '@/lib/plan'
import { equationTotal, hasPlan, living, perDay, planEquation, planScope } from '@/lib/plan-view'
import { SPACE, inSpace, spaceItems } from '@/lib/space'
import { plural } from '@/lib/settings-meta'
import type { Category, Scope } from '@/lib/types'
import { MONTHS_GEN, amountChars, catsIn, curMonthKey, fmt, minus, monthName, monthTitle, numIn, parseAmount, setLimit, shiftMonth, termName, todayStr } from '@/lib/utils'

const BAR = 30
const gen = (month: string) => MONTHS_GEN[Number(month.slice(5, 7)) - 1]

/**
 * «Лимиты» на телефоне: сколько осталось на жизнь, обязательные платежи, план месяца одной строкой и категории.
 * Будущий месяц — план по шагам (PlanWizard). Всё по выбранному бюджету; в «всё вместе» — только просмотр
 */
export function MobileLimits() {
	const { data, isSolo, month, setMonth } = useTracker()
	const { view, readOnly } = useSpace()
	const ahead = monthsAhead(curMonthKey(), month)
	const scope = planScope(view, isSolo)
	const canPlan = !!scope && !readOnly && !data.readonly
	const [wizard, setWizard] = useState(false)

	return (
		<div className="pb-6">
			<div className="flex items-center justify-between pb-2.5">
				<button className="ib" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="back" size={24} label={t('limits.prevMonth')} /></button>
				<h1 className="text-lg font-bold uppercase">{monthTitle(month)}</h1>
				<button className="ib" disabled={ahead >= MAX_AHEAD} onClick={() => setMonth(shiftMonth(month, 1))}>
					<Icon name="back" size={24} className="-scale-x-100" label={t('limits.nextMonth')} />
				</button>
			</div>
			{ahead > 0 ? <FutureMonth month={month} canPlan={canPlan} onPlan={() => setWizard(true)} /> : <CurrentMonth month={month} />}
			{wizard && scope && <PlanWizard month={month} scope={scope} onClose={() => setWizard(false)} />}
		</div>
	)
}

/** «Можно потратить»: лимиты без обязательных, шкала и «на день можно». Телефон — «Лимиты», десктоп — колонка ввода */
export function CanSpend({ month }: { month: string }) {
	const { data } = useTracker()
	const { view } = useSpace()
	const today = todayStr()
	const isCur = month === curMonthKey()
	const { limit, left } = living(data, view, month, today)
	const filled = limit > 0 ? Math.round(Math.min(1, Math.max(0, (limit - left) / limit)) * BAR) : left < 0 ? BAR : 0
	const day = perDay(left, today)
	const days = `${day.days} ${plural(day.days, 'дня', 'дней', 'дней')}`
	return (
		<section aria-label={t('budget.canSpend')} className="flex flex-col gap-1 pb-2.5">
			<span className="text-xs text-muted uppercase">{t('budget.canSpend')}</span>
			<div className="flex items-baseline gap-2">
				<span className={`text-[2rem] leading-tight font-bold tracking-tight ${left < 0 ? 'text-bad' : ''}`}>{left < 0 ? minus(-left) : fmt(left)}</span>
				<span className="text-xs text-muted uppercase">{t('limits.of', { x: fmt(limit) })}</span>
			</div>
			{/* 30 равных ячеек на всю ширину: █ — заливка без щелей, ░ — символ; ширина не зависит от шрифта */}
			<div aria-hidden="true" className="flex w-full leading-none">
				{Array.from({ length: BAR }, (_, k) => (
					k < filled ? <span key={k} className="flex-1 bg-ink" /> : <span key={k} className="flex-1 overflow-hidden text-center text-dim">░</span>
				))}
			</div>
			{left < 0 ? (
				<span className="text-xs text-bad uppercase">{t('limits.overLimits', { x: fmt(-left) })}</span>
			) : isCur ? (
				<span className="text-xs text-muted uppercase">{t('limits.perDay', { x: fmt(day.perDay), n: days })}</span>
			) : null}
		</section>
	)
}

/** Текущий (и прошлые) месяц */
function CurrentMonth({ month }: { month: string }) {
	const { data } = useTracker()
	const { readOnly } = useSpace()
	const isCur = month === curMonthKey()
	const editable = !readOnly && !data.readonly

	return (
		<>
			<CanSpend month={month} />
			<RequiredRow month={month} />
			<PlanRow month={month} />
			<Categories month={month} />
			{editable && isCur && (
				<section className="mt-8">
					<h2 className="sec">{t('limits.budgetSettings')}</h2>
					<CategoriesBlock title={t('limits.categories')} />
					<RecurringManager title={t('wizard.requiredQ')} />
				</section>
			)}
		</>
	)
}

const ROW = 'flex min-h-[3.25rem] w-full items-center justify-between gap-2.5 border-b border-dashed border-line2 py-3 text-left'

/** Обязательные: строка «оплачено K из N» и шторка со списком месяца */
function RequiredRow({ month }: { month: string }) {
	const { data } = useTracker()
	const { view, readOnly } = useSpace()
	const { rows: all, pay } = useRecurring(month)
	const [open, setOpen] = useState(false)
	const rows = all.filter((r) => inSpace(r.payment.scope, view))
	if (!rows.length) return null
	const paid = rows.filter((r) => r.status === 'paid').length
	const base = data.settings!.base
	const title = t('limits.requiredOf', { m: monthName(month) })
	// Правка платежей — внизу страницы, в «Настройках бюджета»
	const toSettings = () => {
		setOpen(false)
		const el = document.getElementById('recurring') as HTMLDetailsElement | null
		if (!el) return
		el.open = true
		el.scrollIntoView({ block: 'start' })
	}

	return (
		<>
			<button className={ROW} onClick={() => setOpen(true)} aria-haspopup="dialog">
				<IconText name="recurring" size={20}>{t('plan.required')}</IconText>
				<span className="flex items-center gap-1.5 text-xs text-muted uppercase">
					{t('limits.paidOf', { k: paid, n: rows.length })}<Icon name="chevron" size={16} />
				</span>
			</button>
			{open && (
				<Sheet label={title} onClose={() => setOpen(false)}>
					<div className="flex items-center justify-between">
						<b className="uppercase">:: {title}</b>
						<button className="ib" onClick={() => setOpen(false)}><Icon name="close" size={20} label={t('action.close')} /></button>
					</div>
					<ul className="mt-1 min-h-0 overflow-y-auto overscroll-contain uppercase">
						{rows.map((r) => {
							const done = r.status === 'paid'
							const overdue = r.status === 'overdue'
							return (
								<li key={r.paymentId} className="flex min-h-[3.25rem] flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-dashed border-line2 py-2">
									<span className={`flex min-w-0 flex-1 items-center gap-2 ${done ? 'text-muted' : overdue ? 'text-warn' : ''}`}>
										<Icon name={done ? 'check' : overdue ? 'warning' : 'recurring'} size={16} label={done ? t('recurring.paid') : overdue ? t('recurring.overdue') : undefined} />
										<span className="truncate">{r.dueDate.slice(8, 10)} {termName(r.name)}</span>
									</span>
									<span className={`flex items-center gap-2 ${done ? 'text-xs text-muted' : ''}`}>
										{r.approx && !done && '≈ '}{fmt(done ? (r.paidBase ?? r.amount) : r.amount)}{!done && r.currency !== base && ` ${r.currency}`}
										{!done && !readOnly && !data.readonly && <PayControl row={r} pay={(a) => pay(r.payment, r.month, a)} big />}
									</span>
								</li>
							)
						})}
					</ul>
					{!readOnly && !data.readonly && (
						<button className="mt-3 text-left text-[0.8125rem] text-muted2 underline" onClick={toSettings}>{t('limits.requiredEdit')}</button>
					)}
				</Sheet>
			)}
		</>
	)
}

/** «План ноября · отложится ~X»: раскрывается в пример в столбик и строку с покупками месяца */
export function PlanRow({ month }: { month: string }) {
	const { data, isSolo } = useTracker()
	const { view } = useSpace()
	const [open, setOpen] = useState(false)
	const e = planEquation(data, view, isSolo, month, todayStr())
	const planned = hasPlan(data, view, isSolo, month)
	const plan = data.plans[month]
	const items = spaceItems(plan ? [...plan.items.family, ...plan.items.mine] : [], view)
	const buys = items.map((i) => `${i.name.toLowerCase()} ${fmt(i.amount)}`).join(', ')

	return (
		<>
			<button className={ROW} onClick={() => setOpen(!open)} aria-expanded={open}>
				<IconText name="plan" size={20}>{planned ? t('plan.of', { m: gen(month) }) : t('limits.noPlan')}</IconText>
				<span className={`flex items-center gap-1.5 text-xs uppercase ${e.rest !== null && e.rest < 0 ? 'text-bad' : 'text-muted'}`}>
					{e.rest === null ? t('plan.totalAbout', { x: fmt(equationTotal(e)) }) : e.rest < 0 ? `${t('plan.short')} ${fmt(-e.rest)}` : t('plan.restAbout', { x: fmt(e.rest) })}
					<Icon name="chevron" size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
				</span>
			</button>
			{open && (
				<div className="border-b border-dashed border-line2 pt-2.5 pb-3.5">
					<PlanEquation e={e} />
					{items.length > 0 && <p className="mt-2 text-[0.8125rem] text-muted2">{t(items.length > 1 ? 'limits.purchasesNow' : 'limits.purchaseNow', { x: buys })}</p>}
				</div>
			)}
		</>
	)
}

/** :: КАТЕГОРИИ — компактные строки; раскрыта не больше одной */
function Categories({ month }: { month: string }) {
	const { data, isSolo } = useTracker()
	const { view } = useSpace()
	const [open, setOpen] = useState<string | null>(null)
	const groups: Scope[] = isSolo || view === 'personal' ? ['personal'] : view === 'family' ? ['family'] : ['family', 'personal']
	const plan = data.plans[month]

	return (
		<section className="mt-3.5">
			<h2 className="sec">{t('limits.categories')}</h2>
			{groups.map((g) => {
				const fam = g === 'family'
				const spent = planSpentByCat((fam ? data.familyExpenses : data.myExpenses)[month] ?? [], (fam ? plan?.items.family : plan?.items.mine) ?? [])
				const cats = catsIn(fam ? data.settings!.familyCategories : data.mySettings.personalCategories, month, spent, fam ? plan?.familyOverrides : plan?.myOverrides)
				return (
					<div key={g}>
						{groups.length > 1 && <h3 className="mt-3 text-xs text-muted uppercase"><IconText name={spaceIcon(g)}>{SPACE[g].name}</IconText></h3>}
						{cats.length === 0 && <p className="py-3 text-muted uppercase">—</p>}
						{cats.map((c) => (
							<CategoryRow key={c.id} c={c} scope={g} month={month} spent={spent[c.id] ?? 0}
								open={open === `${g}:${c.id}`} onToggle={() => setOpen(open === `${g}:${c.id}` ? null : `${g}:${c.id}`)} />
						))}
					</div>
				)
			})}
		</section>
	)
}

function CategoryRow({ c, scope, month, spent, open, onToggle }: { c: Category; scope: Scope; month: string; spent: number; open: boolean; onToggle: () => void }) {
	const { data, isSolo, toast, setSettings, setMySettings } = useTracker()
	const { readOnly } = useSpace()
	const { plan, savePlan, saveMyPlan } = usePlan(month)
	const [edit, setEdit] = useState(false)
	const fam = scope === 'family'
	const left = c.limit - spent
	const ratio = c.limit > 0 ? spent / c.limit : spent > 0 ? 1 : 0
	const bar = left < 0 ? 'bg-bad' : ratio >= 0.8 ? 'bg-warn' : 'bg-ink'
	const expenses = ((fam ? data.familyExpenses : data.myExpenses)[month] ?? []).filter((e) => e.catId === c.id)
	const last = [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts).slice(0, 2)
	const people = fam && !isSolo && data.partner ? [data.me, data.partner].map((u) => `${u.name} ${fmt(expenses.filter((e) => e.authorId === u.id).reduce((a, e) => a + e.base, 0))}`).join(' · ') : null
	const canEdit = !readOnly && !data.readonly && month === curMonthKey()

	// Есть поправка на месяц — правится она; иначе обычный лимит с этого месяца
	const save = (v: string) => {
		const n = parseAmount(v)
		if (n === null || Number.isNaN(n) || n < 0) return toast('Лимит должен быть числом.'), false
		const ov = fam ? plan.familyOverrides : plan.myOverrides
		if (c.id in ov) void (fam ? savePlan({ limitOverrides: withOverride(ov, c.id, n) }) : saveMyPlan(withOverride(ov, c.id, n)))
		else {
			const fn = (all: Category[]) => all.map((x) => (x.id === c.id ? setLimit(x, n, month) : x))
			if (fam) setSettings((s) => ({ ...s!, familyCategories: fn(s!.familyCategories) }))
			else setMySettings((s) => ({ ...s, personalCategories: fn(s.personalCategories) }))
		}
		setEdit(false)
	}

	return (
		<div className="border-b border-dashed border-line2">
			<button className="flex min-h-[3.25rem] w-full flex-col gap-1.5 py-3 text-left" onClick={onToggle} aria-expanded={open}>
				<span className="flex w-full min-w-0 justify-between gap-2">
					<span className="min-w-0 truncate">{c.name}</span>
					<span className="shrink-0">
						<b className={left < 0 ? 'text-bad' : ''}>{left < 0 ? minus(-left) : fmt(left)}</b>{' '}
						<span className="text-xs text-muted uppercase">{left < 0 ? t('limits.over') : t('limits.left')}</span>
					</span>
				</span>
				<span aria-hidden="true" className="relative block h-1 w-full bg-line2">
					<span className={`absolute inset-y-0 left-0 ${bar}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
				</span>
			</button>
			{open && (
				<div className="flex flex-col gap-1 pb-3 text-xs text-muted uppercase">
					<span>{t('limits.spentOf', { x: fmt(spent), y: fmt(c.limit) })}</span>
					{people && <span>{people}</span>}
					{last.length > 0 && <span className="normal-case break-words">{t('limits.last')} {last.map((e) => `${e.note || c.name} ${minus(e.base)}`).join(', ')}</span>}
					<span className="mt-1 flex flex-wrap gap-1.5 text-sm text-ink">
						<Link className={BTN} href={`/?cat=${encodeURIComponent(c.id)}`}>{t('limits.expenses')}</Link>
						{canEdit && <button className={BTN} aria-pressed={edit} onClick={() => setEdit(!edit)}>{t('limits.editLimit')}</button>}
					</span>
					{edit && (
						<CommitInput autoFocus className="tfield mt-1 w-full text-right text-ink" inputMode="decimal" sanitize={amountChars}
							aria-label={t('limits.limitOf', { x: c.name })} value={numIn(c.limit)} onCommit={save} />
					)}
				</div>
			)}
		</div>
	)
}

/** Будущий месяц: не спланирован — приглашение в мастер; спланирован — итог и пример в столбик */
function FutureMonth({ month, canPlan, onPlan }: { month: string; canPlan: boolean; onPlan: () => void }) {
	const { data, isSolo } = useTracker()
	const { view } = useSpace()
	const e = planEquation(data, view, isSolo, month, todayStr())
	const name = monthName(month)

	if (!hasPlan(data, view, isSolo, month))
		return (
			<section className="flex flex-col gap-3.5 pt-6">
				<h2 className="sec">{t('plan.notPlanned', { m: name })}</h2>
				{canPlan && (
					<>
						<p className="text-base">{e.income === null ? t('plan.introPersonal') : t('plan.intro')}</p>
						<button className={PRIMARY} onClick={onPlan}><Icon name="plan" size={20} />{t('plan.start', { m: name })}</button>
					</>
				)}
				<p className="text-[0.8125rem] text-muted2">{t('plan.withoutHint', { m: name.toLowerCase() })}</p>
			</section>
		)
	return (
		<section className="flex flex-col gap-2.5 pt-2">
			<span className="text-xs text-muted uppercase">{t('plan.of', { m: gen(month) })}</span>
			<PlanTotal e={e} />
			<PlanEquation e={e} />
			{canPlan && <button className={`${BTN} mt-2`} onClick={onPlan}>{t('plan.edit')}</button>}
		</section>
	)
}

