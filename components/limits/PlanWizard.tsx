'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTracker } from '../TrackerProvider'
import { BTN, PRIMARY, PlanEquation, PlanTotal, Sheet } from './parts'
import { Icon } from '../icons/Icon'
import { Problem } from '../icons/IconText'
import { t } from '@/lib/i18n'
import { familyMembers } from '@/lib/metrics'
import { closeSheet, isSheetOpen, openSheet } from '@/lib/sheet'
import { buildDictionary, visibleExpenses } from '@/lib/quick-entry/dictionary'
import {
	bulkBody, buyCategory, buyChips, draftEquation, draftIncome, initDraft, isDirty, livingOf, livingStep, wizardInput, type Buy, type Draft,
} from '@/lib/plan-view'
import type { Scope } from '@/lib/types'
import { MONTHS_GEN, MONTHS_IN, amountChars, fmt, minus, monthName, numIn, parseAmount, shiftMonth, termName, todayStr, uid } from '@/lib/utils'

const PARAM = 'plan'
type Step = 'income' | 'required' | 'buys' | 'living' | 'result'
const H2 = 'text-[1.375rem] leading-tight font-bold outline-none'
const HINT = 'text-[0.8125rem] text-muted2'

/**
 * План месяца по шагам: доход, обязательные, покупки, на жизнь, итог. Черновик живёт здесь до «Готово» и уходит
 * одним запросом PUT /api/plan/:month/bulk. Открытие добавляет ?plan=1 в историю: «назад» закрывает шторку
 */
export function PlanWizard({ month, scope, onClose }: { month: string; scope: Scope; onClose: () => void }) {
	const { data, isSolo, api, toast } = useTracker()
	const today = todayStr()
	// Снимок данных на момент открытия: версии плана для проверки при сохранении
	const [w] = useState(() => wizardInput(data, scope, isSolo, month, today))
	const [d, setD] = useState<Draft>(() => initDraft(w))
	const steps: Step[] = w.withIncome ? ['income', 'required', 'buys', 'living', 'result'] : ['required', 'buys', 'living', 'result']
	const [i, setI] = useState(0)
	const [saving, setSaving] = useState(false)
	const step = steps[i]
	const e = draftEquation(w, d)
	const gen = MONTHS_GEN[Number(month.slice(5, 7)) - 1]
	const inMonth = MONTHS_IN[Number(month.slice(5, 7)) - 1]
	const head = useRef<HTMLHeadingElement>(null)
	useEffect(() => head.current?.focus(), [i])

	// История: «назад» в браузере — как закрыть; с изменениями — спросить
	const dirty = useRef(false)
	dirty.current = isDirty(w, d)
	const pushed = useRef(false)
	const leaving = useRef(false)
	const done = useRef(onClose)
	done.current = onClose
	useEffect(() => {
		// В StrictMode эффект запускается дважды: запись уже добавлена первым запуском
		pushed.current ||= openSheet(window, PARAM)
		const onPop = () => {
			if (isSheetOpen(window.location.href, PARAM)) return
			if (!leaving.current && dirty.current && !window.confirm(t('wizard.leave'))) {
				pushed.current = openSheet(window, PARAM)
				return
			}
			done.current()
		}
		window.addEventListener('popstate', onPop)
		return () => window.removeEventListener('popstate', onPop)
	}, [])
	const leave = () => {
		leaving.current = true
		if (pushed.current) closeSheet(window, true, PARAM) // popstate закроет шторку
		else {
			closeSheet(window, false, PARAM)
			onClose()
		}
	}
	const close = () => {
		if (dirty.current && !window.confirm(t('wizard.leave'))) return
		leave()
	}

	const save = async () => {
		setSaving(true)
		const ok = await api(`/api/plan/${month}/bulk`, 'PUT', bulkBody(w, d))
		setSaving(false)
		if (!ok) return
		toast(t('wizard.saved', { m: gen }))
		leave()
	}
	const next = () => (step === 'result' ? void save() : setI(i + 1))
	const blocked = (step === 'income' && draftIncome(w, d) === null) || saving

	return (
		<Sheet label={t('plan.of', { m: gen })} onClose={close} full>
			<div className="flex items-center justify-between">
				{i > 0 ? <button className="ib" onClick={() => setI(i - 1)}><Icon name="back" size={20} label={t('nav.back')} /></button> : <span className="w-11" />}
				<span className="text-xs text-muted uppercase">
					{step === 'result' ? t('wizard.result', { m: gen }) : t('wizard.step', { m: gen, i: i + 1, n: steps.length - 1 })}
				</span>
				<button className="ib" onClick={close}><Icon name="close" size={20} label={t('action.close')} /></button>
			</div>
			<div className="mt-2 flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain pb-2 [&>*]:shrink-0">
				{step === 'income' && <IncomeStep head={head} w={w} d={d} setD={setD} inMonth={inMonth} />}
				{step === 'required' && <RequiredStep head={head} w={w} d={d} setD={setD} inMonth={inMonth} />}
				{step === 'buys' && <BuysStep head={head} w={w} d={d} setD={setD} month={month} />}
				{step === 'living' && <LivingStep head={head} w={w} d={d} setD={setD} month={month} />}
				{step === 'result' && (
					<>
						<h2 ref={head} tabIndex={-1} className={H2}>{t('wizard.resultQ', { m: monthName(month) })}</h2>
						<PlanTotal e={e} />
						<PlanEquation e={e} />
						{e.rest !== null && e.rest < 0 && <p className={`${HINT} text-bad`} role="alert"><Problem>{t('wizard.shortHint')}</Problem></p>}
					</>
				)}
			</div>
			<div className="mt-auto flex flex-col gap-2 pt-2">
				{step !== 'income' && step !== 'result' && (
					<span className="text-center text-xs text-muted uppercase" aria-live="polite">
						{e.rest === null ? t('wizard.runningTotal', { x: fmt(e.required + e.living + e.purchases) }) : t('wizard.running', { x: fmt(e.rest) })}
					</span>
				)}
				<button className={PRIMARY} disabled={blocked} onClick={next}>
					{step === 'result' ? t('wizard.done') : step === 'living' ? t('wizard.seeResult') : t('wizard.next')}
				</button>
			</div>
		</Sheet>
	)
}

type StepProps = { head: React.RefObject<HTMLHeadingElement | null>; w: ReturnType<typeof wizardInput>; d: Draft; setD: (f: (d: Draft) => Draft) => void }

function IncomeStep({ head, w, d, setD, inMonth }: StepProps & { inMonth: string }) {
	const { data, isSolo } = useTracker()
	// Доходы личные: подставлена сумма средних по участникам, в подсказке — среднее каждого
	const by = !isSolo && data.partner && w.averageBy
		? familyMembers(data).map((u) => `${u.name} ${fmt(Math.round(w.averageBy![u.id] ?? 0))}`).join(', ')
		: null
	const hint = w.incomeOverride !== null ? t('wizard.incomeSaved')
		: w.average === null ? t('wizard.incomeNone')
		: by ? t('wizard.incomeAvgOf', { x: by }) : t('wizard.incomeAvg')
	return (
		<>
			<h2 ref={head} tabIndex={-1} className={H2}>{t('wizard.incomeQ', { m: inMonth })}</h2>
			<label className="flex items-baseline gap-2 border-b-2 border-ink pb-1">
				<span className="text-[2rem] font-bold" aria-hidden="true">+</span>
				<input className="min-w-0 flex-1 bg-transparent text-[2rem] font-bold outline-none" inputMode="decimal" aria-label={t('wizard.incomeLabel')}
					value={d.income} onChange={(ev) => { const v = amountChars(ev.target.value); setD((x) => ({ ...x, income: v })) }} />
				<span className="text-xs text-muted">{data.settings!.base}</span>
			</label>
			<p className={HINT}>{hint}</p>
		</>
	)
}

function RequiredStep({ head, w, d, setD, inMonth }: StepProps & { inMonth: string }) {
	const total = w.payments.filter((p) => d.on[p.id]).reduce((a, p) => a + p.amount, 0)
	return (
		<>
			<h2 ref={head} tabIndex={-1} className={H2}>{t('wizard.requiredQ')}</h2>
			<p className={HINT}>{w.payments.length ? t('wizard.requiredHint', { m: inMonth }) : t('wizard.requiredNone')}</p>
			{w.payments.length > 0 && (
				<>
					<div>
						{w.payments.map((p) => {
							const on = d.on[p.id]
							return (
								<button key={p.id} aria-pressed={on} onClick={() => setD((x) => ({ ...x, on: { ...x.on, [p.id]: !on } }))}
									className={`flex min-h-[3.25rem] w-full items-center justify-between gap-2.5 border-b border-dashed border-line2 py-3 text-left uppercase ${on ? '' : 'text-muted'}`}>
									<span className="flex min-w-0 items-center gap-2.5">
										<span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center border border-current">{on && <Icon name="check" size={16} />}</span>
										<span className="truncate">{termName(p.name)}</span>
									</span>
									<span className={on ? '' : 'line-through'}>{fmt(p.amount)}</span>
								</button>
							)
						})}
					</div>
					<span className="text-xs text-muted uppercase">{t('wizard.totalOf', { x: minus(total) })}</span>
				</>
			)}
		</>
	)
}

function BuysStep({ head, w, d, setD, month }: StepProps & { month: string }) {
	const { data } = useTracker()
	const [name, setName] = useState('')
	const [sum, setSum] = useState('')
	const sumRef = useRef<HTMLInputElement>(null)
	const dictionary = useMemo(() => buildDictionary(visibleExpenses(data)), [data])
	const catName = (id: string) => w.cats.find((c) => c.id === id)?.name ?? '—'
	const add = (b: Omit<Buy, 'key'>) => setD((x) => ({ ...x, buys: [...x.buys, { key: uid(), ...b }] }))
	const submit = () => {
		const n = parseAmount(sum)
		const nm = name.trim().slice(0, 40)
		if (!nm || !n || !(n > 0)) return
		add({ name: nm, amount: n, categoryId: buyCategory(nm, w.cats, w.scope, dictionary, todayStr()) })
		setName('')
		setSum('')
	}
	const chips = buyChips(w, d, month.endsWith('-12') ? t('wizard.giftsNY') : null)

	return (
		<>
			<h2 ref={head} tabIndex={-1} className={H2}>{t('wizard.buysQ')}</h2>
			<p className={HINT}>{t('wizard.buysHint')}</p>
			{d.buys.length > 0 && (
				<ul>
					{d.buys.map((b) => (
						<li key={b.key} className="flex min-h-[3.25rem] items-center justify-between gap-2 border-b border-dashed border-line2 py-1.5">
							<span className="flex min-w-0 flex-col">
								<span className="truncate uppercase">{b.name}</span>
								{/* Новая покупка — категорию можно сменить; у сохранённой она уже связана с тратами */}
								{b.id ? <span className="text-xs text-muted uppercase">{termName(catName(b.categoryId))}</span> : (
									<select className="w-fit bg-transparent text-xs text-muted uppercase" aria-label={t('wizard.buyCat', { x: b.name })} value={b.categoryId}
										onChange={(ev) => { const v = ev.target.value; setD((x) => ({ ...x, buys: x.buys.map((y) => (y.key === b.key ? { ...y, categoryId: v } : y)) })) }}>
										{w.cats.map((c) => <option key={c.id} value={c.id}>{termName(c.name)}</option>)}
									</select>
								)}
							</span>
							<span className="flex items-center gap-1">
								<b>{minus(b.amount)}</b>
								<button className="ib" onClick={() => setD((x) => ({ ...x, buys: x.buys.filter((y) => y.key !== b.key) }))}>
									<Icon name="close" size={16} label={`${t('action.remove')}: ${b.name}`} />
								</button>
							</span>
						</li>
					))}
				</ul>
			)}
			<div className="flex flex-col gap-2">
				<input className="tfield" placeholder={t('wizard.buyName')} aria-label={t('wizard.buyName')} value={name} maxLength={40}
					onChange={(ev) => setName(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && sumRef.current?.focus()} />
				<div className="flex items-end gap-2">
					<input ref={sumRef} className="tfield flex-1" inputMode="decimal" placeholder={t('wizard.buySum')} aria-label={t('wizard.buySum')} value={sum}
						onChange={(ev) => setSum(amountChars(ev.target.value))} onKeyDown={(ev) => ev.key === 'Enter' && submit()} />
					<button className={BTN} onClick={submit}><Icon name="plus" size={16} />{t('wizard.add')}</button>
				</div>
				{chips.length > 0 && (
					<span className="flex flex-wrap gap-1.5">
						{chips.map((c) => c.kind === 'carry' ? (
							<button key={c.item.id} className={`${BTN} text-xs`}
								onClick={() => add({ name: c.item.name, amount: c.item.amount, categoryId: c.item.categoryId, id: c.item.id, from: c.item.month })}>
								{c.item.name} {fmt(c.item.amount)}
							</button>
						) : (
							<button key={c.name} className={`${BTN} text-xs`} onClick={() => { setName(c.name); sumRef.current?.focus() }}>{c.name}</button>
						))}
					</span>
				)}
			</div>
		</>
	)
}

function LivingStep({ head, w, d, setD, month }: StepProps & { month: string }) {
	const { data, isSolo } = useTracker()
	const [typing, setTyping] = useState<string | null>(null)
	const step = livingStep(data.settings!.base)
	const init = initDraft(w)
	const prev = MONTHS_IN[Number(shiftMonth(month, -1).slice(5, 7)) - 1]
	const set = (id: string, v: number) => setD((x) => ({ ...x, living: { ...x.living, [id]: Math.max(0, Math.round(v * 100) / 100) } }))

	return (
		<>
			<h2 ref={head} tabIndex={-1} className={H2}>{t('wizard.livingQ')}</h2>
			<p className={HINT}>{t('wizard.livingHint', { m: prev })}</p>
			<div>
				{w.cats.map((c) => {
					const v = livingOf(w, d, c)
					const changed = v !== livingOf(w, init, c)
					return (
						<div key={c.id} className="flex min-h-[3.25rem] items-center justify-between gap-2 border-b border-dashed border-line2 py-1.5">
							<span className="flex min-w-0 flex-col">
								<span className="truncate">{c.name}</span>
								<span className="text-xs text-muted uppercase">{t('wizard.prevSpent', { m: prev, x: fmt(w.prevSpent[c.id] ?? 0) })}</span>
							</span>
							<span className="flex shrink-0 items-center gap-1">
								<button className={`${BTN} min-w-11 px-0`} onClick={() => set(c.id, v - step)} aria-label={t('wizard.less', { x: c.name })}>−</button>
								{typing === c.id ? (
									<input autoFocus className="tfield w-[9ch] text-center font-bold" inputMode="decimal" aria-label={t('wizard.valueOf', { x: c.name })}
										defaultValue={numIn(v)}
										onBlur={(ev) => { const n = parseAmount(ev.target.value); if (n !== null && !Number.isNaN(n) && n >= 0) set(c.id, n); setTyping(null) }}
										onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') setTyping(null) }} />
								) : (
									<button className={`min-h-11 w-[9ch] text-center font-bold ${changed ? 'text-warn' : ''}`} onClick={() => setTyping(c.id)} aria-label={t('wizard.valueOf', { x: c.name })}>
										{fmt(v)}
									</button>
								)}
								<button className={`${BTN} min-w-11 px-0`} onClick={() => set(c.id, v + step)} aria-label={t('wizard.more', { x: c.name })}>+</button>
							</span>
						</div>
					)
				})}
			</div>
			{w.scope === 'family' && !isSolo && data.partner && (
				<p className="text-xs text-muted uppercase">{t('wizard.partnerLimits', { names: `${data.me.name} и ${data.partner.name}`, x: fmt(w.others.limits) })}</p>
			)}
		</>
	)
}
