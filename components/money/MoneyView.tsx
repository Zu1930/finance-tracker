'use client'

import { useState, type ReactNode } from 'react'
import { useTracker } from '../TrackerProvider'
import { useSpace, useSpaceData } from '../SpaceProvider'
import { useNarrow } from '../AsciiBar'
import { BTN, PRIMARY, Sheet } from '../limits/parts'
import { Icon } from '../icons/Icon'
import { IconText, spaceIcon } from '../icons/IconText'
import { Hint } from '../onboarding/Hint'
import { UpdateSheet, UpdateTable, updatable } from './UpdateBalances'
import { t } from '@/lib/i18n'
import { average, abbr } from '@/lib/metrics'
import { daysSince, isStale, moneySeries, verdict } from '@/lib/money'
import { allocated, allocation, runway, toBase, totals } from '@/lib/savings'
import { spaceSavings } from '@/lib/space'
import { plural } from '@/lib/settings-meta'
import type { Account, Goal, Scope } from '@/lib/types'
import { amountChars, curMonthKey, ddmm, fmt, localDay, parseAmount, shiftMonth, signed, todayStr } from '@/lib/utils'

const ROW = 'flex min-h-[3.25rem] w-full items-center justify-between gap-2.5 border-b border-dashed border-line2 py-3 text-left'
const META = 'text-xs text-muted uppercase'
const HINT = 'text-[0.8125rem] text-muted2'
const MONTHS = 6

/**
 * «Деньги»: всего и на цели, обновление остатков, счета, цели, как менялось. Всё — по выбранному бюджету.
 * Телефон — одна колонка и шторки; десктоп — две колонки, история раскрыта, обновление таблицей
 */
export function MoneyView() {
	const narrow = useNarrow()
	const { data, isSolo } = useTracker()
	const { view, readOnly } = useSpace()
	const sd = useSpaceData()
	const st = data.settings!
	const sv = data.savings
	const picked = spaceSavings(sv, view)
	const accounts = [...picked.accounts.family, ...picked.accounts.personal].filter((a) => !a.archived)
	// «Всё вместе» одинаково у обоих: семейные + мои по курсу + сумма партнёра, посчитанная сервером
	const tot = totals(accounts, st.base, st.rates)
	const partner = view === 'all' && !isSolo ? sv.partner.total : 0
	const total = tot.all + partner
	const goalsAlloc = allocated([...picked.goals.family, ...picked.goals.personal], st.base, st.rates)
	const { allocated: onGoals, free } = allocation(goalsAlloc.total + (view === 'all' && !isSolo ? sv.partner.goalsAllocated : 0), total)
	const months = view === 'personal' ? null : runway(free, average(sd, todayStr())?.expense)
	const [updating, setUpdating] = useState(false)
	const canWrite = !readOnly && !data.readonly
	const label = isSolo || view === 'personal' ? t('money.totalMine') : view === 'family' ? t('money.totalFamily') : t('money.totalAll')

	const head = (
		<section aria-label={label} className="flex flex-col gap-1.5 pb-1.5">
			<span className={META}>{label}</span>
			<p className="flex items-baseline gap-2">
				<b className="text-[2rem] leading-tight tracking-tight">{fmt(Math.round(total))}</b>
				<span className={META}>{st.base}</span>
			</p>
			<span aria-hidden="true" className="flex h-1.5 bg-line2">
				<span className="bg-ink" style={{ width: `${total > 0 ? Math.min(100, Math.max(0, (onGoals / total) * 100)) : 0}%` }} />
			</span>
			<span className={`flex justify-between ${META}`}>
				<span>{t('money.onGoals')} {fmt(Math.round(onGoals))}</span>
				<span className={free < 0 ? 'text-bad' : ''}>{t('money.free')} {fmt(Math.round(free))}</span>
			</span>
			{months !== null && (
				<span>{t('money.runway')} <b className={months < 1 ? 'text-warn' : ''}>{t('money.runwayMonths', { x: fmt(months) })}</b> {t('money.runwayTail')}</span>
			)}
			{tot.missing.length > 0 && <span className="text-warn"><IconText name="warning">{t('money.noRate', { x: tot.missing.join(', ') })}</IconText></span>}
			{!isSolo && view === 'personal' && <span className={HINT}><IconText name="lock">{t('space.onlyYou')}</IconText></span>}
		</section>
	)
	const update = updatable(data).length > 0 && (
		!canWrite ? (
			!data.readonly && <p className={HINT}><IconText name="view">{t('money.viewOnly')}</IconText></p>
		) : updating && !narrow ? null : (
			<UpdateCard onStart={() => setUpdating(true)} />
		)
	)

	if (narrow)
		return (
			<div className="flex flex-col gap-2">
				{head}
				{update}
				<Hint id="savings" />
				<AccountsBlock />
				<GoalsBlock />
				<History total={total} />
				{updating && <UpdateSheet onClose={() => setUpdating(false)} />}
			</div>
		)
	// Десктоп: колонки — .l-money в app/globals.css (две; на 1920+ — три). Таблица обновления остатков — на всю ширину, до 1200px
	return (
		<>
			{updating && canWrite && (
				<div className="mx-auto mb-6 w-full max-w-[1200px]"><UpdateTable onClose={() => setUpdating(false)} /></div>
			)}
			<div className="l-money">
				<div className="flex flex-col gap-3 [grid-area:main]">
					{head}
					{update}
					<Hint id="savings" />
					<GoalsBlock />
				</div>
				<div className="flex flex-col gap-3 [grid-area:side]">
					<AccountsBlock />
				</div>
				<div className="flex flex-col gap-3 [grid-area:hist]">
					<History total={total} open />
				</div>
			</div>
		</>
	)
}

/** Давно не обновляли — карточка с кнопкой; иначе строка «Обновлено …» с итогом последней проверки */
function UpdateCard({ onStart }: { onStart: () => void }) {
	const { data } = useTracker()
	const last = data.savings.recons.at(-1)
	const days = daysSince(last?.day, todayStr())
	if (isStale(days))
		return (
			<section className="flex flex-col gap-2.5 border border-warn p-3">
				<b><IconText name="warning">{days === null ? t('money.never') : t('money.stale', { n: `${days} ${plural(days, 'день', 'дня', 'дней')}` })}</IconText></b>
				<span className={HINT}>{t('money.staleHint')}</span>
				<button className={`${PRIMARY} h-12 uppercase`} onClick={onStart}>{t('money.update')}</button>
			</section>
		)
	const v = verdict(last!)
	return (
		<button className={ROW} onClick={onStart}>
			<IconText name="check">{t('money.updated', { d: last!.day === todayStr() ? t('money.today') : ddmm(last!.day) })}</IconText>
			<span className={`flex items-center gap-1.5 ${META} ${v.kind === 'missing' || v.kind === 'extra' ? 'text-warn' : ''}`}>
				{v.kind === 'ok' ? t('money.allOk') : v.kind === 'first' ? '' : t('money.diff', { x: fmt(Math.abs(v.gap)) })}
				<Icon name="chevron" size={16} />
			</span>
		</button>
	)
}

/** На телефоне — шторка, на десктопе — раскрытый блок под строкой */
function Panel({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
	const narrow = useNarrow()
	if (narrow)
		return (
			<Sheet label={label} onClose={onClose}>
				<div className="flex items-center justify-between gap-2">
					<b className="min-w-0 truncate uppercase">{label}</b>
					<button className="ib" onClick={onClose}><Icon name="close" size={20} label={t('action.close')} /></button>
				</div>
				<div className="mt-2 flex min-h-0 flex-col gap-3 overflow-y-auto">{children}</div>
			</Sheet>
		)
	return <div className="flex flex-col gap-3 border-b border-dashed border-line2 py-3">{children}</div>
}

const glyph = (scope: Scope) => <Icon name={spaceIcon(scope)} size={16} className={`shrink-0 ${scope === 'personal' ? 'text-muted' : ''}`} label={t(scope === 'family' ? 'space.family' : 'space.personal')} />

/** :: СЧЕТА — строка: имя и остаток; нажатие — карточка: переименовать, убрать */
export function AccountsBlock() {
	const { data, isSolo } = useTracker()
	const { view, readOnly } = useSpace()
	const st = data.settings!
	const picked = spaceSavings(data.savings, view).accounts
	const list = [...picked.family, ...picked.personal].filter((a) => !a.archived)
	const [open, setOpen] = useState<string | null>(null)
	const [adding, setAdding] = useState(false)
	const canWrite = !readOnly && !data.readonly
	const scope: Scope = isSolo ? 'personal' : view === 'personal' ? 'personal' : 'family'
	return (
		<section aria-label={t('money.accounts')} className="mt-2.5">
			<h2 className="sec">{t('money.accounts')}</h2>
			{list.length === 0 && <p className={`mt-2 ${HINT}`}>{t('money.noAccounts')}</p>}
			<ul>
				{list.map((a) => {
					const inBase = a.currency === st.base ? null : toBase(a.balance, a.currency, st.base, st.rates)
					return (
						<li key={a.id}>
							<button className={ROW} aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
								<span className="flex min-w-0 items-center gap-2.5">{!isSolo && view === 'all' && glyph(a.scope)}<span className="min-w-0 truncate uppercase">{a.name}</span></span>
								<span className="flex shrink-0 flex-col items-end">
									<b>{fmt(a.balance)} {a.currency}</b>
									{a.currency !== st.base && <span className={META}>{inBase === null ? '?' : `≈ ${fmt(Math.round(inBase))} ${st.base}`}</span>}
								</span>
							</button>
							{open === a.id && <AccountCard a={a} canWrite={canWrite} onClose={() => setOpen(null)} />}
						</li>
					)
				})}
			</ul>
			{canWrite && (adding ? <NewAccount scope={scope} onClose={() => setAdding(false)} /> : (
				<button className={`${BTN} mt-2 uppercase`} onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('money.addAccount')}</button>
			))}
		</section>
	)
}

function AccountCard({ a, canWrite, onClose }: { a: Account; canWrite: boolean; onClose: () => void }) {
	const { api, toast } = useTracker()
	const [name, setName] = useState(a.name)
	const day = localDay(a.updatedAt)
	const rename = async () => {
		const n = name.trim()
		if (!n || n === a.name) return onClose()
		if (await api(`/api/accounts/${a.id}`, 'PATCH', { scope: a.scope, version: a.version, name: n })) onClose()
	}
	const archive = async () => {
		if (a.balance !== 0) return toast(t('money.archiveFirst'))
		const res = await api<{ item: Account }>(`/api/accounts/${a.id}`, 'PATCH', { scope: a.scope, version: a.version, archived: true })
		if (!res) return
		onClose()
		toast(t('money.archived', { x: a.name }), t('money.restore'), () => void api(`/api/accounts/${a.id}`, 'PATCH', { scope: a.scope, version: res.item.version, archived: false }))
	}
	return (
		<Panel label={a.name} onClose={onClose}>
			<span className={META}>{fmt(a.balance)} {a.currency} · {t('money.updatedAt', { d: day === todayStr() ? t('money.today') : ddmm(day) })}</span>
			{canWrite && (
				<>
					<label className="flex items-center gap-3">
						<span className="lbl">{t('money.accountName')}</span>
						<input className="tfield min-w-0 flex-1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void rename()} />
					</label>
					<div className="flex flex-wrap gap-2">
						<button className={`${BTN} font-bold uppercase`} onClick={() => void rename()}>{t('money.save')}</button>
						<button className={`${BTN} uppercase hover:text-bad`} onClick={() => void archive()}><Icon name="archive" size={16} />{t('money.archive')}</button>
					</div>
				</>
			)}
		</Panel>
	)
}

function NewAccount({ scope, onClose }: { scope: Scope; onClose: () => void }) {
	const { data, api, toast } = useTracker()
	const st = data.settings!
	const [name, setName] = useState('')
	const [cur, setCur] = useState(st.base)
	const [bal, setBal] = useState('')
	const add = async () => {
		const n = name.trim()
		const b = bal.trim() ? parseAmount(bal) : 0
		if (!n) return
		if (b === null || Number.isNaN(b)) return toast(t('money.balance'))
		if (await api('/api/accounts', 'POST', { name: n, currency: st.currencies.includes(cur) ? cur : st.base, scope, balance: b })) onClose()
	}
	return (
		<div className="mt-3 flex flex-col gap-3">
			<input autoFocus className="tfield" placeholder={t('money.accountName')} aria-label={t('money.accountName')} value={name} maxLength={40}
				onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
			<div className="flex flex-wrap items-center gap-3">
				<input className="tfield min-w-0 flex-1 text-right" inputMode="decimal" placeholder="0" aria-label={t('money.balance')} value={bal}
					onChange={(e) => setBal(amountChars(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void add()} />
				<Currencies value={cur} onChange={setCur} />
			</div>
			<div className="flex gap-2">
				<button className={`${BTN} uppercase`} onClick={onClose}>{t('money.cancel')}</button>
				<button className={`${BTN} font-bold uppercase`} onClick={() => void add()}>{t('money.add')}</button>
			</div>
		</div>
	)
}

function Currencies({ value, onChange }: { value: string; onChange: (c: string) => void }) {
	const st = useTracker().data.settings!
	if (st.currencies.length < 2) return null
	return (
		<div className="tgroup" role="group" aria-label={t('entry.currency')}>
			{st.currencies.map((c) => <button key={c} className="tb tb-tight" aria-pressed={value === c} onClick={() => onChange(c)}>{c}</button>)}
		</div>
	)
}

/** :: ЦЕЛИ — строка: имя, «X ИЗ Y», полоска; нажатие — отложить или взять */
export function GoalsBlock() {
	const { data, isSolo } = useTracker()
	const { view, readOnly, entryScope } = useSpace()
	const picked = spaceSavings(data.savings, view).goals
	const goals = [...picked.family, ...picked.personal]
	const [open, setOpen] = useState<string | null>(null)
	const [adding, setAdding] = useState(false)
	const canWrite = !readOnly && !data.readonly
	return (
		<section aria-label={t('money.goals')} className="mt-3.5">
			<h2 className="sec">{t('money.goals')}</h2>
			{goals.length === 0 && <p className={`mt-2 ${HINT}`}>{t('money.noGoals')}</p>}
			<ul>
				{goals.map((g) => (
					<li key={g.id}>
						<button className={`${ROW} flex-col items-stretch gap-1.5`} aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
							<span className="flex justify-between gap-2">
								<span className="flex min-w-0 items-center gap-2.5">{!isSolo && view === 'all' && glyph(g.scope)}<span className="min-w-0 truncate uppercase">{g.name}</span></span>
								<span className={`shrink-0 ${META}`}>{t('money.goalOf', { x: fmt(g.allocated), y: fmt(g.target) })}{g.currency !== data.settings!.base && ` ${g.currency}`}</span>
							</span>
							<span aria-hidden="true" className="flex h-1 bg-line2"><span className="bg-ink" style={{ width: `${Math.min(100, (g.allocated / g.target) * 100)}%` }} /></span>
						</button>
						{open === g.id && <GoalCard g={g} canWrite={canWrite} onClose={() => setOpen(null)} />}
					</li>
				))}
			</ul>
			{canWrite && entryScope && (adding ? <NewGoal scope={entryScope} onClose={() => setAdding(false)} /> : (
				<button className={`${BTN} mt-2 uppercase`} onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('money.addGoal')}</button>
			))}
		</section>
	)
}

function GoalCard({ g, canWrite, onClose }: { g: Goal; canWrite: boolean; onClose: () => void }) {
	const { api, toast } = useTracker()
	const [val, setVal] = useState('')
	const url = `/api/goals/${g.id}/ops`
	const move = async (sign: 1 | -1) => {
		const v = parseAmount(val)
		if (!v || !(v > 0)) return
		if (sign < 0 && v > g.allocated) return toast(t('money.takeTooMuch', { x: `${fmt(g.allocated)} ${g.currency}` }))
		if (!(await api(url, 'POST', { scope: g.scope, amount: sign * v, date: todayStr() }))) return
		onClose()
		toast(t(sign > 0 ? 'money.putDone' : 'money.takeDone', { x: `${fmt(v)} ${g.currency}`, g: g.name }), t('money.undo'), () =>
			void api(url, 'POST', { scope: g.scope, amount: -sign * v, date: todayStr() }))
	}
	const remove = async () => {
		if (g.allocated !== 0) return toast(t('money.goalNotEmpty'))
		if (!(await api(`/api/goals/${g.id}?scope=${g.scope}`, 'DELETE'))) return
		onClose()
		toast(t('money.goalRemoved', { x: g.name }), t('money.restore'), () =>
			void api('/api/goals', 'POST', { name: g.name, target: g.target, currency: g.currency, scope: g.scope }))
	}
	return (
		<Panel label={g.name} onClose={onClose}>
			<span className={META}>{t('money.goalState', { x: fmt(g.allocated), y: fmt(g.target), z: `${fmt(Math.max(0, g.target - g.allocated))} ${g.currency}` })}</span>
			<span className={HINT}>{t('money.goalHint')}</span>
			{canWrite && (
				<>
					<input className="tfield text-[1.375rem]" inputMode="decimal" autoFocus placeholder={t('money.amount')} aria-label={t('money.amount')} value={val}
						onChange={(e) => setVal(amountChars(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void move(1)} />
					<div className="grid grid-cols-2 gap-1.5">
						<button className={`${PRIMARY} h-12 uppercase`} onClick={() => void move(1)}>{t('money.put')}</button>
						<button className={`${BTN} min-h-12 uppercase`} onClick={() => void move(-1)}>{t('money.take')}</button>
					</div>
					{g.allocated === 0 && (
						<button className="ib self-start text-muted hover:text-bad" onClick={() => void remove()}><IconText name="trash">{t('money.removeGoal')}</IconText></button>
					)}
				</>
			)}
		</Panel>
	)
}

function NewGoal({ scope, onClose }: { scope: Scope; onClose: () => void }) {
	const { data, api } = useTracker()
	const st = data.settings!
	const [name, setName] = useState('')
	const [target, setTarget] = useState('')
	const [cur, setCur] = useState(st.base)
	const add = async () => {
		const n = name.trim()
		const v = parseAmount(target)
		if (!n || !v || !(v > 0)) return
		if (await api('/api/goals', 'POST', { name: n, target: v, currency: st.currencies.includes(cur) ? cur : st.base, scope })) onClose()
	}
	return (
		<div className="mt-3 flex flex-col gap-3">
			<input autoFocus className="tfield" placeholder={t('money.goalName')} aria-label={t('money.goalName')} value={name} maxLength={40}
				onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
			<div className="flex flex-wrap items-center gap-3">
				<input className="tfield min-w-0 flex-1 text-right" inputMode="decimal" placeholder={t('money.goalTarget')} aria-label={t('money.goalTarget')} value={target}
					onChange={(e) => setTarget(amountChars(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void add()} />
				<Currencies value={cur} onChange={setCur} />
			</div>
			<div className="flex gap-2">
				<button className={`${BTN} uppercase`} onClick={onClose}>{t('money.cancel')}</button>
				<button className={`${BTN} font-bold uppercase`} onClick={() => void add()}>{t('money.add')}</button>
			</div>
		</div>
	)
}

/** Как менялось: остаток бюджета на конец месяца за полгода. Телефон — строка и шторка, десктоп — сразу список */
function History({ total, open: always = false }: { total: number; open?: boolean }) {
	const { data } = useTracker()
	const { view } = useSpace()
	const [open, setOpen] = useState(false)
	const cur = curMonthKey()
	const keys = Array.from({ length: MONTHS }, (_, i) => shiftMonth(cur, i - MONTHS + 1))
	const series = moneySeries(data.savings.recons, view, keys, total)
	const max = Math.max(1, ...series.map((p) => p.value ?? 0))
	const list = (
		<ul className="flex flex-col gap-1.5">
			{series.map((p, i) => {
				const prev = series[i - 1]?.value
				const d = p.value !== null && prev != null ? p.value - prev : null
				return (
					<li key={p.key} className={`grid min-h-8 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2.5 ${p.carried ? 'text-muted' : ''}`}>
						<span className={META}>{abbr(p.key)}</span>
						<span aria-hidden="true" className="flex h-2 bg-line2"><span className={p.carried ? 'bg-muted' : 'bg-ink'} style={{ width: `${Math.max(0, ((p.value ?? 0) / max) * 100)}%` }} /></span>
						<span className="text-right">
							<b className={p.carried ? 'font-normal' : ''}>{p.value === null ? '—' : `${p.carried ? '~' : ''}${fmt(Math.round(p.value))}`}</b>{' '}
							<span className={META}>{d === null || p.carried ? '' : signed(Math.round(d))}</span>
						</span>
					</li>
				)
			})}
		</ul>
	)
	if (always)
		return (
			<section aria-label={t('money.historyTitle')} className="mt-3.5 huge:mt-0">
				<h2 className="sec">{t('money.historyTitle')}</h2>
				<div className="mt-3">{list}</div>
			</section>
		)
	return (
		<>
			<button className={`${ROW} mt-2.5`} onClick={() => setOpen(true)} aria-haspopup="dialog">
				<IconText name="chart">{t('money.history')}</IconText>
				<span className={`flex items-center gap-1.5 ${META}`}>{t('money.historyMonths')}<Icon name="chevron" size={16} /></span>
			</button>
			{open && (
				<Sheet label={t('money.historyTitle')} onClose={() => setOpen(false)}>
					<div className="mb-2 flex items-center justify-between">
						<b className="uppercase">:: {t('money.historyTitle')}</b>
						<button className="ib" onClick={() => setOpen(false)}><Icon name="close" size={20} label={t('action.close')} /></button>
					</div>
					{list}
				</Sheet>
			)}
		</>
	)
}
